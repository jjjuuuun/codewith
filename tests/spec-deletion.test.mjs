import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { sample, TestPool, saveAssessedPlan } from "./fixtures.mjs";
import { blankSpec } from "../shared/schema.mjs";
function client(origin) {
  let cookie = "";
  return async (p, method = "GET", body) => {
    const r = await fetch(origin + "/api" + p, {
      method,
      headers: {
        Cookie: cookie,
        "X-CodeWith": "1",
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.headers.has("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("application/json")
        ? await r.json()
        : await r.text(),
    };
  };
}
for (const databaseUrl of [undefined, "sqlite:specs.sqlite"])
  test(
    "spec deletion preserves other specs and history, survives restart, restores plans " +
      (databaseUrl || "file"),
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-spec-delete-"));
      let app;
      async function start() {
        app = await createApplication({
          dataDir: dir,
          databaseUrl,
          mode: "personal",
          codexPool: new TestPool(),
        });
        await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
        const c = client("http://127.0.0.1:" + app.server.address().port);
        await c("/auth/personal", "POST", {});
        return c;
      }
      async function stop() {
        await new Promise((r) => app.server.close(r));
        await app.closed;
      }
      try {
        let c = await start();
        const doc = sample();
        doc.specs.push(blankSpec("SPEC-KEEP", "유지할 명세"));
        let w = (await c("/workspaces", "POST", { exchange: doc })).data;
        const url = "/workspaces/" + w.id,
          remove = url + "/specs/SPEC-REG",
          plans = url + "/plans/SPEC-REG";
        w = await saveAssessedPlan(app, w, {
          html: "<html><body><h1>복원할 계획</h1></body></html>",
          title: "복원할 계획",
        });
        const version = w.document.specs[0].plans.versions[0];
        w = (
          await c(plans + "/final", "POST", {
            base: w.head,
            versionId: version.id,
          })
        ).data;
        const before = structuredClone(w),
          keep = structuredClone(w.document.specs[1]);
        assert.equal(
          (await c(remove, "DELETE", { base: "stale" })).status,
          409,
        );
        assert.equal((await c(url)).data.head, w.head);
        const removed = await c(remove, "DELETE", { base: w.head });
        assert.equal(removed.status, 200);
        w = removed.data;
        assert.deepEqual(w.document.specs, [keep]);
        assert.deepEqual(w.document.files, before.document.files);
        assert.match(w.commits[0].message, /명세 삭제: SPEC-REG/);
        assert.equal(w.commits[0].parent, before.head);
        assert.equal((await c(plans + "/final")).status, 404);
        assert.equal((await c(plans + "/" + version.id + ".html")).status, 404);
        assert.equal((await c(remove, "DELETE", { base: w.head })).status, 404);
        assert.equal(
          (await c(url + "/requirements/REG-001/complete", "POST", {})).status,
          404,
        );
        const snapshot = (await c(url + "/commits/" + before.head)).data
          .snapshot;
        assert.deepEqual(
          snapshot.specs[0].plans,
          before.document.specs[0].plans,
        );
        await stop();
        c = await start();
        w = (await c(url)).data;
        assert.deepEqual(w.document.specs, [keep]);
        assert.equal(
          fs.readFileSync(
            path.join(dir, "plans", w.id, version.id + ".html"),
            "utf8",
          ),
          version.html,
        );
        const restored = await c(url + "/restore", "POST", {
          base: w.head,
          commitId: before.head,
        });
        assert.equal(restored.status, 200, JSON.stringify(restored.data));
        w = restored.data;
        assert.deepEqual(
          w.document.specs[0].plans,
          before.document.specs[0].plans,
        );
        assert.equal(
          w.document.specs[0].requirements[0].body,
          before.document.specs[0].requirements[0].body,
        );
        assert.equal((await c(plans + "/final")).status, 200);
        w = (await c(remove, "DELETE", { base: w.head })).data;
        w = (await c(url + "/specs/SPEC-KEEP", "DELETE", { base: w.head }))
          .data;
        assert.deepEqual(w.document.specs, []);
        assert.equal(w.specCount, 0);
      } finally {
        if (app?.server.listening) await stop();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
test("only workspace editors may delete a spec", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-spec-acl-")),
    app = await createApplication({
      dataDir: dir,
      mode: "server",
      codexPool: new TestPool(),
    });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + app.server.address().port,
    owner = client(origin),
    viewer = client(origin),
    outsider = client(origin);
  try {
    await owner("/auth/key/create", "POST", { name: "소유자" });
    const user = (await viewer("/auth/key/create", "POST", { name: "참여자" }))
      .data.user;
    await outsider("/auth/key/create", "POST", { name: "외부" });
    let w = (
      await owner("/workspaces", "POST", {
        exchange: sample(),
        visibility: "team",
      })
    ).data;
    const url = "/workspaces/" + w.id,
      remove = url + "/specs/SPEC-REG";
    assert.equal(
      (await outsider(remove, "DELETE", { base: w.head })).status,
      403,
    );
    await viewer("/join", "POST", { code: w.inviteCode });
    w = (await owner(url)).data;
    w = (
      await owner(url + "/members", "POST", {
        requestId: w.requests[0].id,
        approve: true,
        role: "viewer",
      })
    ).data;
    assert.equal(
      (await viewer(remove, "DELETE", { base: w.head })).status,
      403,
    );
    w = (
      await owner(url + "/members", "POST", { userId: user.id, role: "editor" })
    ).data;
    assert.equal(
      (await viewer(remove, "DELETE", { base: w.head })).status,
      200,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
