import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { Store } from "../server/store.mjs";
import { sample, TestPool, saveAssessedPlan } from "./fixtures.mjs";
import { defaultPlanUISkill, renderPlanHTML } from "../shared/plans.mjs";
import { validateDocument } from "../shared/schema.mjs";
import { renderMarkdown } from "../public/markdown.js";
const html =
  "<html><body><h1>검토한 계획</h1><p>요구사항별 구현 절차</p></body></html>";
function client(origin) {
  let cookie = "";
  return async (p, b, method = b ? "POST" : "GET") => {
    const r = await fetch(origin + "/api" + p, {
      method,
      headers: {
        "X-CodeWith": "1",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    if (r.headers.has("set-cookie"))
      cookie =
        r.headers
          .getSetCookie()
          .find((x) => x.startsWith("codewith_session="))
          ?.split(";")[0] || cookie;
    const value = await r.json();
    return { status: r.status, value };
  };
}
for (const databaseUrl of [undefined, "sqlite:completion.sqlite"])
  test(
    "requirement completion, replay, edit reset, rename and delete without lifecycle locks " +
      (databaseUrl || "file"),
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-completion-"));
      let app;
      async function start() {
        app = await createApplication({
          mode: "server",
          dataDir: dir,
          databaseUrl,
          codexPool: new TestPool(),
        });
        await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
        return client("http://127.0.0.1:" + app.server.address().port);
      }
      async function stop() {
        await new Promise((r) => app.server.close(r));
        await app.closed;
      }
      try {
        let c = await start();
        const identity = (await c("/auth/key/create", { name: "개발자" }))
          .value;
        const doc = sample();
        doc.specs[0].requirements[0].status = "accepted";
        doc.specs[0].status = "accepted";
        doc.specs[0].questions = [
          { id: "OPEN", text: "미정 질문", answer: "", resolved: false },
        ];
        let w = (await c("/workspaces", { exchange: doc })).value;
        const url = "/workspaces/" + w.id,
          complete = url + "/requirements/REG-001/complete";
        assert.equal(w.document.specs[0].requirements[0].status, "pending");
        assert(
          w.document.projectSpec.skills.some(
            (x) => x.id === defaultPlanUISkill.id,
          ),
        );
        const forged = structuredClone(w.document);
        forged.specs[0].requirements[0].status = "completed";
        assert.equal(
          (await c(url, { base: w.head, document: forged }, "PATCH")).status,
          400,
        );
        const b = {
          base: w.head,
          eventId: "run-1",
          requirementVersion: 1,
          planVersionId: "missing",
        };
        assert.equal((await c(complete, b)).status, 409);
        w = await saveAssessedPlan(app, w, { html, title: "최종 후보" });
        const pid = w.document.specs[0].plans.versions[0].id;
        w = (
          await c(url + "/plans/SPEC-REG/final", {
            base: w.head,
            versionId: pid,
          })
        ).value;
        const request = {
          base: w.head,
          eventId: "run-1",
          requirementVersion: 1,
          planVersionId: pid,
          summary: "검증 완료",
          codeRevision: "abc123",
        };
        let result = await c(complete, request);
        assert.equal(result.status, 200, JSON.stringify(result));
        w = result.value.workspace;
        assert.equal(w.document.specs[0].status, "completed");
        assert.equal(
          w.document.specs[0].requirements[0].completion.by.id,
          identity.user.id,
        );
        assert.equal(w.document.specs[0].requirements[0].version, 1);
        const head = w.head;
        assert.equal((await c(complete, request)).value.alreadyCompleted, true);
        assert.equal((await c(url)).value.head, head);
        assert.equal(
          (await c(complete, { ...request, summary: "다른 요청" })).status,
          409,
        );
        await stop();
        c = await start();
        await c("/auth/key/login", { key: identity.key });
        w = (await c(url)).value;
        assert.equal(w.document.specs[0].requirements[0].status, "completed");
        let next = structuredClone(w.document);
        next.specs[0].requirements[0].id = "RENAMED";
        next.specs[0].tasks[0].req = "RENAMED";
        result = await c(url, { base: w.head, document: next }, "PATCH");
        assert.equal(result.status, 200, JSON.stringify(result));
        w = result.value;
        assert.equal(w.document.specs[0].requirements[0].status, "pending");
        assert.equal(w.document.specs[0].requirements[0].version, 2);
        assert.equal(w.document.specs[0].requirements[0].completion, null);
        assert.equal((await c(complete, request)).status, 404);
        assert.equal(
          (
            await c(url + "/requirements/RENAMED/complete", {
              ...request,
              base: w.head,
              requirementVersion: 2,
            })
          ).status,
          409,
          "stale plan cannot mark changed contract complete",
        );
        next = structuredClone(w.document);
        next.specs[0].requirements = [];
        next.specs[0].tasks[0].req = "";
        result = await c(url, { base: w.head, document: next }, "PATCH");
        assert.equal(result.status, 200, JSON.stringify(result));
        w = result.value;
        assert.equal(w.document.specs[0].requirements.length, 0);
        assert.equal(w.document.specs[0].status, "pending");
        assert.equal(
          w.document.specs[0].plans.versions.length,
          1,
          "delete keeps plans",
        );
        next = structuredClone(w.document);
        next.specs[0].requirements = [
          {
            id: "NEW",
            title: "재생성",
            body: "다시 작성",
            status: "pending",
            criteria: [],
          },
        ];
        w = (await c(url, { base: w.head, document: next }, "PATCH")).value;
        assert.equal(w.document.specs[0].requirements[0].version, 1);
        assert.equal(
          w.document.specs[0].questions.length,
          1,
          "open questions do not gate CRUD",
        );
      } finally {
        if (app?.server.listening) await stop();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
test("completion API rejects outsiders/viewers and requirement-only completion does not invalidate the final plan", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-completion-acl-")),
    app = await createApplication({
      mode: "server",
      dataDir: dir,
      codexPool: new TestPool(),
    });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + app.server.address().port,
    c = client(origin),
    other = client(origin);
  try {
    await c("/auth/key/create", { name: "owner" });
    await other("/auth/key/create", { name: "viewer" });
    const doc = sample();
    doc.specs[0].requirements.push({
      id: "SECOND",
      title: "둘째",
      body: "두 번째 요구사항",
      criteria: [],
    });
    let w = (await c("/workspaces", { exchange: doc, visibility: "team" }))
      .value;
    const url = "/workspaces/" + w.id,
      endpoint = url + "/requirements/REG-001/complete";
    assert.equal((await other(endpoint, {})).status, 403);
    await other("/join", { code: w.inviteCode });
    w = (await c(url)).value;
    await c(url + "/members", {
      requestId: w.requests[0].id,
      approve: true,
      role: "viewer",
    });
    assert.equal((await other(endpoint, {})).status, 403);
    w = await saveAssessedPlan(app, w, { html });
    const pid = w.document.specs[0].plans.versions[0].id;
    w = (
      await c(url + "/plans/SPEC-REG/final", { base: w.head, versionId: pid })
    ).value;
    w = (
      await c(endpoint, {
        base: w.head,
        eventId: "first",
        requirementVersion: 1,
        planVersionId: pid,
      })
    ).value.workspace;
    assert.equal(w.document.specs[0].status, "pending");
    assert.equal((await c(url + "/plans/SPEC-REG/final")).value.stale, false);
    w = (
      await c(url + "/requirements/SECOND/complete", {
        base: w.head,
        eventId: "second",
        requirementVersion: 1,
        planVersionId: pid,
      })
    ).value.workspace;
    assert.equal(w.document.specs[0].status, "completed");
    let next = structuredClone(w.document);
    next.specs[0].requirements[0].body += " 수정";
    w = (await c(url, { base: w.head, document: next }, "PATCH")).value;
    assert.deepEqual(
      w.document.specs[0].requirements.map((r) => r.status),
      ["pending", "completed"],
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("plan renderer fixes the layout, escapes body HTML and isolates mockups", () => {
  const s = sample().specs[0],
    data = {
      implementation: "<style>body{display:none}</style>",
      before: "기존 코드 미제공",
      after: "```java\nObjects.equals(a,b);\n```",
      ui: "폼 목업",
      mockup: "<style>body{color:red}</style><button>확인</button>",
      database: "해당 없음",
      verification: "- AC-001 확인",
    },
    files = [{ path: "REG-001.html", content: JSON.stringify(data) }];
  const a = renderPlanHTML(s, files, renderMarkdown);
  data.implementation = "다른 내용";
  const b = renderPlanHTML(
    s,
    [{ path: "REG-001.html", content: JSON.stringify(data) }],
    renderMarkdown,
  );
  assert.equal(
    a.match(/<style>([\s\S]*?)<\/style>/)[1],
    b.match(/<style>([\s\S]*?)<\/style>/)[1],
  );
  assert.equal((a.match(/class="plan-card"/g) || []).length, 5);
  assert(a.includes('class="code-comparison"'));
  assert(a.includes("&lt;style&gt;body{display:none}"));
  assert(a.includes('sandbox=""'));
  assert(!a.includes("<style>body{color:red}"));
  delete data.database;
  assert.throws(() =>
    renderPlanHTML(s, [
      { path: "REG-001.html", content: JSON.stringify(data) },
    ]),
  );
});
test("existing workspace gets UI skill once without replacing an edited skill or its records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-plan-ui-"));
  let st;
  try {
    st = await Store.open(dir);
    st.db.users.push({ id: "u", name: "U", login: "u" });
    const w = await st.create("u", "기존");
    const doc = structuredClone(w.document);
    doc.projectSpec.skills = doc.projectSpec.skills.filter(
      (x) => x.id !== defaultPlanUISkill.id,
    );
    await st.commit(w, "u", doc, "기존 환경", w.head);
    await st.close();
    st = await Store.open(dir);
    const loaded = st.db.workspaces[0];
    assert.equal(
      loaded.document.projectSpec.skills.filter(
        (x) => x.id === defaultPlanUISkill.id,
      ).length,
      1,
    );
    const next = structuredClone(loaded.document);
    next.projectSpec.skills.find(
      (x) => x.id === defaultPlanUISkill.id,
    ).content = "사용자가 수정한 UI 지침";
    await st.commit(loaded, "u", next, "사용자 편집", loaded.head);
    const head = loaded.head;
    await st.close();
    st = await Store.open(dir);
    assert.equal(st.db.workspaces[0].head, head);
    assert.equal(
      st.db.workspaces[0].document.projectSpec.skills.find(
        (x) => x.id === defaultPlanUISkill.id,
      ).content,
      "사용자가 수정한 UI 지침",
    );
  } finally {
    await st?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
