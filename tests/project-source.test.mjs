import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { sourceContext } from "../server/project-source.mjs";
import { sample, TestPool } from "./fixtures.mjs";
function client(origin) {
  const cookies = new Map();
  return async (p, body, method = body ? "POST" : "GET") => {
    const r = await fetch(origin + "/api" + p, {
      method,
      headers: {
        Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
        "X-CodeWith": "1",
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const c of r.headers.getSetCookie()) {
      const [k, ...v] = c.split(";")[0].split("=");
      cookies.set(k, v.join("="));
    }
    return {
      status: r.status,
      value: r.headers.get("content-type")?.includes("application/json")
        ? await r.json()
        : await r.text(),
    };
  };
}
for (const databaseUrl of [undefined, "sqlite:sources.sqlite"])
  test(
    "private source connection reads code for plans and chat, detects changes, survives restart " +
      (databaseUrl || "file"),
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-")),
        dataDir = path.join(root, "data"),
        project = path.join(root, "project"),
        pool = new TestPool();
      fs.mkdirSync(project);
      fs.mkdirSync(path.join(project, "src"));
      fs.mkdirSync(path.join(project, "target"));
      fs.writeFileSync(
        path.join(project, "src/Registration.java"),
        "class Registration { boolean same(String a,String b){return a==b;} }",
      );
      fs.writeFileSync(path.join(project, ".env"), "SECRET=do-not-read");
      fs.writeFileSync(
        path.join(project, "target/Hidden.java"),
        "secret-build",
      );
      fs.writeFileSync(path.join(project, "pom.xml"), "<project/>");
      fs.symlinkSync(
        path.join(project, ".env"),
        path.join(project, "escape.java"),
      );
      let app;
      async function start() {
        app = await createApplication({
          dataDir,
          databaseUrl,
          codexPool: pool,
        });
        await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
        const c = client("http://127.0.0.1:" + app.server.address().port);
        await c("/auth/personal", {});
        return c;
      }
      async function stop() {
        await new Promise((r) => app.server.close(r));
        await app.closed;
      }
      try {
        let c = await start(),
          w = (await c("/workspaces", { exchange: sample() })).value;
        const url = "/workspaces/" + w.id,
          source = url + "/project-source";
        const listing = await c(
          source + "/folders?path=" + encodeURIComponent(project),
        );
        assert.equal(listing.status, 200);
        assert.equal(listing.value.path, fs.realpathSync(project));
        assert.equal(listing.value.selectable, true);
        assert.deepEqual(
          listing.value.folders.map((f) => f.name),
          ["src", "target"],
        );
        const parentListing = await c(
          source + "/folders?path=" + encodeURIComponent(root),
        );
        assert(!parentListing.value.folders.some((f) => f.path === dataDir));
        assert.equal(
          (await c(source + "/folders?path=" + encodeURIComponent(dataDir)))
            .status,
          400,
        );
        assert.equal(
          (
            await c(
              source +
                "/folders?path=" +
                encodeURIComponent(project + "/missing"),
            )
          ).status,
          400,
        );
        assert.equal((await c(source)).value.connection, null);
        let r = await c(source, {
          kind: "server",
          path: project,
          label: "프로젝트",
          revision: null,
        });
        assert.equal(r.status, 200, JSON.stringify(r.value));
        assert.deepEqual(r.value.connection.paths, [
          "pom.xml",
          "src/Registration.java",
        ]);
        assert.equal(r.value.connection.files, undefined);
        assert.equal((await c(url)).value.head, w.head);
        assert.deepEqual((await c(url)).value.document.files, {});
        assert.equal(
          (
            await c(source, {
              kind: "server",
              path: project,
              label: "race",
              revision: null,
            })
          ).status,
          409,
        );
        await c("/ai/start", { provider: "codex" });
        await c("/ai/login", { provider: "codex" });
        await c("/ai/finish", {});
        r = await c("/ai/plan", {
          workspaceId: w.id,
          specId: "SPEC-REG",
          base: w.head,
        });
        assert.equal(r.status, 200);
        assert.match(r.value, /"type":"answer"/);
        assert(pool.calls.at(-1).prompt.includes("return a==b;"));
        assert(!pool.calls.at(-1).prompt.includes("do-not-read"));
        w = (await c(url)).value;
        const version = w.document.specs[0].plans.versions[0];
        assert(version.codeSource.manifest["src/Registration.java"]);
        assert.match(version.html, /코드 분석 기준/);
        assert.equal(w.planCodeMatches[version.id], true);
        assert(
          !JSON.stringify((await c(url + "/export")).value).includes(project),
        );
        await c("/ai/chat", {
          workspaceId: w.id,
          specId: "SPEC-REG",
          base: w.head,
          message: "Registration의 비교를 검토해줘",
        });
        assert(pool.calls.at(-1).prompt.includes("return a==b;"));
        fs.writeFileSync(
          path.join(project, "src/Registration.java"),
          "class Registration { boolean same(String a,String b){return a.equals(b);} }",
        );
        assert.equal(
          (
            await c(url + "/plans/SPEC-REG/final", {
              base: w.head,
              versionId: version.id,
            })
          ).status,
          409,
        );
        w = (await c(url)).value;
        assert.equal(w.planCodeMatches[version.id], false);
        assert.equal(
          fs.readFileSync(path.join(project, "src/Registration.java"), "utf8"),
          "class Registration { boolean same(String a,String b){return a.equals(b);} }",
        );
        const provider = [...pool.clients.values()].find((x) => x.connected),
          originalRun = provider.run.bind(provider);
        provider.run = async (opts) => {
          fs.appendFileSync(
            path.join(project, "src/Registration.java"),
            " // changed during plan",
          );
          return originalRun(opts);
        };
        const raced = await c("/ai/plan", {
          workspaceId: w.id,
          specId: "SPEC-REG",
          base: w.head,
        });
        assert.match(raced.value, /계획 작성 중 프로젝트 코드가 변경/);
        assert.equal(
          (await c(url)).value.document.specs[0].plans.versions.length,
          1,
        );
        provider.run = originalRun;
        const before = await c(source);
        await stop();
        c = await start();
        assert.equal(
          (await c(source)).value.connection.digest,
          before.value.connection.digest,
        );
        assert.equal((await c(source)).value.connection.path, project);
        await c(
          source,
          { revision: (await c(source)).value.connection.revision },
          "DELETE",
        );
        assert.equal((await c(source)).value.connection, null);
        assert(fs.existsSync(path.join(project, "src/Registration.java")));
        assert.equal(
          (await c(url)).value.document.specs[0].plans.versions.length,
          1,
        );
      } finally {
        if (app?.server.listening) await stop();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
test("server allowlist, per-user source privacy, browser filters and conflicts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-source-acl-")),
    project = path.join(root, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "Code.java"), "class Code {}");
  const app = await createApplication({
    dataDir: path.join(root, "data"),
    mode: "server",
    projectRoots: [project],
    codexPool: new TestPool(),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port,
    a = client(base),
    b = client(base),
    outside = client(base);
  try {
    await a("/auth/key/create", { name: "owner" });
    await b("/auth/key/create", { name: "member" });
    await outside("/auth/key/create", { name: "outside" });
    let w = (await a("/workspaces", { exchange: sample(), visibility: "team" }))
      .value;
    const url = "/workspaces/" + w.id,
      source = url + "/project-source";
    await b("/join", { code: w.inviteCode });
    w = (await a(url)).value;
    await a(url + "/members", {
      requestId: w.requests[0].id,
      approve: true,
      role: "viewer",
    });
    assert.equal((await outside(source)).status, 403);
    assert.equal((await outside(source + "/folders")).status, 403);
    assert.equal((await b(source + "/folders")).status, 403);
    assert.equal(
      (await a(source + "/folders?path=" + encodeURIComponent(root))).status,
      403,
    );
    const browseRoots = await a(source + "/folders");
    assert.equal(browseRoots.status, 200);
    assert.deepEqual(browseRoots.value.roots, [fs.realpathSync(project)]);
    const browseProject = await a(
      source + "/folders?path=" + encodeURIComponent(project),
    );
    assert.equal(browseProject.status, 200);
    assert.equal(browseProject.value.parent, null);

    assert.equal(
      (await b(source, { kind: "server", path: project, label: "forbidden" }))
        .status,
      403,
    );
    assert.equal(
      (await a(source, { kind: "server", path: root, label: "outside" }))
        .status,
      403,
    );
    assert.equal(
      (await a(source, { kind: "server", path: project, label: "owner" }))
        .status,
      200,
    );
    assert.equal((await b(source)).value.connection, null);
    assert.equal((await b(url)).value.projectSource, null);
    assert.equal(
      (
        await b(source, {
          kind: "browser",
          label: "member",
          files: { "src/Code.java": "class Member {}" },
          revision: null,
        })
      ).status,
      200,
    );
    assert.equal((await a(source)).value.connection.label, "owner");
    const revision = (await b(source)).value.connection.revision;
    for (const files of [
      { ".env": "bad" },
      { "../secret.java": "bad" },
      { "src/secret.json": "bad" },
      { "src/Binary.java": "x\0y" },
    ])
      assert.equal(
        (await b(source, { kind: "upload", label: "reject", files, revision }))
          .status,
        400,
      );
    assert.equal((await b(source)).value.connection.revision, revision);
    assert(
      !JSON.stringify((await a(url + "/export")).value).includes(
        "class Member",
      ),
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("context reports omitted files instead of pretending every source was analyzed", () => {
  const s = {
    digest: "a".repeat(64),
    kind: "upload",
    scannedAt: new Date().toISOString(),
    files: {
      "Other.java": "x".repeat(80000),
      "Registration.java": "Registration ".repeat(6000),
      "Extra.java": "y".repeat(80000),
    },
  };
  const c = sourceContext(s, "Registration");
  assert(Object.hasOwn(c.files, "Registration.java"));
  assert.equal(c.provenance.totalFiles, 3);
  assert(c.omitted.length > 0);
  assert.deepEqual(
    Object.keys(c.provenance.manifest),
    Object.keys(c.files).sort(),
  );
});

test("empty server and browser projects connect and refresh after files are added or removed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-empty-source-"));
  const project = path.join(root, "new-project");
  fs.mkdirSync(project);
  const app = await createApplication({ dataDir: path.join(root, "data") });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const c = client("http://127.0.0.1:" + app.server.address().port);
    await c("/auth/personal", {});
    const w = (await c("/workspaces", { exchange: sample() })).value;
    const url = `/workspaces/${w.id}/project-source`;
    let result = await c(url, {
      kind: "server",
      path: project,
      label: "new-project",
    });
    assert.equal(result.status, 200);
    assert.equal((await c(url)).value.connection.fileCount, 0);
    fs.writeFileSync(
      path.join(project, "main.js"),
      "export const fresh = true;",
    );
    assert.equal((await c(url + "/refresh", {})).status, 200);
    assert.equal((await c(url)).value.connection.fileCount, 1);
    fs.rmSync(path.join(project, "main.js"));
    assert.equal((await c(url + "/refresh", {})).status, 200);
    const empty = (await c(url)).value.connection;
    assert.equal(empty.fileCount, 0);
    result = await c(url, {
      kind: "browser",
      label: "empty-browser",
      files: {},
      revision: empty.revision,
    });
    assert.equal(result.status, 200);
    assert.equal((await c(url)).value.connection.fileCount, 0);
    const { collect } = await import("../src/services/project-files.js");
    assert.deepEqual(await collect({ async *entries() {} }, []), {});
    const uid = app.store.db.users.find((u) => u.personalProfile).id;
    assert.equal(
      sourceContext(app.store.user(uid).projectSources[w.id]).provenance
        .totalFiles,
      0,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
