import { runtimeConfig } from "../server/runtime-config.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { sample, TestPool } from "./fixtures.mjs";
import {
  renderPlanHTML,
  defaultPlanSkill,
  priorPlanEvaluation,
} from "../shared/plans.mjs";
import { planEvaluationSummary } from "../shared/plan-workflow.mjs";
import { importDocument } from "../shared/schema.mjs";
const html =
  "<html><body><h1>수정한 계획</h1><p>수동 편집한 내용입니다.</p></body></html>";
function client(origin) {
  let cookies = new Map();
  return async (p, body, method = body ? "POST" : "GET") => {
    const r = await fetch(origin + "/api" + p, {
      method,
      headers: {
        "X-CodeWith": "1",
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const c of r.headers.getSetCookie()) {
      const [k, ...v] = c.split(";")[0].split("=");
      cookies.set(k, v.join("="));
    }
    const value = r.headers.get("content-type")?.includes("application/json")
      ? await r.json()
      : await r.text();
    return { status: r.status, value, headers: r.headers };
  };
}
for (const databaseUrl of [undefined, "sqlite:plans.sqlite"])
  test(
    "plans: AI generation, immutable revisions, explicit final selection, stale protection, export, restart " +
      (databaseUrl || "file"),
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-plan-")),
        pool = new TestPool();
      let app;
      async function start() {
        app = await createApplication({
          dataDir: dir,
          databaseUrl,
          mode: "personal",
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
        let c = await start();
        const defaults = await c("/ai/skill-defaults");
        assert.equal(defaults.status, 200);
        assert.equal(defaults.value.skills.length, 4);
        assert(
          defaults.value.skills[0].content.includes("사용자는 이 계획 HTML을"),
        );
        let response = await c("/workspaces", { exchange: sample() });
        assert.equal(response.status, 201, JSON.stringify(response.value));
        let w = response.value;
        const url = "/workspaces/" + w.id,
          plan = url + "/plans/SPEC-REG";
        assert.equal(w.document.projectSpec.skills[0].id, defaultPlanSkill.id);
        await c("/ai/start", { provider: "codex" });
        await c("/ai/login", { provider: "codex" });
        await c("/ai/finish", {});
        const options = await c("/ai/plan-models");
        assert(options.value.models.some((m) => m.model === "test-codex"));
        const discussionSettings = {
          mode: "review",
          adaptive: true,
          discussion: true,
          reviewers: 1,
          judges: [{ provider: "codex", model: "test-codex" }],
          discussionReviewers: 3,
          discussionAgents: Array(3).fill({
            provider: "codex",
            model: "test-codex",
          }),
        };
        assert.equal(
          (await c("/ai/plan-settings", discussionSettings)).status,
          200,
        );
        const savedDiscussion = (await c("/ai/plan-settings")).value.settings;
        assert.equal(savedDiscussion.discussionReviewers, 3);
        assert.equal(savedDiscussion.reviewers, 1);
        assert.deepEqual(
          savedDiscussion.discussionAgents,
          discussionSettings.discussionAgents,
        );
        assert.deepEqual(savedDiscussion.judges, discussionSettings.judges);
        const missingDiscussion = {
          ...discussionSettings,
          discussionAgents: [
            { provider: "codex", model: "missing-discussion-model" },
          ],
        };
        assert.equal(
          (await c("/ai/plan-settings", missingDiscussion)).status,
          400,
        );
        assert.equal(
          (
            await c("/ai/plan-settings", {
              ...missingDiscussion,
              discussion: false,
            })
          ).status,
          200,
        );
        assert.equal(
          (await c("/ai/plan-settings", { mode: "compare", maxCalls: 2 }))
            .status,
          400,
        );
        assert.equal(
          (
            await c("/ai/plan-settings", {
              mode: "compare",
              agents: [{ provider: "codex", model: "missing" }],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await c("/ai/plan-settings", {
              mode: "compare",
              timeoutSeconds: 600,
            })
          ).status,
          200,
        );
        assert.equal(
          (await c("/ai/plan-settings")).value.settings.timeoutSeconds,
          runtimeConfig.planTimeoutSeconds,
        );

        response = await c("/ai/plan", {
          workspaceId: w.id,
          specId: "SPEC-REG",
          base: w.head,
        });
        assert.equal(response.status, 200);
        assert(
          response.value.includes(
            `"timeoutSeconds":${runtimeConfig.planTimeoutSeconds}`,
          ),
        );
        const answer = response.value
          .split("\n")
          .filter((x) => x.startsWith("data: "))
          .map((x) => JSON.parse(x.slice(6)))
          .find((x) => x.type === "answer");
        assert.ok(answer, response.value);
        w = answer.workspace;
        let p = w.document.specs[0].plans,
          v1 = p.versions[0];
        assert.equal(p.finalVersionId, null);
        assert.equal(v1.execution.calls.length, 4);
        assert(pool.calls.every((call) => call.webSearch === "auto"));
        assert(
          pool.calls.every((call) =>
            call.prompt.includes("현재 실행의 외부 조회 설정:"),
          ),
        );
        assert(
          pool.calls.every(
            (call) => !call.prompt.includes("도구를 실행하지 않는다."),
          ),
        );
        assert.equal(v1.evaluation.candidates.length, 2);
        assert.equal(planEvaluationSummary(v1).score.toFixed(2), "9.10");
        assert.equal(planEvaluationSummary(v1).count, 2);
        assert(v1.html.includes('class="hljs-'));
        assert(
          pool.calls
            .slice(-2)
            .every(
              (c) =>
                c.prompt.startsWith("CODEWITH_PLAN_REVIEW") &&
                !c.prompt.includes("이전 점수: "),
            ),
        );

        assert.ok(v1.html.includes("BEFORE / AFTER"));
        assert.ok(v1.html.includes("tab-state"));
        assert.equal(
          fs.readFileSync(
            path.join(dir, "plans", w.id, v1.id + ".html"),
            "utf8",
          ),
          v1.html,
        );
        assert.equal(
          w.document.specs[0].version,
          1,
          "planning does not rewrite requirement version",
        );
        w = (await c(plan + "/final", { base: w.head, versionId: v1.id }))
          .value;
        assert.equal(w.document.specs[0].plans.finalVersionId, v1.id);
        const v1copy = structuredClone(v1);
        w = (
          await c(plan, {
            base: w.head,
            parentVersionId: v1.id,
            title: "두 번째 버전",
            html,
          })
        ).value;
        p = w.document.specs[0].plans;
        assert.deepEqual(p.versions[0], v1copy);
        assert.equal(p.finalVersionId, v1.id, "saving does not move final");
        assert.equal(p.versions.length, 2);
        const v2 = p.versions[1];
        assert.equal(v2.evaluation, undefined);
        assert.equal(
          (await c(plan + "/final", { base: w.head, versionId: v2.id })).status,
          409,
          "manual edits require assessment",
        );
        w = (await c(plan + "/final", { base: w.head, versionId: v1.id }))
          .value;
        assert.equal(
          (await c(plan + "/final")).value.version.id,
          v1.id,
          "an older version can be final",
        );
        const download = await c(plan + "/" + v1.id + ".html?download=1");
        assert.equal(download.status, 200);
        assert.match(download.headers.get("content-disposition"), /attachment/);
        assert.match(
          download.headers.get("content-security-policy"),
          /sandbox/,
        );
        assert.match(download.value, /Content-Security-Policy/);
        const forged = structuredClone(w.document);
        forged.specs[0].plans.versions[0].html = html;
        assert.equal(
          (await c(url, { base: w.head, document: forged }, "PATCH")).status,
          400,
        );
        assert.equal(
          (await c(plan, { base: "stale", html, title: "거부" })).status,
          409,
        );
        assert.equal(
          (await c(plan, { base: w.head, html: "not html", title: "거부" }))
            .status,
          400,
        );
        const doc = structuredClone(w.document);
        doc.specs[0].requirements[0].body += " 변경된 요구사항";
        w = (await c(url, { base: w.head, document: doc }, "PATCH")).value;
        assert.equal((await c(plan + "/final")).value.stale, true);
        assert.equal(
          (await c(plan + "/final", { base: w.head, versionId: v2.id })).status,
          409,
        );
        const exchange = (await c(url + "/export")).value;
        assert.deepEqual(
          importDocument(exchange).specs[0].plans,
          w.document.specs[0].plans,
        );
        await stop();
        c = await start();
        const recovered = (await c(url)).value;
        assert.equal(recovered.document.specs[0].plans.versions.length, 2);
        assert.equal(recovered.document.specs[0].plans.finalVersionId, v1.id);
        assert.equal(recovered.document.specs[0].plans.approvals.length, 2);
        assert.equal(
          (await c("/ai/plan-settings")).value.settings.mode,
          "compare",
        );
      } finally {
        if (app?.server.listening) await stop();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
test("plan HTML requires each requirement exactly once", () => {
  const s = sample().specs[0];
  assert.throws(() => renderPlanHTML(s, []));
  assert.throws(() =>
    renderPlanHTML(s, [{ path: "wrong.html", content: html }]),
  );
  assert.throws(() =>
    renderPlanHTML(s, [
      { path: "REG-001.html", content: html },
      { path: "REG-001.html", content: html },
    ]),
  );
});
test("plan API isolates members, forbids viewers, rejects generation racing with edits, and stops cancellation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-plan-acl-")),
    pool = new TestPool(),
    app = await createApplication({
      dataDir: dir,
      mode: "server",
      codexPool: pool,
    });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + app.server.address().port,
    a = client(origin),
    b = client(origin),
    outsider = client(origin);
  try {
    await a("/auth/key/create", { name: "소유자" });
    const bu = (await b("/auth/key/create", { name: "관찰자" })).value;
    await outsider("/auth/key/create", { name: "외부" });
    let w = (await a("/workspaces", { exchange: sample(), visibility: "team" }))
      .value;
    const url = "/workspaces/" + w.id,
      plan = url + "/plans/SPEC-REG";
    assert.equal(
      (await outsider(plan, { base: w.head, html, title: "불가" })).status,
      403,
    );
    await b("/join", { code: w.inviteCode });
    w = (await a(url)).value;
    await a(url + "/members", {
      requestId: w.requests[0].id,
      approve: true,
      role: "viewer",
    });
    assert.equal(
      (await b(plan, { base: w.head, html, title: "불가" })).status,
      403,
    );
    assert.equal(
      (
        await b("/ai/plan", {
          workspaceId: w.id,
          specId: "SPEC-REG",
          base: w.head,
        })
      ).status,
      403,
    );
    await a("/ai/start", { provider: "codex" });
    await a("/ai/login", { provider: "codex" });
    await a("/ai/finish", {});
    const provider = [...pool.clients.values()].find((x) => x.connected),
      original = provider.run.bind(provider);
    let release, entered;
    let enteredPromise = new Promise((r) => (entered = r));
    provider.run = async (opts) => {
      provider.run = original;
      entered();
      await new Promise((r) => (release = r));
      return original(opts);
    };
    const pending = a("/ai/plan", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: w.head,
    });
    await enteredPromise;
    const doc = structuredClone(w.document);
    doc.specs[0].requirements[0].body += " racing edit";
    w = (await a(url, { base: w.head, document: doc }, "PATCH")).value;
    release();
    const result = await pending;
    assert.match(result.value, /변경되었습니다/);
    assert.equal(
      (await a(url)).value.document.specs[0].plans.versions.length,
      0,
    );
    provider.run = async (opts) => {
      await new Promise((resolve, reject) => {
        opts.signal.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        );
        entered();
      });
    };
    enteredPromise = new Promise((r) => (entered = r));
    const cancel = a("/ai/plan", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: w.head,
    });
    await enteredPromise;
    await a("/ai/cancel", {});
    assert.match((await cancel).value, /"type":"error"/);
    assert.equal(
      (await a(url)).value.document.specs[0].plans.versions.length,
      0,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("server approval rejects unresolved blockers and records approval/revocation without carrying evaluations to manual edits", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-approval-"));
  const pool = new TestPool();
  const app = await createApplication({
    dataDir: dir,
    mode: "personal",
    codexPool: pool,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const c = client("http://127.0.0.1:" + app.server.address().port);
    await c("/auth/personal", {});
    let w = (await c("/workspaces", { exchange: sample() })).value;
    await c("/ai/start", { provider: "codex" });
    await c("/ai/login", { provider: "codex" });
    await c("/ai/finish", {});
    await c("/ai/settings", {
      provider: "codex",
      model: "test-codex",
      webSearch: "off",
    });
    await c("/ai/plan-settings", { mode: "review", rounds: 0, reviewers: 1 });
    const result = await c("/ai/plan", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: w.head,
    });
    const answer = result.value
      .split("\n")
      .filter((x) => x.startsWith("data: "))
      .map((x) => JSON.parse(x.slice(6)))
      .find((x) => x.type === "answer");
    assert(answer, result.value);
    assert(pool.calls.length >= 2);
    assert(
      pool.calls.every(
        (call) =>
          call.webSearch === "off" &&
          call.prompt.includes("웹 검색과 외부 문서 읽기가 꺼져 있다"),
      ),
    );
    w = answer.workspace;
    const evaluation = structuredClone(
      w.document.specs[0].plans.versions[0].evaluation,
    );
    for (const candidate of evaluation.candidates)
      for (const review of candidate.reviews)
        review.blockingIssues = ["적용할 구현 코드 누락"];
    const version = await app.store.savePlan(w.id, w.ownerId, "SPEC-REG", {
      base: w.head,
      html,
      title: "차단된 평가",
      source: "ai",
      evaluation,
    });
    w = (await c("/workspaces/" + w.id)).value;
    const route = `/workspaces/${w.id}/plans/SPEC-REG`;
    assert.equal(
      (await c(route + "/final", { base: w.head, versionId: version.id }))
        .status,
      409,
    );
    const manual = (
      await c(route, {
        base: w.head,
        html,
        title: "사람이 보완한 버전",
        parentVersionId: version.id,
        evaluation,
      })
    ).value;
    const newVersion = manual.document.specs[0].plans.versions.at(-1);
    assert.equal(
      newVersion.evaluation,
      undefined,
      "HTTP manual save cannot forge or inherit AI scores",
    );
    assert.equal(
      (
        await c(route + "/final", {
          base: manual.head,
          versionId: newVersion.id,
        })
      ).status,
      409,
    );
    const assessed = await c("/ai/plan", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: manual.head,
      parentVersionId: newVersion.id,
      evaluateOnly: true,
    });
    const assessedAnswer = assessed.value
      .split("\n")
      .filter((x) => x.startsWith("data: "))
      .map((x) => JSON.parse(x.slice(6)))
      .find((x) => x.type === "answer");
    assert(assessedAnswer, assessed.value);
    w = assessedAnswer.workspace;
    const assessedVersion = w.document.specs[0].plans.versions.at(-1);
    assert.equal(
      assessedVersion.html,
      newVersion.html,
      "evaluate-only preserves exact edited HTML",
    );
    w = (
      await c(route + "/final", { base: w.head, versionId: assessedVersion.id })
    ).value;
    assert.equal((await c(route + "/final")).value.approval.by.id, w.ownerId);
    w = (await c(route + "/final", { base: w.head, versionId: null })).value;
    assert.equal(w.document.specs[0].plans.approvals.length, 2);
    assert.equal((await c(route + "/final")).status, 404);
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("step reviews bind to immutable versions and AI revision receives unsaved HTML", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-plan-review-"));
  const pool = new TestPool();
  const app = await createApplication({
    dataDir: dir,
    mode: "personal",
    codexPool: pool,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const c = client("http://127.0.0.1:" + app.server.address().port);
  try {
    await c("/auth/personal", {});
    let w = (await c("/workspaces", { exchange: sample() })).value;
    const endpoint = `/workspaces/${w.id}/plans/SPEC-REG`;
    w = (
      await c(endpoint, {
        base: w.head,
        title: "원본",
        html: '<html><body><section class="plan-card"><h2>첫 단계</h2><p>전체 코드</p></section><section class="plan-card"><h2>둘째 단계</h2></section></body></html>',
      })
    ).value;
    const original = w.document.specs[0].plans.versions.at(-1);
    const originalHead = w.head;
    const reviewed = await c(endpoint + "/review", {
      base: w.head,
      versionId: original.id,
      step: "step-0",
      approved: true,
    });
    assert.equal(reviewed.status, 200);
    w = reviewed.value;
    assert(w.document.specs[0].plans.versions[0].stepApprovals["step-0"]);
    assert.equal(w.document.specs[0].plans.versions[0].html, original.html);
    assert.equal(w.document.specs[0].plans.finalVersionId, null);
    assert.equal(
      (
        await c(endpoint + "/review", {
          base: originalHead,
          versionId: original.id,
          step: "step-1",
          approved: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await c(endpoint + "/review", {
          base: w.head,
          versionId: original.id,
          step: "step-9",
          approved: true,
        })
      ).status,
      404,
    );
    await c("/ai/start", { provider: "codex" });
    await c("/ai/login", { provider: "codex" });
    await c("/ai/finish", {});
    const draftHtml = original.html.replace(
      "전체 코드",
      "UNSAVED_COMPLETE_CODE",
    );
    const result = await c("/ai/plan", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: w.head,
      parentVersionId: original.id,
      draftHtml,
      message: "편집 내용을 보존하고 개선해줘",
    });
    assert.equal(result.status, 200);
    assert(pool.calls.some((call) => call.prompt.includes(draftHtml)));
    const latest = (
      await c("/workspaces/" + w.id)
    ).value.document.specs[0].plans.versions.at(-1);
    assert.equal(latest.parentId, original.id);
    assert.equal(latest.stepApprovals, undefined);
    assert.equal(
      (
        await c("/ai/plan", {
          workspaceId: w.id,
          specId: "SPEC-REG",
          base: (await c("/workspaces/" + w.id)).value.head,
          draftHtml,
        })
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("manual revisions preserve earlier feedback without inheriting a score", () => {
  const evaluation = { marker: "missing entrypoint" };
  const original = { id: "original", evaluation };
  const edited = { id: "edited", parentId: "original" };
  const spec = { plans: { versions: [original, edited] } };
  assert.equal(priorPlanEvaluation(spec, edited), evaluation);
  assert.equal(edited.evaluation, undefined);
});

test("cancelling an improvement preserves the last fully assessed plan, not the partial revision", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-loop-checkpoint-"));
  const pool = new TestPool();
  const app = await createApplication({
    dataDir: dir,
    mode: "personal",
    codexPool: pool,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const c = client("http://127.0.0.1:" + app.server.address().port);
    await c("/auth/personal", {});
    const w = (await c("/workspaces", { exchange: sample() })).value;
    await c("/ai/start", { provider: "codex" });
    await c("/ai/login", { provider: "codex" });
    await c("/ai/finish", {});
    await c("/ai/plan-settings", { mode: "review", reviewers: 1, rounds: 1 });
    const provider = [...pool.clients.values()].find((x) => x.connected);
    const original = provider.run.bind(provider);
    let entered;
    const improving = new Promise((r) => {
      entered = r;
    });
    provider.run = async (opts) => {
      if (opts.prompt.startsWith("CODEWITH_PLAN_REVISION")) {
        entered();
        await new Promise((resolve, reject) =>
          opts.signal.addEventListener(
            "abort",
            () => reject(Error("cancelled")),
            { once: true },
          ),
        );
      }
      const answer = await original(opts);
      if (opts.prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
        const parsed = JSON.parse(answer.text);
        const content = parsed.files[0].content;
        const review =
          typeof content === "string" ? JSON.parse(content) : content;
        review.candidates[0].criteria[0].status = "fail";
        parsed.files[0].content = review;
        return { ...answer, text: JSON.stringify(parsed) };
      }
      return answer;
    };
    const pending = c("/ai/plan", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: w.head,
    });
    await improving;
    await c("/ai/cancel", {});
    const response = await pending;
    assert.match(response.value, /마지막 독립 평가가 완료된 계획/);
    const saved = (await c("/workspaces/" + w.id)).value;
    const version = saved.document.specs[0].plans.versions.at(-1);
    assert(version);
    assert.equal(version.execution.loop.stopReason, "interrupted");
    assert.equal(planEvaluationSummary(version).passed, false);
    assert.equal(version.execution.loop.rounds.length, 1);
    assert.equal(saved.document.specs[0].plans.finalVersionId, null);
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("adaptive budgets persist paused jobs, checkpoint previews and resumable plans", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-adaptive-api-"));
  const pool = new TestPool();
  const app = await createApplication({
    dataDir: dir,
    mode: "personal",
    codexPool: pool,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const c = client("http://127.0.0.1:" + app.server.address().port);
    await c("/auth/personal", {});
    let w = (await c("/workspaces", { exchange: sample() })).value;
    await c("/ai/start", { provider: "codex" });
    await c("/ai/login", { provider: "codex" });
    await c("/ai/finish", {});
    assert.equal(
      (
        await c("/ai/plan-settings", {
          adaptive: true,
          mode: "review",
          reviewers: 1,
          maxCalls: 2,
          timeoutSeconds: 1200,
        })
      ).status,
      200,
    );
    const provider = [...pool.clients.values()].find((x) => x.connected),
      original = provider.run.bind(provider);
    provider.run = async (opts) => {
      const output = await original(opts);
      if (opts.prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
        const answer = JSON.parse(output.text);
        for (const r of answer.files[0].content.candidates)
          r.scores[Object.keys(r.scores)[0]] = 1;
        output.text = JSON.stringify(answer);
      }
      return output;
    };
    const events = (response) =>
      response.value
        .split("\n")
        .filter((x) => x.startsWith("data: "))
        .map((x) => JSON.parse(x.slice(6)));
    const first = events(
      await c("/ai/plan", {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
      }),
    );
    const answer = first.find((e) => e.type === "answer");
    assert(answer, JSON.stringify(first));
    w = answer.workspace;
    const version = w.document.specs[0].plans.versions.at(-1);
    assert.equal(version.execution.loop.stopReason, "call_budget");
    assert.equal(app.store.db.aiRuns.at(-1).state, "paused");
    const preview = await c(
      `/workspaces/${w.id}/plans/SPEC-REG/${version.id}.html?attempt=last`,
    );
    assert.equal(preview.status, 200);
    assert.match(preview.value, /마지막 시도/);
    const callsBefore = pool.calls.length;
    const second = events(
      await c("/ai/plan", {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
        parentVersionId: version.id,
        continueLoop: true,
      }),
    );
    const next = second.find((e) => e.type === "answer");
    assert(next, JSON.stringify(second));
    assert.equal(
      next.workspace.document.specs[0].plans.versions.at(-1).execution.loop
        .rounds.length,
      2,
    );
    assert(pool.calls[callsBefore].prompt.startsWith("CODEWITH_PLAN_REVIEW"));
    assert.equal(
      (
        await c(`/workspaces/${w.id}/plans/SPEC-REG/final`, {
          base: next.workspace.head,
          versionId: next.versionId,
        })
      ).status,
      409,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("spec evaluation policy is snapshotted, inherited and enforced by API", async () => {
  const { DEFAULT_EVALUATION_POLICY } =
    await import("../shared/plan-evaluation-policy.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-policy-"));
  const pool = new TestPool();
  const app = await createApplication({
    dataDir: dir,
    mode: "personal",
    codexPool: pool,
  });
  try {
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const c = client("http://127.0.0.1:" + app.server.address().port);
    await c("/auth/personal", {});
    const doc = sample();
    doc.projectSpec.evaluationPolicy = {
      ...structuredClone(DEFAULT_EVALUATION_POLICY),
      targetScore: 85,
    };
    const other = structuredClone(doc.specs[0].requirements[0]);
    other.id = "REG-002";
    other.title = "별도 목표";
    other.criteria = [{ id: "AC-002", text: "둘째 기준" }];
    other.resources = [];
    doc.specs[0].evaluationPolicy = {
      ...structuredClone(DEFAULT_EVALUATION_POLICY),
      targetScore: 95,
    };
    doc.specs[0].evaluationPolicy.criteria[0].label = "중복 등록 계약의 완전성";
    doc.specs[0].evaluationPolicy.criteria[0].description =
      "동시 요청과 재시도의 멱등성 근거를 확인한다.";
    doc.specs[0].evaluationPolicy.criteria[0].points = 35;
    doc.specs[0].evaluationPolicy.criteria.push({
      id: "operations",
      label: "운영 준비",
      description: "장애 복구와 관측 지표를 확인한다.",
      points: 5,
    });
    doc.specs[0].evaluationPolicy.criteria[1].points = 20;
    doc.specs[0].requirements.push(other);
    let w = (await c("/workspaces", { exchange: doc })).value;
    await c("/ai/start", { provider: "codex" });
    await c("/ai/login", { provider: "codex" });
    await c("/ai/finish", {});
    await c("/ai/plan-settings", {
      adaptive: true,
      mode: "review",
      reviewers: 1,
      maxCalls: 2,
      timeoutSeconds: 1200,
    });
    const generate = async () => {
      const res = await c("/ai/plan", {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
      });
      const events = res.value
        .split("\n")
        .filter((x) => x.startsWith("data: "))
        .map((x) => JSON.parse(x.slice(6)));
      const answer = events.find((e) => e.type === "answer");
      assert(answer, JSON.stringify(events));
      w = answer.workspace;
      return w.document.specs[0].plans.versions.at(-1);
    };
    const version = await generate();
    assert.equal(version.execution.loop.stopReason, "call_budget");
    assert.deepEqual(
      version.evaluation.rubric.requirements.map((r) => r.source),
      ["spec"],
    );
    assert.deepEqual(
      planEvaluationSummary(version).requirementScores.map((r) => r.passed),
      [false],
    );
    assert.equal(
      (
        await c(`/workspaces/${w.id}/plans/SPEC-REG/final`, {
          base: w.head,
          versionId: version.id,
        })
      ).status,
      409,
    );
    const edited = structuredClone(w.document);
    edited.specs[0].evaluationPolicy = null;
    const update = await c(
      "/workspaces/" + w.id,
      { base: w.head, document: edited },
      "PATCH",
    );
    assert.equal(update.status, 200);
    w = update.value;
    assert.equal(
      w.document.specs[0].plans.versions[0].evaluation.rubric.requirements[0]
        .targetScore,
      95,
    );
    const next = await generate();
    assert.equal(next.execution.loop.stopReason, "target_met");
    assert(
      next.evaluation.rubric.requirements.every((r) => r.targetScore === 85),
    );
    assert.equal(
      (
        await c(`/workspaces/${w.id}/plans/SPEC-REG/final`, {
          base: w.head,
          versionId: next.id,
        })
      ).status,
      200,
    );
    const judge = pool.calls.find((call) =>
      call.prompt.startsWith("CODEWITH_PLAN_REVIEW"),
    );
    const props =
      judge.responseSchema.properties.files.items.properties.content.anyOf[0]
        .properties.candidates.items.properties.scores.properties;
    assert.equal(Object.keys(props).length, 6);
    assert(judge.prompt.includes("장애 복구와 관측 지표"));
    assert(judge.prompt.includes("별도 목표"));
    assert(judge.prompt.includes("동시 요청과 재시도의 멱등성"));
    assert.equal(version.evaluation.rubric.criteria[0].max, 3.5);
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
