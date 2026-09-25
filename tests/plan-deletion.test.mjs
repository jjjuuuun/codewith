import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { sample, TestPool, saveAssessedPlan } from "./fixtures.mjs";
function client(origin) {
  let cookie = "";
  return async (url, body, method = body ? "POST" : "GET") => {
    const r = await fetch(origin + "/api" + url, {
      method,
      headers: {
        Cookie: cookie,
        "X-CodeWith": "1",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const set = r.headers
      .getSetCookie()
      .find((c) => c.startsWith("codewith_session="));
    if (set) cookie = set.split(";")[0];
    return {
      status: r.status,
      value: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : await r.text(),
    };
  };
}
for (const databaseUrl of [undefined, "sqlite:plans.sqlite"])
  test(`plan deletion revokes approval and preserves lineage and completion history: ${databaseUrl || "file"}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-plan-deletion-"));
    let app;
    async function start() {
      app = await createApplication({
        mode: "personal",
        dataDir: dir,
        databaseUrl,
        codexPool: new TestPool(),
      });
      await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
      const c = client(`http://127.0.0.1:${app.server.address().port}`);
      await c("/auth/personal", {});
      return c;
    }
    async function stop() {
      await new Promise((r) => app.server.close(r));
      await app.closed;
    }
    try {
      let c = await start();
      let w = (await c("/workspaces", { exchange: sample() })).value;
      w = await saveAssessedPlan(app, w, {
        html: "<html><body><p>원본 계획 내용입니다.</p></body></html>",
      });
      const root = `/workspaces/${w.id}`,
        route = root + "/plans/SPEC-REG";
      const first = w.document.specs[0].plans.versions[0];
      w = (await c(route + "/final", { base: w.head, versionId: first.id }))
        .value;
      const r = w.document.specs[0].requirements[0];
      w = (
        await c(root + `/requirements/${r.id}/complete`, {
          base: w.head,
          eventId: "completed-before-delete",
          requirementVersion: r.version,
          planVersionId: first.id,
        })
      ).value.workspace;
      w = (
        await c(route, {
          base: w.head,
          parentVersionId: first.id,
          title: "수정 계획",
          html: first.html,
        })
      ).value;
      const child = structuredClone(w.document.specs[0].plans.versions[1]);
      assert.equal(
        (await c(route + "/" + first.id, { base: "stale" }, "DELETE")).status,
        409,
      );
      const before = w.head;
      w = (await c(route + "/" + first.id, { base: w.head }, "DELETE")).value;
      const spec = w.document.specs[0];
      assert(spec.plans.versions[0].deletedAt);
      assert.equal(spec.plans.finalVersionId, null);
      assert.equal(spec.plans.approvals.at(-1).versionId, null);
      assert.deepEqual(spec.plans.versions[1], child);
      assert.equal(spec.requirements[0].status, "completed");
      assert.equal(spec.requirements[0].completion.planVersionId, first.id);
      assert.equal((await c(route + "/" + first.id + ".html")).status, 404);
      assert.equal((await c(route + "/final")).status, 404);
      assert.equal(
        (await c(route + "/final", { base: w.head, versionId: first.id }))
          .status,
        404,
      );
      assert.equal(
        (
          await c(route, {
            base: w.head,
            parentVersionId: first.id,
            title: "invalid",
            html: first.html,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await c(route + "/review", {
            base: w.head,
            versionId: first.id,
            step: "step-0",
            approved: true,
          })
        ).status,
        404,
      );
      assert.equal(
        (await c(route + "/" + first.id, { base: w.head }, "DELETE")).status,
        404,
      );
      assert.equal(
        (await c(root + "/commits/" + before)).value.snapshot.specs[0].plans
          .versions[0].deletedAt,
        undefined,
      );
      await stop();
      c = await start();
      w = (await c(root)).value;
      assert(w.document.specs[0].plans.versions[0].deletedAt);
      w = (await c(route + "/" + child.id, { base: w.head }, "DELETE")).value;
      assert.equal(
        w.document.specs[0].plans.versions.filter((v) => !v.deletedAt).length,
        0,
      );
      w = (await c(route, { base: w.head, html: first.html, title: "새 계획" }))
        .value;
      assert.equal(w.document.specs[0].plans.versions.length, 3);
    } finally {
      await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test("only workspace editors can delete plan versions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-plan-delete-acl-"));
  const app = await createApplication({
    mode: "server",
    dataDir: dir,
    codexPool: new TestPool(),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const owner = client(origin),
      viewer = client(origin),
      outsider = client(origin);
    await owner("/auth/key/create", { name: "owner" });
    await viewer("/auth/key/create", { name: "viewer" });
    await outsider("/auth/key/create", { name: "outsider" });
    let w = (
      await owner("/workspaces", { exchange: sample(), visibility: "team" })
    ).value;
    w = await saveAssessedPlan(app, w, {
      html: "<html><body><p>삭제 권한을 검증할 계획입니다.</p></body></html>",
    });
    const route = `/workspaces/${w.id}/plans/SPEC-REG/${w.document.specs[0].plans.versions[0].id}`;
    assert.equal(
      (await outsider(route, { base: w.head }, "DELETE")).status,
      403,
    );
    await viewer("/join", { code: w.inviteCode });
    w = (await owner(`/workspaces/${w.id}`)).value;
    await owner(`/workspaces/${w.id}/members`, {
      requestId: w.requests[0].id,
      approve: true,
      role: "viewer",
    });
    assert.equal((await viewer(route, { base: w.head }, "DELETE")).status, 403);
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
