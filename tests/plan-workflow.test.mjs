import test from "node:test";
import assert from "node:assert/strict";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import {
  validatePlanSettings,
  planCallBreakdown,
  validateReview,
  PLAN_RUBRIC,
  planEvaluationSummary,
} from "../shared/plan-workflow.mjs";
import { renderPlanHTML, PLAN_FIELDS } from "../shared/plans.mjs";
import { renderPlanMarkdown } from "../server/plan-renderer.mjs";

const agent = { provider: "codex", model: "test" };
test("plan deadlines default to thirty minutes and upgrade the saved ten-minute default", () => {
  assert.equal(validatePlanSettings().timeoutSeconds, 1800);
  assert.equal(
    validatePlanSettings({ timeoutSeconds: 600 }).timeoutSeconds,
    1800,
  );
  assert.equal(
    validatePlanSettings({ timeoutSeconds: 1800 }).timeoutSeconds,
    1800,
  );
  assert.equal(
    validatePlanSettings({ timeoutSeconds: 120 }).timeoutSeconds,
    120,
  );
  assert.throws(() => validatePlanSettings({ timeoutSeconds: 86401 }));
});
const review = (id, blocked = false) => ({
  id,
  scores: Object.fromEntries(PLAN_RUBRIC.criteria.map((c) => [c.id, c.max])),
  reasons: Object.fromEntries(
    PLAN_RUBRIC.criteria.map((c) => [c.id, "실제 근거 확인"]),
  ),
  blockingIssues: blocked ? ["필수 구현 코드 누락"] : [],
  suggestions: [],
});
function harness({
  mode = "compare",
  blocked = false,
  malformed = false,
  abort = false,
  settings = {},
} = {}) {
  const controller = new AbortController();
  let drafts = 0;
  const requests = [];
  const events = [];
  const invocations = [];
  return {
    requests,
    events,
    invocations,
    execute: () =>
      runPlanWorkflow({
        settings: validatePlanSettings({ mode, ...settings }),
        fallback: agent,
        skills: [],
        context: "동일한 기준 코드",
        draftPrompt: "WRITE",
        signal: controller.signal,
        emit: (event) => events.push(event),
        validateDraft: (files) => assert.equal(files.length, 1),
        run: async (config, prompt, onEvent, session) => {
          invocations.push({ config, prompt, session });
          requests.push(prompt);
          if (abort) controller.abort();
          if (prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
            const candidates = JSON.parse(prompt.split("\n후보: ")[1]);
            return {
              text: JSON.stringify({
                files: [
                  {
                    path: "review.json",
                    content: JSON.stringify({
                      candidates: candidates.map((c) =>
                        review(
                          c.id,
                          blocked || c.files[0].content === "candidate1",
                        ),
                      ),
                    }),
                  },
                ],
              }),
            };
          }
          if (malformed) return { text: '{"files":[' };
          if (prompt.includes("현재 계획:"))
            return {
              text: JSON.stringify({ message: "부분 수정 없음", files: [] }),
            };
          return {
            text: JSON.stringify({
              message: "초안",
              files: [{ path: "R.html", content: `candidate${++drafts}` }],
            }),
          };
        },
      }),
  };
}
test("compare: independent drafts, full peer comparison, partial merge, fresh anonymous judging and blocker-aware selection", async () => {
  const h = harness();
  const result = await h.execute();
  assert.equal(h.requests.length, 8);
  assert(!h.requests[1].includes("candidate1"));
  assert(result.answer.files[0].content === "candidate2");
  const e = planEvaluationSummary(result);
  assert.equal(e.score, 10);
  assert.equal(e.passed, true);
  assert.equal(e.count, 2);
  for (const prompt of h.requests.slice(-2)) {
    assert(!prompt.includes('"model"'));
    assert(!prompt.includes("교차 검토 결과"));
    assert(prompt.includes("동일한 기준 코드"));
    assert(prompt.includes("candidate1"));
    assert(prompt.includes("candidate2"));
  }
});
test("single mode does not fabricate a score or silently run judges", async () => {
  const h = harness({ mode: "single" }),
    r = await h.execute();
  assert.equal(h.requests.length, 1);
  assert.equal(r.evaluation, null);
});
test("all candidates with blocking issues remain unapproved even with 10/10", async () => {
  const r = await harness({ blocked: true }).execute();
  assert.equal(planEvaluationSummary(r).passed, false);
});
test("cancelled or incomplete model outputs never become a completed plan", async () => {
  await assert.rejects(harness({ abort: true }).execute(), /중지/);
  await assert.rejects(harness({ malformed: true }).execute(), /완전한 JSON/);
});
test("invalid settings and fabricated/out-of-range/missing reviews are rejected", () => {
  assert.throws(
    () => validatePlanSettings({ mode: "compare", maxCalls: 1 }),
    /한도/,
  );
  assert.throws(() => validatePlanSettings({ reviewers: 30 }), /한도/);
  const r = review("x");
  r.scores.requirements = 99;
  assert.throws(() => validateReview({ candidates: [r] }, ["x"]), /점수/);
  assert.throws(() => validateReview({ candidates: [] }, ["x"]), /누락/);
});
test("highlighting escapes HTML and preserves full code including long bodies and spread syntax", () => {
  const code =
    'const text = "<script>alert(1)</script>";\n' +
    Array.from({ length: 1200 }, (_, i) => `const value${i} = ${i};`).join(
      "\n",
    ) +
    "\nconst copy = {...source};";
  const html = renderPlanMarkdown("```javascript\n" + code + "\n```");
  assert(html.includes("hljs-keyword"));
  assert(!html.includes("<script>"));
  assert(html.includes("value1199"));
  const plain = html
    .match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1]
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  assert.equal(plain, code);
});
test("explicit omitted code fails instead of being saved as a full implementation", () => {
  const fields = Object.fromEntries(
    PLAN_FIELDS.map((k) => [k, k === "mockup" ? "" : "내용"]),
  );
  fields.after = "```js\n// ...\n```";
  assert.throws(
    () =>
      renderPlanHTML(
        { title: "명세", requirements: [{ id: "R", title: "구현" }] },
        [{ path: "R.html", content: JSON.stringify(fields) }],
      ),
    /생략/,
  );
  fields.after = "```js\nconst x = {...source};\n```";
  assert.doesNotThrow(() =>
    renderPlanHTML(
      { title: "명세", requirements: [{ id: "R", title: "구현" }] },
      [{ path: "R.html", content: JSON.stringify(fields) }],
    ),
  );
});

test("workflow reports each agent stage start and completion without inventing percentages", async () => {
  const h = harness();
  await h.execute();
  const started = h.events.filter((e) => e.status === "running");
  const completed = h.events.filter((e) => e.status === "completed");
  assert.equal(started.length, 8);
  assert.equal(completed.length, 8);
  assert.deepEqual(
    started.map((e) => e.call),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  for (const e of completed) {
    assert.equal(e.total, 8);
    assert.equal(e.provider, "codex");
    assert.equal(e.model, "test");
    assert(e.durationMs >= 0);
    assert(e.stage);
  }
});

test("call budget breakdown matches the execution and permits exactly the required budget", () => {
  const settings = validatePlanSettings({
    mode: "compare",
    writers: 2,
    rounds: 1,
    reviewers: 2,
    maxCalls: 8,
  });
  assert.deepEqual(planCallBreakdown(settings), {
    writers: 2,
    reviews: 2,
    revisions: 2,
    finalReviews: 2,
    total: 8,
  });
  assert.throws(
    () => validatePlanSettings({ ...settings, maxCalls: 7 }),
    /같아도 저장 가능/,
  );
  assert.equal(
    planCallBreakdown(validatePlanSettings({ mode: "single", maxCalls: 1 }))
      .total,
    1,
  );
  assert.equal(
    planCallBreakdown(
      validatePlanSettings({ mode: "review", rounds: 2, reviewers: 2 }),
    ).total,
    7,
  );
});

test("three authors review only peers, keep writer sessions, and use two fresh judges in eleven calls", async () => {
  const models = ["A", "B", "C", "D", "E"].map((model) => ({
    provider: "codex",
    model,
  }));
  const h = harness({
    settings: {
      writers: 3,
      reviewers: 2,
      rounds: 1,
      agents: models.slice(0, 3),
      judges: models.slice(3),
      maxCalls: 11,
    },
  });
  const result = await h.execute();
  assert.equal(h.invocations.length, 11);
  for (let i = 0; i < 3; i++) {
    const draft = h.invocations[i],
      peer = h.invocations[3 + i],
      revision = h.invocations[6 + i];
    assert.equal(draft.config.model, models[i].model);
    assert.equal(peer.config.model, draft.config.model);
    assert.equal(revision.config.model, draft.config.model);
    assert.strictEqual(draft.session, peer.session);
    assert.strictEqual(draft.session, revision.session);
    assert.notStrictEqual(draft.session, h.invocations[(i + 1) % 3].session);
    const peers = JSON.parse(peer.prompt.split("\n후보: ")[1]);
    assert.equal(peers.length, 2);
    assert(!peers.some((c) => c.files[0].content === `candidate${i + 1}`));
    const feedback = JSON.parse(
      revision.prompt.split("\n교차 검토 결과: ")[1].split("\n검토 근거")[0],
    );
    assert.equal(feedback.length, 2);
    assert(
      feedback.every(
        (r) => r.id === `draft-${i + 1}` && r.model !== draft.config.model,
      ),
    );
  }
  for (let j = 0; j < 2; j++) {
    const judge = h.invocations[9 + j];
    assert.equal(judge.config.model, models[3 + j].model);
    assert.equal(judge.session, undefined);
    assert.equal(JSON.parse(judge.prompt.split("\n후보: ")[1]).length, 3);
    assert(!judge.prompt.includes("교차 검토 결과"));
  }
  assert(result.evaluation.candidates.every((c) => c.reviews.length === 2));
  assert.equal(planEvaluationSummary(result).score, 10);
  const firstSession = h.invocations[0].session;
  await h.execute();
  assert.notStrictEqual(firstSession, h.invocations[11].session);
});

test("each stage runs concurrently and waits for its barrier before starting the next", async () => {
  let active = 0,
    max = 0,
    draftsDone = 0,
    reviewsDone = 0,
    revisionsDone = 0;
  const n = 3,
    j = 2;
  const sessions = new Set();
  const progress = [];
  const output = await runPlanWorkflow({
    settings: validatePlanSettings({
      mode: "compare",
      writers: n,
      reviewers: j,
      rounds: 1,
    }),
    fallback: agent,
    skills: [],
    context: "",
    draftPrompt: "DRAFT",
    signal: new AbortController().signal,
    emit: (e) => progress.push(e),
    validateDraft: () => {},
    run: async (config, prompt, onEvent, session) => {
      active++;
      max = Math.max(max, active);
      const type = prompt.startsWith("DRAFT")
        ? "draft"
        : prompt.startsWith("CODEWITH_PLAN_REVISION")
          ? "revision"
          : session
            ? "review"
            : "judge";
      if (type === "review") assert.equal(draftsDone, n);
      if (type === "revision") assert.equal(reviewsDone, n);
      if (type === "judge") assert.equal(revisionsDone, n);
      if (type === "draft") sessions.add(session);
      if (type === "review" || type === "revision")
        assert(sessions.has(session));
      onEvent({ type: "delta", text: "x" });
      await new Promise((resolve) => setTimeout(resolve, 25));
      active--;
      if (type === "draft") {
        draftsDone++;
        return {
          text: JSON.stringify({
            message: "draft",
            files: [{ path: "R.html", content: "full" }],
          }),
        };
      }
      if (type === "revision") {
        revisionsDone++;
        return { text: JSON.stringify({ message: "revision", files: [] }) };
      }
      if (type === "review") reviewsDone++;
      const candidates = JSON.parse(prompt.split("\n후보: ")[1]);
      return {
        text: JSON.stringify({
          files: [
            {
              path: "review.json",
              content: JSON.stringify({
                candidates: candidates.map((c) => review(c.id)),
              }),
            },
          ],
        }),
      };
    },
  });
  assert.equal(max, 3);
  assert.equal(output.execution.calls.length, 11);
  assert.equal(sessions.size, 3);
  assert(progress.filter((e) => e.type === "delta").every((e) => e.call));
});

test("a failed parallel author cancels its siblings before starting review", async () => {
  let started = 0,
    cancelled = 0;
  await assert.rejects(
    runPlanWorkflow({
      settings: validatePlanSettings({
        mode: "compare",
        writers: 3,
        rounds: 1,
        reviewers: 2,
      }),
      fallback: agent,
      skills: [],
      context: "",
      draftPrompt: "DRAFT",
      signal: new AbortController().signal,
      emit() {},
      validateDraft() {},
      run: async (_config, prompt, _onEvent, _session, signal) => {
        assert(prompt.startsWith("DRAFT"));
        const index = ++started;
        if (index === 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          throw Error("provider unavailable");
        }
        await new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              cancelled++;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    }),
    /provider unavailable/,
  );
  assert.equal(started, 3);
  assert.equal(cancelled, 2);
});

test("plan documents render semantic tables and persistent checkable tasks without executable HTML", () => {
  const html = renderPlanMarkdown(
    "| 기준 | 기대 결과 |\n| --- | --- |\n| AC-1 | 중복 방지 |\n\n- [ ] 확인 필요\n- [x] 사람이 확인함\n\n<script>alert(1)</script>\n\n```text\n- [ ] 코드 예시\n```",
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th>기준<\/th>/);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2);
  assert.match(html, /disabled checked/);
  assert(!html.includes("<script>"));
  assert.match(html, /- \[ \] 코드 예시/);
});
