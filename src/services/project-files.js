import { t as __t } from "../i18n/index.js";
import {
  SOURCE_LIMITS,
  sourceAllowed,
  validateSourceFiles,
} from "../../shared/source-policy.mjs";
export const memory = new Map();
export async function handles(key, value, remove = false) {
  try {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("codewith-project-folders", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("handles");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(
            "handles",
            value !== undefined || remove ? "readwrite" : "readonly",
          ),
          store = tx.objectStore("handles"),
          r = remove
            ? store.delete(key)
            : value !== undefined
              ? store.put(value, key)
              : store.get(key);
        tx.oncomplete = () => resolve(r.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}
export async function collect(handle, excluded) {
  const files = {};
  let count = 0,
    total = 0;
  async function walk(dir, prefix = "") {
    for await (const [name, item] of dir.entries()) {
      if (++count > SOURCE_LIMITS.entries)
        throw Error(__t("폴더가 너무 큽니다. 하위 폴더를 선택하세요."));
      const p = prefix + name;
      if (!sourceAllowed(p, excluded, item.kind === "directory")) continue;
      if (item.kind === "directory") {
        if (p.split("/").length > 40)
          throw Error(__t("폴더 깊이가 너무 큽니다."));
        await walk(item, p + "/");
        continue;
      }
      const f = await item.getFile();
      if (f.size > SOURCE_LIMITS.fileBytes) continue;
      const text = new TextDecoder("utf-8", { fatal: true });
      let content;
      try {
        content = text.decode(await f.arrayBuffer());
      } catch {
        continue;
      }
      if (content.includes("\0")) continue;
      total += f.size;
      if (
        total > SOURCE_LIMITS.totalBytes ||
        Object.keys(files).length >= SOURCE_LIMITS.files
      )
        throw Error(
          __t(
            "500개 또는 2 MB를 넘었습니다. 제외 경로를 추가하거나 하위 폴더를 선택하세요.",
          ),
        );
      files[p] = content;
    }
  }
  await walk(handle);
  return validateSourceFiles(files, excluded);
}
export async function uploaded(list, excluded) {
  const files = {};
  let total = 0;
  for (const f of list) {
    const p = f.webkitRelativePath.split("/").slice(1).join("/");
    if (!sourceAllowed(p, excluded) || f.size > SOURCE_LIMITS.fileBytes)
      continue;
    total += f.size;
    if (total > SOURCE_LIMITS.totalBytes)
      throw Error(__t("폴더가 2 MB를 넘었습니다. 제외 경로를 추가하세요."));
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await f.arrayBuffer(),
      );
    } catch {
      continue;
    }
    if (!text.includes("\0")) files[p] = text;
  }
  return validateSourceFiles(files, excluded);
}

export async function inspectProjectSource(c, handle, available = true) {
  if (!c) return { state: "disconnected", message: "" };
  if (!available)
    return {
      state: "unavailable",
      message: __t(
        "저장된 프로젝트 경로에 접근할 수 없습니다. 경로와 읽기 권한을 확인하세요.",
      ),
    };
  if (c.kind === "upload")
    return {
      state: "snapshot",
      message: __t(
        "업로드한 코드 사본을 사용합니다. 최신 코드는 폴더를 다시 선택해 갱신하세요.",
      ),
    };
  if (c.kind !== "browser") return { state: "connected", message: "" };
  if (!handle)
    return {
      state: "missing",
      message: __t(
        "이 브라우저에 폴더 접근 정보가 없습니다. 재연결 버튼에서 폴더를 다시 선택하세요.",
      ),
    };
  try {
    if ((await handle.queryPermission({ mode: "read" })) !== "granted")
      return {
        state: "permission",
        message: __t(
          "폴더 읽기 권한을 다시 허용해야 합니다. 이전 폴더 재연결을 눌러 주세요.",
        ),
      };
    await handle.entries().next();
    return { state: "connected", message: "" };
  } catch {
    return {
      state: "unavailable",
      message: __t(
        "폴더를 읽을 수 없습니다. 폴더가 이동·삭제되었거나 접근 권한이 변경되었는지 확인하세요.",
      ),
    };
  }
}
