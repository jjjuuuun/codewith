import { renderPlanHTML } from "../shared/plans.mjs";
import { renderPlanMarkdown } from "./plan-renderer.mjs";
import { AUTH_POLICY } from "../shared/config.mjs";
import { LIMITS } from "../shared/config.mjs";
import { themedPlanPreview } from "../shared/plan-preview.mjs";
import { createProjectSources } from "./project-source.mjs";
import { deploymentConfig, listenConfig } from "./deployment.mjs";
import { createAccess } from "./access.mjs";
import { createAIService } from "./ai-service.mjs";
import { VERSION } from "./version.mjs";
import { parseRoute } from "../shared/routes.mjs";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Store, id, hash, stamp } from "./store.mjs";
import {
  copy,
  problem,
  importDocument,
  exportDocument,
  validateDocument,
} from "../shared/schema.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function createApplication({
  dataDir = process.env.CODEWITH_DATA_DIR || path.join(root, ".codewith"),
  databaseUrl,
  importFile,
  adapterPath,
  projectRoots,
  frontendMiddleware,
  codexPool,
  claudeCode,
  openai,
  claude,
  tls,
  ...deploymentOptions
} = {}) {
  const config = deploymentConfig(deploymentOptions);
  const store = await Store.open(dataDir, {
    databaseUrl,
    importFile,
    adapterPath,
  });
  let access;
  try {
    access = await createAccess({ store, config, ...deploymentOptions });
  } catch (e) {
    await store.close();
    throw e;
  }
  const sources = createProjectSources({
    store,
    mode: config.mode,
    roots: projectRoots,
  });
  const ai = createAIService({
    store,
    sources,
    dataDir: store.dir,
    codexPool,
    claudeCode,
    openai,
    claude,
  });
  const json = (res, status, value) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  async function body(req) {
    // Decode across network chunks so split Korean/emoji bytes stay intact.
    req.setEncoding("utf8");
    let text = "";
    for await (const b of req) {
      text += b;
      if (Buffer.byteLength(text) > LIMITS.requestBytes)
        throw problem("요청 크기는 12 MB 이하이어야 합니다.", 413);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw problem("JSON 형식이 올바르지 않습니다.");
    }
  }
  function session(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("codewith_session="))
      ?.slice(17);
    const s = store.db.sessions.find(
      (s) => s.token === hash(token || "") && s.expires > Date.now(),
    );
    return s && (config.mode !== "personal" || s.userId === access.personal.id)
      ? store.user(s.userId)
      : null;
  }
  async function login(res, u) {
    const token = randomBytes(32).toString("hex");
    store.db.sessions = store.db.sessions.filter((s) => s.expires > Date.now());
    store.db.sessions.push({
      token: hash(token),
      userId: u.id,
      expires: Date.now() + AUTH_POLICY.sessionSeconds * 1000,
    });
    await store.persist();
    res.setHeader(
      "Set-Cookie",
      `codewith_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${AUTH_POLICY.sessionSeconds}${config.origin?.startsWith("https:") ? "; Secure" : ""}`,
    );
  }
  function cleanString(s, max = 200) {
    if (typeof s !== "string" || !s.trim() || s.length > max)
      throw problem("입력 내용을 확인해 주세요.");
    return s.trim();
  }
  const handleRequest = async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost"),
        p = url.pathname,
        method = req.method;
      access.guard(req);
      const hostName = new URL("http://" + req.headers.host).hostname;
      const allowed = config.origin
        ? new URL(config.origin).host === req.headers.host
        : /^(localhost|127\.0\.0\.1|\[::1\]|(?:[0-9]{1,3}\.){3}[0-9]{1,3})$/.test(
            hostName,
          );
      if (!allowed)
        throw problem("서버 도메인을 CODEWITH_ORIGIN으로 설정하세요.", 403);
      if (p.startsWith("/api/") && !["GET", "HEAD"].includes(method)) {
        const expected = config.origin || `http://${req.headers.host}`;
        if (
          req.headers["x-codewith"] !== "1" ||
          (req.headers.origin && req.headers.origin !== expected)
        )
          throw problem("동일 출처 요청만 허용합니다.", 403);
      }
      if (p === "/api/health")
        return json(res, 200, {
          name: "codewith",
          version: VERSION,
          storage: store.persistence.kind,
          storageHealthy: !store.failure,
          mode: config.mode,
        });
      if (["/api/auth/register", "/api/auth/login"].includes(p))
        throw problem(
          "아이디·비밀번호 로그인은 지원하지 않습니다. CodeWith 로그인 수단을 사용하세요.",
          410,
        );
      store.assertHealthy();
      const u = p.startsWith("/api/") ? session(req) : null;
      if (
        ["/api/auth/key/challenge", "/api/auth/key/verify"].includes(p) &&
        method === "POST"
      ) {
        throw problem(
          "이전 로컬 브리지 인증은 지원하지 않습니다. 로그인 키나 패스키를 사용하세요.",
          410,
        );
      }
      if (p.startsWith("/api/auth/") && p !== "/api/auth/logout")
        return await access.handle(
          req,
          res,
          url,
          method === "POST" ? await body(req) : {},
          u,
          login,
          json,
        );
      if (p.startsWith("/api/ai/")) {
        if (!u) throw problem("CodeWith에 먼저 로그인하세요.", 401);
        store.assertHealthy();
        return await ai.handle(
          req,
          res,
          url,
          ["POST", "PATCH"].includes(method) ? await body(req) : {},
          u,
          login,
          json,
        );
      }
      if (p.startsWith("/api/") && !u)
        throw problem("로그인이 필요합니다.", 401);
      if (p === "/api/me")
        return json(res, 200, {
          user: store.publicUser(u),
          workspaces: store.list(u.id),
          settings: u.aiSettings || null,
          deployment: access.publicConfig(),
        });
      if (p === "/api/preferences" && method === "GET")
        return json(res, 200, {
          instructions: u.commonSettings?.instructions || "",
          revision: u.commonSettings?.revision || 0,
        });
      if (p === "/api/preferences" && method === "POST") {
        const b = await body(req);
        if (
          typeof b.instructions !== "string" ||
          b.instructions.length > LIMITS.textChars
        )
          throw problem("개인 공통 지침은 20,000자 이하로 작성하세요.");
        const revision = u.commonSettings?.revision || 0;
        if (b.revision !== revision)
          throw problem(
            "개인 공통 설정이 변경되었습니다. 다시 열어 최신 내용을 확인하세요.",
            409,
          );
        u.commonSettings = {
          instructions: b.instructions,
          revision: revision + 1,
        };
        await store.persist();
        return json(res, 200, u.commonSettings);
      }
      if (p === "/api/profile" && method === "POST") {
        if (config.mode === "personal")
          throw problem("개인용 표시 이름은 PERSONAL입니다.", 403);
        const b = await body(req);
        u.name = cleanString(b.name, 80);
        u.needsProfile = false;
        await store.persist();
        return json(res, 200, { user: store.publicUser(u) });
      }
      if (p === "/api/auth/logout" && method === "POST") {
        if (config.mode === "personal")
          throw problem("개인용 모드는 자동으로 열립니다.", 403);
        store.db.sessions = store.db.sessions.filter((s) => s.userId !== u.id);
        await store.persist();
        res.setHeader(
          "Set-Cookie",
          "codewith_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        );
        return json(res, 200, { ok: true });
      }
      if (p === "/api/workspaces" && method === "GET")
        return json(res, 200, { workspaces: store.list(u.id) });
      if (p === "/api/workspaces" && method === "POST") {
        const b = await body(req),
          doc = b.exchange ? importDocument(b.exchange) : null;
        const w = await store.create(
          u.id,
          doc?.project || cleanString(b.name, 120),
          config.mode !== "personal" && b.visibility === "team"
            ? "team"
            : "private",
          doc,
        );
        return json(res, 201, store.view(w, u.id));
      }
      if (p === "/api/join" && method === "POST") {
        if (config.mode === "personal")
          throw problem(
            "참여 요청은 공유용 또는 서버 운영 모드에서 사용할 수 있습니다.",
            403,
          );
        const b = await body(req),
          w = store.db.workspaces.find(
            (w) =>
              !w.deletedAt &&
              w.inviteCode === b.code &&
              w.visibility === "team",
          );
        if (!w)
          throw problem(
            "초대 코드가 유효하지 않거나 팀 공유가 꺼져 있습니다.",
            404,
          );
        if (store.member(w, u.id))
          return json(res, 200, { joined: true, id: w.id });
        if (
          !w.requests.some((r) => r.userId === u.id && r.status === "pending")
        )
          w.requests.push({
            id: id("join"),
            userId: u.id,
            status: "pending",
            at: stamp(),
          });
        await store.persist();
        return json(res, 200, { pending: true, name: w.document.project });
      }
      const match = p.match(/^\/api\/workspaces\/([^/]+)(?:\/(.*))?$/);
      if (match) {
        const [, wid, rest = ""] = match,
          w = store.workspace(wid, u.id);
        if (!rest && method === "GET")
          return json(res, 200, store.view(w, u.id));
        if (!rest && method === "DELETE") {
          store.workspace(wid, u.id, false, true);
          const b = await body(req);
          await store.remove(wid, u.id, b.base);
          return json(res, 200, { ok: true });
        }
        if (rest === "head")
          return json(res, 200, {
            head: w.head,
            memberCount: w.members.length,
            pending: w.requests.filter((r) => r.status === "pending").length,
          });
        if (rest === "export") return json(res, 200, exportDocument(w));
        const specProposal = rest.match(/^chats\/([^/]+)\/spec$/);
        if (specProposal && method === "POST") {
          const b = await body(req);
          await store.addSpecProposal(wid, u.id, specProposal[1], b.base);
          return json(res, 200, store.view(w, u.id));
        }
        if (rest === "chats" && method === "GET")
          return json(res, 200, {
            messages: store.db.chats.filter(
              (m) =>
                m.userId === u.id &&
                m.workspaceId === wid &&
                !store.db.chatThreads.some(
                  (t) => t.id === m.threadId && t.deletedAt,
                ) &&
                (!url.searchParams.get("spec") ||
                  m.specId === url.searchParams.get("spec")),
            ),
          });
        if (rest.startsWith("commits/") && method === "GET") {
          const c = w.commits.find((c) => c.id === rest.slice(8));
          if (!c) throw problem("커밋이 없습니다.", 404);
          return json(res, 200, c);
        }
        if (rest === "project-source") {
          if (method === "GET")
            return json(res, 200, sources.summary(wid, u.id));
          const b = await body(req);
          if (method === "POST")
            return json(res, 200, {
              connection: await sources.save(wid, u.id, b),
            });
          if (method === "DELETE") {
            await sources.remove(wid, u.id, b.revision);
            return json(res, 200, { connection: null });
          }
        }
        if (rest === "project-source/folders" && method === "GET")
          return json(
            res,
            200,
            await sources.browse(wid, u.id, url.searchParams.get("path") || ""),
          );
        if (rest === "project-source/refresh" && method === "POST") {
          await sources.refresh(wid, u.id);
          return json(res, 200, sources.summary(wid, u.id));
        }
        const specRoute = rest.match(/^specs\/([a-zA-Z0-9_-]+)$/);
        if (specRoute && method === "DELETE")
          return json(
            res,
            200,
            await store.removeSpec(
              wid,
              u.id,
              specRoute[1],
              (await body(req)).base,
            ),
          );
        const completionRoute = rest.match(
          /^requirements\/([a-zA-Z0-9_-]+)\/complete$/,
        );
        if (completionRoute && method === "POST")
          return json(
            res,
            200,
            await store.completeRequirement(
              wid,
              u.id,
              completionRoute[1],
              await body(req),
            ),
          );
        const planRoute = rest.match(
          /^plans\/([^/]+)(?:\/(final|review|plan_[a-z0-9]{24}(?:\.html)?))?$/,
        );
        if (planRoute) {
          const sid = planRoute[1],
            part = planRoute[2],
            s = w.document.specs.find((s) => s.id === sid);
          if (!s) throw problem("명세를 찾을 수 없습니다.", 404);
          if (method === "DELETE" && /^plan_[a-z0-9]{24}$/.test(part || ""))
            return json(
              res,
              200,
              await store.removePlan(
                wid,
                u.id,
                sid,
                part,
                (await body(req)).base,
              ),
            );
          if (method === "GET" && part === "final") {
            const version = s.plans.versions.find(
              (v) => v.id === s.plans.finalVersionId,
            );
            if (!version) throw problem("최종 계획을 먼저 승인하세요.", 404);
            return json(res, 200, {
              workspaceId: wid,
              specId: sid,
              head: w.head,
              version,
              approval: { by: s.plans.selectedBy, at: s.plans.selectedAt },
              codeMatches: store.sourceMatches(w, u.id, version),
              stale:
                version.basis !== store.planBasis(w, s) ||
                store.sourceMatches(w, u.id, version) === false,
            });
          }
          if (method === "GET" && part?.endsWith(".html")) {
            const version = s.plans.versions.find(
              (v) => v.id === part.slice(0, -5),
            );
            if (!version || version.deletedAt)
              throw problem("계획을 찾을 수 없습니다.", 404);
            let responseHTML = version.html;
            if (url.searchParams.get("attempt") === "last") {
              const files =
                version.execution?.loop?.checkpoint?.latest?.answer?.files;
              if (!files?.length)
                throw problem("저장된 마지막 시도가 없습니다.", 404);
              responseHTML =
                files.length === 1 && files[0].path === "plan.html"
                  ? files[0].content
                  : renderPlanHTML(
                      {
                        title: version.title + " · 마지막 시도 (미승인)",
                        requirements: files.map((f) => ({
                          id: f.path.slice(0, -5),
                          title:
                            s.requirements.find(
                              (r) => r.id + ".html" === f.path,
                            )?.title || f.path.slice(0, -5),
                        })),
                      },
                      files,
                      renderPlanMarkdown,
                    );
            }
            res.setHeader("X-Frame-Options", "SAMEORIGIN");
            res.setHeader(
              "Content-Security-Policy",
              "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src about:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
            );
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
              ...(url.searchParams.has("download")
                ? {
                    "Content-Disposition": `attachment; filename="${version.id}.html"`,
                  }
                : {}),
            });
            return res.end(
              url.searchParams.has("download")
                ? responseHTML
                : themedPlanPreview(
                    responseHTML,
                    url.searchParams.get("theme"),
                  ),
            );
          }
          if (method === "POST") {
            store.workspace(wid, u.id, true);
            const b = await body(req);
            if (part === "final" && b.versionId)
              await sources.refresh(wid, u.id);
            if (part === "review")
              await store.reviewPlanStep(wid, u.id, sid, b);
            else if (part === "final")
              await store.selectPlan(wid, u.id, sid, b.versionId, b.base);
            else if (!part)
              await store.savePlan(wid, u.id, sid, {
                base: b.base,
                parentVersionId: b.parentVersionId,
                html: b.html,
                title: b.title,
              });
            else throw problem("계획 API를 찾을 수 없습니다.", 404);
            return json(res, 200, store.view(w, u.id));
          }
        }
        store.workspace(wid, u.id, true);
        if (rest === "settings" && method === "POST") {
          store.workspace(wid, u.id, false, true);
          const b = await body(req),
            doc = copy(w.document);
          doc.project = cleanString(b.name, 120);
          if (
            typeof b.purpose !== "string" ||
            b.purpose.length > LIMITS.textChars
          )
            throw problem("프로젝트 목적은 20,000자 이하로 작성하세요.");
          doc.projectSpec.purpose = b.purpose;
          await store.commit(
            w,
            u.id,
            doc,
            "워크스페이스 기본 설정 수정",
            b.base,
          );
          return json(res, 200, store.view(w, u.id));
        }
        if (rest === "name" && method === "POST") {
          store.workspace(wid, u.id, false, true);
          const b = await body(req),
            doc = copy(w.document);
          doc.project = cleanString(b.name, 120);
          await store.commit(w, u.id, doc, "워크스페이스 이름 수정", b.base);
          return json(res, 200, store.view(w, u.id));
        }
        if (!rest && method === "PATCH") {
          const b = await body(req);
          await store.commit(w, u.id, b.document, b.message, b.base);
          return json(res, 200, store.view(w, u.id));
        }
        if (rest === "restore" && method === "POST") {
          const b = await body(req),
            c = w.commits.find((c) => c.id === b.commitId);
          if (!c) throw problem("복원할 커밋이 없습니다.", 404);
          await store.commit(
            w,
            u.id,
            c.snapshot,
            `복원: ${c.message}`,
            b.base,
            { restoreOf: c.id },
          );
          return json(res, 200, store.view(w, u.id));
        }
        if (rest === "sharing" && method === "POST") {
          if (config.mode === "personal")
            throw problem("공유용 모드에서 팀 공유를 설정하세요.", 403);
          store.workspace(wid, u.id, false, true);
          const b = await body(req);
          w.visibility = b.visibility === "team" ? "team" : "private";
          if (b.rotate) w.inviteCode = randomBytes(18).toString("hex");
          await store.persist();
          return json(res, 200, store.view(w, u.id));
        }
        if (rest === "members" && method === "POST") {
          store.workspace(wid, u.id, false, true);
          const b = await body(req);
          if (b.requestId) {
            const r = w.requests.find(
              (r) => r.id === b.requestId && r.status === "pending",
            );
            if (!r) throw problem("처리된 요청입니다.", 409);
            r.status = b.approve ? "approved" : "rejected";
            if (b.approve && !store.member(w, r.userId))
              w.members.push({
                userId: r.userId,
                role: b.role === "viewer" ? "viewer" : "editor",
                joinedAt: stamp(),
              });
          } else {
            if (b.userId === w.ownerId)
              throw problem("슈퍼관리자는 변경할 수 없습니다.");
            const m = store.member(w, b.userId);
            if (!m) throw problem("멤버가 없습니다.", 404);
            if (b.remove)
              w.members = w.members.filter((m) => m.userId !== b.userId);
            else m.role = b.role === "viewer" ? "viewer" : "editor";
          }
          await store.persist();
          return json(res, 200, store.view(w, u.id));
        }
      }
      if (p.startsWith("/api/")) throw problem("API를 찾을 수 없습니다.", 404);
      if (method !== "GET" && method !== "HEAD")
        throw problem("지원하지 않는 요청입니다.", 405);
      // Vite handles only frontend resources; API, authentication and documents
      // continue through the existing server routes on the same origin.
      if (frontendMiddleware && p === "/text-editor.js") {
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        res.end('export * from "/src/rich-editor.js";');
        return;
      }
      if (
        frontendMiddleware &&
        (parseRoute(p) ||
          p.startsWith("/src/") ||
          p.startsWith("/shared/") ||
          p === "/config/runtime.defaults.json" ||
          (p === "/logo.svg" && url.searchParams.has("import")) ||
          p.startsWith("/@") ||
          p.startsWith("/node_modules/"))
      )
        return frontendMiddleware(req, res, () => {
          res.writeHead(404);
          res.end();
        });
      if (!frontendMiddleware && (parseRoute(p) || p.startsWith("/assets/"))) {
        const asset = parseRoute(p) ? "index.html" : p.slice(1),
          base = path.join(root, "dist"),
          file = path.resolve(base, asset);
        if (
          !file.startsWith(base + path.sep) ||
          !fs.existsSync(file) ||
          !fs.statSync(file).isFile()
        )
          throw problem(
            "화면 파일이 없습니다. npm run build를 실행해 주세요.",
            404,
          );
        const mime =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
          }[path.extname(file)] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": mime + "; charset=utf-8",
          "Cache-Control":
            asset === "index.html"
              ? "no-cache"
              : "public, max-age=31536000, immutable",
        });
        res.end(fs.readFileSync(file));
        return;
      }
      const assets = {
        "/branding.js": "public/branding.js",
        "/controls.js": "public/controls.js",
        "/controls.css": "src/styles/controls.css",
        "/theme.js": "public/theme.js",
        "/theme.css": "src/styles/theme.css",
        "/source-policy.js": "shared/source-policy.mjs",
        "/completion.js": "shared/completion.mjs",
        "/shared-plans.js": "shared/plans.mjs",
        "/text-editor.js": "public/text-editor.js",
        "/auth/wait": "public/auth-wait.html",
        "/auth-wait.js": "public/auth-wait.js",
        "/vendor/webauthn.js":
          "node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js",
        "/style.css": "src/styles/style.css",
        "/markdown.js": "public/markdown.js",
        "/routes.js": "shared/routes.mjs",
        "/logo.svg": "public/logo.svg",
        "/templates/empty.json": "templates/empty.json",
        "/templates/workspace.json": "templates/workspace.json",
      };
      const asset = assets[p];
      if (!asset) throw problem("페이지가 없습니다.", 404);
      const file = path.join(root, asset);
      const mime = {
        ".mjs": "text/javascript",
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".json": "application/json",
      }[path.extname(file)];
      res.writeHead(200, {
        "Content-Type": mime + "; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(fs.readFileSync(file));
    } catch (e) {
      if (!res.headersSent)
        json(res, e.status || 500, {
          error: e.status
            ? e.message
            : "요청을 처리하지 못했습니다. 서버 상태와 연결 설정을 확인하세요.",
        });
      else res.end();
      if (!e.status) console.error("[CodeWith]", e.message);
    }
  };
  const server = tls
    ? https.createServer(tls, handleRequest)
    : http.createServer(handleRequest);
  let closeStorage;
  const closed = new Promise((r) => {
    closeStorage = r;
  });
  server.on("close", () => {
    access.close();
    ai.close();
    Promise.resolve(store.close())
      .catch(() => console.error("[CodeWith] 저장소 연결 종료 실패"))
      .finally(closeStorage);
  });
  return { server, store, closed, config, access };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    value = (flag, def) =>
      args.includes(flag) ? args[args.indexOf(flag) + 1] : def;
  const config = deploymentConfig({
      mode: value("--mode", process.env.CODEWITH_MODE),
    }),
    { host, port } = listenConfig(config, args);
  const certPath = process.env.CODEWITH_TLS_CERT;
  const keyPath = process.env.CODEWITH_TLS_KEY;
  if (!!certPath !== !!keyPath)
    throw Error("CODEWITH_TLS_CERT와 CODEWITH_TLS_KEY를 함께 설정하세요.");
  const tls = certPath
    ? { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }
    : undefined;
  const { server, store, closed, access } = await createApplication({
    mode: config.mode,
    tls,
    databaseUrl: value("--database", process.env.CODEWITH_DATABASE_URL),
  });
  server.listen(port, host, () => {
    console.log(
      `CodeWith: ${tls ? "https" : "http"}://${host}:${port} · mode=${config.mode} · storage=${store.persistence.kind}`,
    );
    if (access.publicConfig().setupRequired)
      console.log(`공유용 초기 설정 키 파일: ${access.setupFile}`);
  });
  const stop = () =>
    server.close(async () => {
      await closed;
      process.exit(0);
    });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
