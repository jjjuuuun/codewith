import { runtimeConfig as runtime } from "./runtime-config.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  SOURCE_LIMITS,
  sourceAllowed,
  validateSourceFiles,
  exclusions,
} from "../shared/source-policy.mjs";
import { problem } from "../shared/schema.mjs";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const inside = (root, p) => p === root || p.startsWith(root + path.sep);
export function sourceSummary(source) {
  if (!source) return null;
  const { files, ...summary } = source;
  return {
    ...summary,
    fileCount: Object.keys(files).length,
    paths: Object.keys(files).sort(),
    bytes: Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0),
  };
}
export function sourceConnectionNote(context) {
  if (!context) return "프로젝트 폴더 연결 정보가 없습니다.";
  const state =
    context.provenance.kind === "upload"
      ? "프로젝트 코드 사본이 연결되어 있습니다."
      : "프로젝트 폴더가 연결되어 있습니다.";
  return (
    state +
    (context.provenance.totalFiles === 0
      ? " 현재 읽기 대상 코드 파일은 0개입니다. 빈 신규 프로젝트이거나 제외 규칙에 해당할 수 있습니다. 이를 폴더 연결 누락으로 판단하거나 단순히 재연결을 요구하지 마세요. 기존 코드를 꾸며내지 말고 신규 구현 계획을 작성할 수 있습니다."
      : " 전달된 코드와 명시된 조사 범위를 기준으로 판단하세요.")
  );
}
export function sourceContext(source, query = "") {
  if (!source) return null;
  const words = [
      ...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || []),
    ].slice(0, 80),
    rank = (p) =>
      words.reduce(
        (n, w) =>
          n +
          (p.toLowerCase().includes(w) ? 10 : 0) +
          (source.files[p]
            .slice(0, runtime.projectSearchPreviewChars)
            .toLowerCase()
            .includes(w)
            ? 1
            : 0),
        0,
      );
  let size = 0;
  const files = {},
    omitted = [];
  const scores = new Map(Object.keys(source.files).map((p) => [p, rank(p)]));
  const paths = Object.keys(source.files).sort(
    (a, b) => scores.get(b) - scores.get(a) || a.localeCompare(b),
  );
  for (const p of paths) {
    const n = JSON.stringify([p, source.files[p]]).length;
    if (size + n > runtime.projectContextMaxBytes) {
      omitted.push(p);
      continue;
    }
    size += n;
    files[p] = source.files[p];
  }
  const manifest = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((p) => [p, hash(files[p])]),
  );
  return {
    files,
    omitted,
    provenance: {
      digest: source.digest,
      scannedAt: source.scannedAt,
      kind: source.kind,
      manifest,
      totalFiles: paths.length,
      omittedCount: omitted.length,
    },
  };
}
export function createProjectSources({
  store,
  mode,
  roots = process.env.CODEWITH_PROJECT_ROOTS || "",
}) {
  const allowedRoots = Array.isArray(roots)
    ? roots
    : roots
      ? roots.split(path.delimiter)
      : [];
  const current = (wid, uid) => {
    store.workspace(wid, uid);
    return store.user(uid).projectSources?.[wid] || null;
  };
  function resolveRoot(value, { browsing = false } = {}) {
    if (
      typeof value === "string" &&
      process.platform !== "win32" &&
      /^[a-zA-Z]:[\\/]/.test(value) &&
      fs.existsSync("/mnt/" + value[0].toLowerCase())
    )
      value =
        "/mnt/" +
        value[0].toLowerCase() +
        "/" +
        value.slice(3).replaceAll("\\", "/");
    if (
      typeof value !== "string" ||
      !path.isAbsolute(value) ||
      value.length > 2000
    )
      throw problem("서버에서 접근할 수 있는 절대 폴더 경로를 입력하세요.");
    let root;
    try {
      root = fs.realpathSync(value);
    } catch {
      throw problem(
        "프로젝트 폴더를 열 수 없습니다. 서버 기준 경로와 읽기 권한을 확인하세요.",
      );
    }
    if (
      (!browsing &&
        (root === path.parse(root).root || root === os.homedir())) ||
      inside(store.dir, root) ||
      root.split(path.sep).some((x) => x.startsWith("."))
    )
      throw problem(
        "프로젝트 전용 폴더를 선택하세요. 시스템·인증·CodeWith 데이터 폴더는 연결할 수 없습니다.",
      );
    if (
      mode !== "personal" &&
      !allowedRoots.some((p) => {
        try {
          return inside(fs.realpathSync(p), root);
        } catch {
          return false;
        }
      })
    )
      throw problem(
        "운영자가 CODEWITH_PROJECT_ROOTS로 허용한 폴더만 연결할 수 있습니다.",
        403,
      );
    if (!fs.statSync(root).isDirectory())
      throw problem("프로젝트 폴더를 선택하세요.");
    return root;
  }
  async function browse(wid, uid, value = "") {
    store.workspace(wid, uid);
    if (mode !== "personal") store.workspace(wid, uid, false, true);
    const candidates =
      mode === "personal"
        ? [
            process.cwd(),
            os.homedir(),
            ...(process.platform === "win32"
              ? Array.from(
                  { length: 26 },
                  (_, i) => String.fromCharCode(65 + i) + ":\\",
                )
              : ["/"]),
          ]
        : allowedRoots;
    const roots = [
      ...new Set(
        candidates.flatMap((candidate) => {
          try {
            return [resolveRoot(candidate, { browsing: true })];
          } catch {
            return [];
          }
        }),
      ),
    ];
    if (!roots.length)
      throw problem("탐색할 수 있는 작업 폴더가 없습니다.", 403);
    if (!value)
      return {
        path: null,
        parent: null,
        roots,
        folders: [],
        selectable: false,
      };
    const root = resolveRoot(value, { browsing: true });
    let entries;
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      throw problem(
        "폴더 목록을 읽을 수 없습니다. 읽기 권한을 확인하세요.",
        403,
      );
    }
    const folders = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const target = resolveRoot(path.join(root, entry.name), {
          browsing: true,
        });
        folders.push({ name: entry.name, path: target });
      } catch {
        /* Hide folders outside the permitted boundary. */
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    let parent = null,
      selectable = false;
    if (path.dirname(root) !== root) {
      try {
        parent = resolveRoot(path.dirname(root), { browsing: true });
      } catch {
        /* An allowed root has no accessible parent. */
      }
    }
    try {
      resolveRoot(root);
      selectable = true;
    } catch {
      /* Navigation-only folder. */
    }
    return {
      path: root,
      parent,
      roots,
      folders: folders.slice(0, 500),
      truncated: folders.length > 500,
      selectable,
    };
  }
  function scan(root, excluded) {
    const files = {};
    let entries = 0,
      total = 0,
      skipped = 0;
    function visit(dir, relative = "", depth = 0) {
      if (depth > 40) throw problem("폴더 깊이가 너무 큽니다.");
      for (const ent of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (++entries > SOURCE_LIMITS.entries)
          throw problem("파일이 너무 많습니다. 하위 폴더를 연결하세요.");
        const p = relative ? relative + "/" + ent.name : ent.name;
        if (!sourceAllowed(p, excluded, ent.isDirectory())) {
          skipped++;
          continue;
        }
        const target = path.join(dir, ent.name);
        if (ent.isSymbolicLink()) {
          skipped++;
          continue;
        }
        if (ent.isDirectory()) {
          const real = fs.realpathSync(target);
          if (!inside(root, real))
            throw problem("프로젝트 밖의 폴더는 읽을 수 없습니다.");
          visit(target, p, depth + 1);
          continue;
        }
        if (!ent.isFile()) {
          skipped++;
          continue;
        }
        const real = fs.realpathSync(target);
        if (!inside(root, real) || inside(store.dir, real))
          throw problem("프로젝트 밖의 파일은 읽을 수 없습니다.");
        const fd = fs.openSync(
          target,
          fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
        );
        try {
          const st = fs.fstatSync(fd);
          if (!st.isFile() || st.size > SOURCE_LIMITS.fileBytes) {
            skipped++;
            continue;
          }
          const buffer = Buffer.alloc(SOURCE_LIMITS.fileBytes + 1),
            length = fs.readSync(fd, buffer, 0, buffer.length, 0);
          if (length > SOURCE_LIMITS.fileBytes) {
            skipped++;
            continue;
          }
          const buf = buffer.subarray(0, length);
          let text;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
          } catch {
            skipped++;
            continue;
          }
          if (text.includes("\0")) {
            skipped++;
            continue;
          }
          total += buf.length;
          if (
            total > SOURCE_LIMITS.totalBytes ||
            Object.keys(files).length >= SOURCE_LIMITS.files
          )
            throw problem(
              "분석 범위가 500개 또는 2 MB를 넘었습니다. 제외 경로를 추가하거나 하위 폴더를 연결하세요.",
            );
          files[p] = text;
        } finally {
          fs.closeSync(fd);
        }
      }
    }
    visit(root);
    return { files, skipped };
  }
  async function save(wid, uid, b) {
    store.workspace(wid, uid);
    const old = current(wid, uid);
    if ((b.revision ?? null) !== (old?.revision ?? null))
      throw problem(
        "프로젝트 연결이 변경되었습니다. 설정을 다시 열어 주세요.",
        409,
      );
    if (!["server", "browser", "upload"].includes(b.kind))
      throw problem("프로젝트 연결 방식을 선택하세요.");
    let excluded, files, result, root;
    try {
      excluded = exclusions(b.excluded || []);
      if (b.kind === "server") {
        if (mode !== "personal") store.workspace(wid, uid, false, true);
        root = resolveRoot(b.path);
        result = scan(root, excluded);
      }
      files = validateSourceFiles(result?.files || b.files, excluded);
    } catch (e) {
      if (e.status) throw e;
      throw problem(e.message);
    }
    if (typeof b.label !== "string" || !b.label.trim() || b.label.length > 160)
      throw problem("프로젝트 폴더 이름을 확인하세요.");
    const digest = hash(
        JSON.stringify(
          Object.keys(files)
            .sort()
            .map((p) => [p, files[p]]),
        ),
      ),
      source = {
        kind: b.kind,
        label: b.label.trim(),
        ...(root ? { path: root } : {}),
        excluded,
        files,
        digest,
        scannedAt: new Date().toISOString(),
        revision: randomUUID(),
        skipped: result?.skipped || 0,
      };
    const u = store.user(uid);
    u.projectSources ??= {};
    u.projectSources[wid] = source;
    await store.persist();
    return sourceSummary(source);
  }
  async function refresh(wid, uid) {
    const s = current(wid, uid);
    if (!s || s.kind !== "server") return s;
    if (mode !== "personal") store.workspace(wid, uid, false, true);
    await save(wid, uid, { ...s, revision: s.revision });
    return current(wid, uid);
  }
  async function remove(wid, uid, revision) {
    const s = current(wid, uid);
    if (revision !== (s?.revision ?? null))
      throw problem("프로젝트 연결이 변경되었습니다. 다시 확인하세요.", 409);
    delete store.user(uid).projectSources?.[wid];
    await store.persist();
  }
  return {
    current,
    executionPath(wid, uid) {
      store.workspace(wid, uid, true);
      if (mode !== "personal") store.workspace(wid, uid, false, true);
      const source = current(wid, uid);
      return source?.kind === "server" ? resolveRoot(source.path) : null;
    },
    browse,
    save,
    refresh,
    remove,
    summary(wid, uid) {
      const source = current(wid, uid);
      let available = true;
      if (source?.kind === "server") {
        try {
          const root = resolveRoot(source.path);
          fs.accessSync(root, fs.constants.R_OK);
        } catch {
          available = false;
        }
      }
      return {
        connection: sourceSummary(source),
        available,
        serverAvailable:
          mode === "personal" ||
          (allowedRoots.length > 0 &&
            store.workspace(wid, uid).ownerId === uid),
      };
    },
    context: sourceContext,
  };
}
