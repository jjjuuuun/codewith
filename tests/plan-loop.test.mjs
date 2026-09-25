import test from "node:test";
import assert from "node:assert/strict";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import {
  PLAN_RUBRIC,
  validatePlanSettings,
  summarizeReviews,
  validateReview,
  planReadyForApproval,
} from "../shared/plan-workflow.mjs";
const criteria = [
  { id: "AC-1", requirementId: "R", text: "중복 요청은 한 번만 처리" },
];
const agent = { provider: "codex", model: "test" };
function verdict(id, score = 9, status = "pass", blocked = false) {
  return {
    id,
    scores: Object.fromEntries(
      PLAN_RUBRIC.criteria.map((c) => [c.id, (c.max * score) / 10]),
    ),
    reasons: Object.fromEntries(
      PLAN_RUBRIC.criteria.map((c) => [c.id, "본문 근거"]),
    ),
    criteria: [
      {
        id: "AC-1",
        status,
        evidence: "R 검증 절에 중복 요청 시나리오와 예상 결과 명시",
      },
    ],
    blockingIssues: blocked ? ["중대 문제"] : [],
    suggestions: [],
  };
}
async function execute(verdicts, overrides = {}) {
  const requests = [],
    events = [],
    checkpoints = [];
  let iteration = 0;
  const result = await runPlanWorkflow({
    settings: validatePlanSettings({
      loop: true,
      mode: "review",
      rounds: 3,
      reviewers: 1,
    }),
    criteria,
    fallback: agent,
    skills: [],
    context: "fixed specification",
    draftPrompt: "DRAFT",
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    onCheckpoint: (value) => checkpoints.push(value),
    validateDraft: (files) => assert.equal(files.length, 1),
    run: async (_, prompt, onEvent, session) => {
      requests.push({ prompt, session });
      if (prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
        const candidate = JSON.parse(prompt.split("\n후보: ")[1])[0];
        const v = verdicts[Math.min(iteration++, verdicts.length - 1)];
        return {
          text: JSON.stringify({
            files: [
              {
                path: "review.json",
                content: { candidates: [verdict(candidate.id, ...v)] },
              },
            ],
          }),
        };
      }
      return {
        text: JSON.stringify({
          message: "계획",
          files: [{ path: "R.html", content: `revision-${iteration}` }],
        }),
      };
    },
    ...overrides,
  });
  return { result, requests, events, checkpoints };
}
test("loop repairs unmet criteria then stops early at 90, judges start fresh without old scores", async () => {
  const { result, requests, checkpoints } = await execute([
    [10, "fail"],
    [9, "pass"],
  ]);
  assert.equal(result.execution.loop.stopReason, "target_met");
  assert.equal(result.execution.loop.rounds.length, 2);
  assert.equal(requests.length, 4);
  const judges = requests.filter((r) =>
    r.prompt.startsWith("CODEWITH_PLAN_REVIEW"),
  );
  assert.notEqual(judges[0].session, judges[1].session);
  assert.notEqual(judges[0].session.id, judges[1].session.id);
  assert(!judges[1].prompt.includes("독립 평가 지적:"));
  assert(requests[2].prompt.includes('"status":"fail"'));
  assert.equal(checkpoints[0].answer.files[0].content, "revision-0");
  assert.equal(checkpoints[1].answer.files[0].content, "revision-1");
});
test("round limit preserves the last normal plan and failing assessment", async () => {
  const { result } = await execute([[8.9, "pass"]]);
  assert.equal(result.execution.loop.stopReason, "round_limit");
  assert.equal(result.execution.loop.rounds.length, 4);
  assert.equal(result.answer.files[0].content, "revision-3");
});
test("90 threshold does not excuse blockers, missing criteria or uncertain evidence", () => {
  for (const [score, status, blocked] of [
    [8.999, "pass", false],
    [10, "fail", false],
    [10, "uncertain", false],
    [10, "pass", true],
  ]) {
    assert.equal(
      summarizeReviews([verdict("x", score, status, blocked)], criteria).passed,
      false,
    );
  }
  assert.equal(summarizeReviews([verdict("x")], criteria).passed, true);
  const r = verdict("x");
  delete r.criteria;
  assert.throws(
    () => validateReview({ candidates: [r] }, ["x"], criteria),
    /완료 기준/,
  );
});
test("exact existing HTML can be evaluated without a writer or changes", async () => {
  const initialAnswer = {
    message: "재평가",
    files: [{ path: "plan.html", content: "<html>edited</html>" }],
  };
  const { result, requests } = await execute([[9, "pass"]], {
    initialAnswer,
    settings: validatePlanSettings({ loop: true, rounds: 0, reviewers: 1 }),
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(result.answer, initialAnswer);
});
test("approval requires current criteria and rejects manually edited/unassessed plans", async () => {
  const { result } = await execute([[9, "pass"]]);
  const spec = {
    requirements: [
      {
        id: "R",
        body: "requirement",
        criteria: [{ id: "AC-1", text: criteria[0].text }],
      },
    ],
  };
  assert.equal(planReadyForApproval(result, spec), true);
  assert.equal(planReadyForApproval({}, spec), false);
  spec.requirements[0].criteria[0].text = "changed";
  assert.equal(planReadyForApproval(result, spec), false);
});

test("custom targets control loop stopping and remain the approval threshold", async () => {
  const spec = {
    requirements: [
      { id: "R", criteria: [{ id: "AC-1", text: criteria[0].text }] },
    ],
  };
  for (const [targetScore, marks, rounds] of [
    [80, [[8, "pass"]], 1],
    [
      95,
      [
        [9, "pass"],
        [9.5, "pass"],
      ],
      2,
    ],
  ]) {
    const { result } = await execute(marks, {
      settings: validatePlanSettings({
        loop: true,
        rounds: 2,
        reviewers: 1,
        targetScore,
      }),
    });
    assert.equal(result.execution.loop.stopReason, "target_met");
    assert.equal(result.execution.loop.rounds.length, rounds);
    assert.equal(result.execution.loop.target, targetScore);
    assert.equal(result.evaluation.targetScore, targetScore);
    assert.equal(planReadyForApproval(result, spec), true);
  }
  const { result } = await execute([[9, "pass"]], {
    settings: validatePlanSettings({
      loop: true,
      rounds: 0,
      reviewers: 1,
      targetScore: 95,
    }),
  });
  assert.equal(result.execution.loop.stopReason, "round_limit");
  assert.equal(planReadyForApproval(result, spec), false);
  for (const [status, blocked] of [
    ["fail", false],
    ["uncertain", false],
    ["pass", true],
  ])
    assert.equal(
      summarizeReviews([verdict("x", 10, status, blocked)], criteria, 1).passed,
      false,
    );
});

test("target settings validate limits and legacy settings retain 90", () => {
  assert.equal(validatePlanSettings({}).targetScore, 90);
  for (const targetScore of [0, 101, 89.5, "80", NaN])
    assert.throws(() => validatePlanSettings({ targetScore }));
  for (const targetScore of [1, 100])
    assert.equal(
      validatePlanSettings({ targetScore }).targetScore,
      targetScore,
    );
});

const adaptive = (maxCalls = 24) =>
  validatePlanSettings({
    loop: true,
    adaptive: true,
    rounds: 1,
    reviewers: 1,
    maxCalls,
  });
test("adaptive loop passes five improvements and stops only when target is reached", async () => {
  const { result, requests } = await execute(
    [6, 6.5, 7, 7.5, 8, 8.5, 9].map((score) => [score, "pass"]),
    { settings: adaptive() },
  );
  assert.equal(result.execution.loop.stopReason, "target_met");
  assert.equal(result.execution.loop.rounds.length, 7);
  assert.equal(requests.length, 14);
});
test("adaptive stagnation changes approach once and preserves best and latest attempts", async () => {
  const { result, requests } = await execute(
    [
      [8, "pass"],
      [7.5, "pass"],
      [7, "pass"],
      [7, "pass"],
    ],
    { settings: adaptive() },
  );
  assert.equal(result.execution.loop.stopReason, "stagnation");
  assert.equal(result.execution.loop.rounds.length, 4);
  assert.equal(result.answer.files[0].content, "revision-0");
  assert.equal(
    result.execution.loop.checkpoint.latest.answer.files[0].content,
    "revision-3",
  );
  assert.equal(
    requests.filter((r) => r.prompt.includes("접근 변경:")).length,
    1,
  );
  assert.equal(result.execution.loop.rounds.at(-1).approach, "alternative");
});
test("adaptive call budget preserves checkpoint and resumes without drafting again", async () => {
  const first = await execute(
    [
      [8, "pass"],
      [8.5, "pass"],
    ],
    { settings: adaptive(4) },
  );
  assert.equal(first.result.execution.loop.stopReason, "call_budget");
  assert.equal(first.requests.length, 4);
  const next = await execute(
    [
      [8.5, "pass"],
      [9, "pass"],
    ],
    {
      settings: adaptive(4),
      resumeState: first.result.execution.loop,
      initialAnswer: first.result.execution.loop.checkpoint.best.answer,
    },
  );
  assert(next.requests[0].prompt.startsWith("CODEWITH_PLAN_REVIEW"));
  assert.equal(next.result.execution.loop.stopReason, "target_met");
  assert.equal(next.result.execution.loop.rounds.length, 4);
  assert.equal(next.requests.length, 3);
});
test("adaptive evaluation-only never modifies a below-target plan", async () => {
  const answer = {
    message: "edited",
    files: [{ path: "plan.html", content: "<html>unchanged</html>" }],
  };
  const { result, requests } = await execute([[7, "pass"]], {
    settings: adaptive(),
    evaluateOnly: true,
    initialAnswer: answer,
  });
  assert.equal(result.execution.loop.stopReason, "evaluated");
  assert.equal(requests.length, 1);
  assert.deepEqual(result.answer, answer);
});

test("successful alternative resets stagnation and continues toward the goal", async () => {
  const { result } = await execute(
    [
      [8, "pass"],
      [8, "pass"],
      [8, "pass"],
      [8.5, "pass"],
      [9, "pass"],
    ],
    { settings: adaptive() },
  );
  assert.equal(result.execution.loop.stopReason, "target_met");
  assert.equal(result.execution.loop.rounds[3].approach, "alternative");
  assert.equal(result.execution.loop.rounds[3].stalled, 0);
  assert.equal(
    validatePlanSettings({ adaptive: true, timeoutSeconds: 600 })
      .timeoutSeconds,
    600,
  );
});
