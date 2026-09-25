import test from "node:test";
import assert from "node:assert/strict";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import { validatePlanSettings, PLAN_RUBRIC } from "../shared/plan-workflow.mjs";
import { planResponseSchema } from "../shared/plan-response-schema.mjs";

const writer = { provider: "openai", model: "writer" };
const reviewer = { provider: "claude-code", model: "discussion-reviewer" };
const judge = { provider: "claude", model: "judge" };
async function execute({
  mode = "review",
  maxCalls = 24,
  discussion = true,
  response,
  discussionReviewers = 1,
  discussionAgents = [reviewer],
  evaluateOnly = false,
  signal = new AbortController().signal,
} = {}) {
  const requests = [],
    checkpoints = [];
  let evaluations = 0,
    utterances = 0;
  const settings = validatePlanSettings({
    mode,
    loop: true,
    adaptive: true,
    discussion,
    discussionReviewers,
    discussionAgents,
    maxCalls,
    reviewers: 1,
    writers: 2,
    agents: [writer, { ...writer, model: "writer2" }],
    judges: [judge],
  });
  const result = await runPlanWorkflow({
    settings,
    criteria: [{ id: "AC", requirementId: "R", text: "fixed" }],
    fallback: writer,
    skills: [],
    context: "fixed specification",
    draftPrompt: "DRAFT",
    signal,
    emit() {},
    evaluateOnly,
    ...(evaluateOnly
      ? { initialAnswer: { files: [{ path: "R.html", content: "original" }] } }
      : {}),
    onCheckpoint(value) {
      checkpoints.push(structuredClone(value));
    },
    validateDraft(files) {
      assert.equal(files.length, 1);
    },
    async run(config, prompt, _emit, session) {
      requests.push({ config, prompt, session });
      let answer;
      if (prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
        const candidates = JSON.parse(prompt.split("\n후보: ")[1]);
        const passed = evaluations++ > 0;
        answer = {
          files: [
            {
              path: "review.json",
              content: {
                candidates: candidates.map(({ id }) => ({
                  id,
                  scores: Object.fromEntries(
                    PLAN_RUBRIC.criteria.map((c) => [
                      c.id,
                      c.max * (passed ? 1 : 0.5),
                    ]),
                  ),
                  reasons: Object.fromEntries(
                    PLAN_RUBRIC.criteria.map((c) => [c.id, "evidence"]),
                  ),
                  criteria: [
                    {
                      id: "AC",
                      status: passed ? "pass" : "fail",
                      evidence: "evidence",
                    },
                  ],
                  blockingIssues: [],
                  suggestions: ["fix"],
                })),
              },
            },
          ],
        };
      } else if (prompt.startsWith("CODEWITH_PLAN_DISCUSSION")) {
        utterances++;
        answer = response?.(utterances) || {
          message: `private-discussion-${utterances}`,
          proposal: null,
          files: [
            {
              path: "discussion.json",
              content: {
                ready: utterances > 4,
                newEvidence: utterances <= 4,
                unresolved: ["check concurrency"],
              },
            },
          ],
        };
      } else
        answer = {
          message: "plan",
          files: [{ path: "R.html", content: "plan" }],
        };
      return { text: JSON.stringify(answer) };
    },
  });
  return { result, requests, checkpoints };
}

test("free discussion exceeds one exchange, uses multiple models, and keeps final judges independent", async () => {
  const { result, requests, checkpoints } = await execute();
  const discussion = result.execution.loop.discussions[0];
  assert.equal(discussion.messages.length, 6);
  assert.equal(discussion.stopReason, "consensus");
  const turns = requests.filter((r) =>
    r.prompt.startsWith("CODEWITH_PLAN_DISCUSSION"),
  );
  assert.equal(turns[0].config.model, "writer");
  assert.equal(turns[1].config.model, "discussion-reviewer");
  assert(!turns.some((r) => r.config.model === "judge"));
  assert(turns[1].prompt.includes("private-discussion-1"));
  const revision = requests.find((r) =>
    r.prompt.startsWith("CODEWITH_PLAN_REVISION"),
  );
  assert(revision.prompt.includes("private-discussion-6"));
  const final = requests
    .filter((r) => r.prompt.startsWith("CODEWITH_PLAN_REVIEW"))
    .at(-1);
  assert.equal(final.config.model, "judge");
  assert(!final.prompt.includes("private-discussion"));
  assert(!turns.some((r) => r.session.id === final.session.id));
  assert.equal(result.execution.loop.stopReason, "target_met");
  assert(
    checkpoints.some(
      (c) => c.execution.loop.discussions[0]?.messages.length === 1,
    ),
  );
});

test("comparison includes every author and reviewer", async () => {
  const { result } = await execute({ mode: "compare" });
  assert.deepEqual(
    result.execution.loop.discussions[0].messages
      .slice(0, 3)
      .map((m) => m.model),
    ["writer", "writer2", "discussion-reviewer"],
  );
});

test("discussion reserves calls for revision and independent assessment", async () => {
  const { result, requests } = await execute({ maxCalls: 5 });
  assert.equal(requests.length, 5);
  assert.equal(result.execution.loop.discussions[0].messages.length, 1);
  assert.equal(
    result.execution.loop.discussions[0].stopReason,
    "reserved_budget",
  );
  assert.equal(result.execution.loop.stopReason, "target_met");
  const minimal = await execute({ maxCalls: 4 });
  assert.equal(minimal.result.execution.loop.discussions[0].messages.length, 0);
  assert.equal(minimal.result.execution.loop.stopReason, "target_met");
});

test("no new evidence or repeated claims end discussion without forcing agreement", async () => {
  for (const newEvidence of [false, true]) {
    const { result } = await execute({
      response: () => ({
        message: "repeated claim",
        files: [
          {
            path: "discussion.json",
            content: { ready: false, newEvidence, unresolved: ["not agreed"] },
          },
        ],
      }),
    });
    assert.equal(
      result.execution.loop.discussions[0].stopReason,
      "no_new_evidence",
    );
    assert.equal(
      result.execution.loop.discussions[0].messages.length,
      newEvidence ? 4 : 2,
    );
  }
});

test("disabled and evaluation-only runs never discuss", async () => {
  for (const options of [{ discussion: false }, { evaluateOnly: true }]) {
    const { requests } = await execute(options);
    assert(
      !requests.some((r) => r.prompt.startsWith("CODEWITH_PLAN_DISCUSSION")),
    );
  }
  assert.equal(validatePlanSettings({}).discussion, false);
  assert.throws(() => validatePlanSettings({ discussion: "true" }));
});

test("malformed discussion fails instead of changing assessment", async () => {
  await assert.rejects(
    execute({ response: () => ({ message: "invalid", files: [] }) }),
    /토론 응답/,
  );
  const schema = planResponseSchema(false, PLAN_RUBRIC, true);
  assert.equal(
    schema.properties.files.items.properties.content.anyOf[0].properties.ready
      .type,
    "boolean",
  );
});

test("discussion reviewer count is independent from the final evaluator count", async () => {
  const { result, requests } = await execute({
    discussionReviewers: 3,
    discussionAgents: [
      reviewer,
      { ...reviewer, model: "reviewer2" },
      { ...reviewer, model: "reviewer3" },
    ],
  });
  assert.deepEqual(
    result.execution.loop.discussions[0].messages
      .slice(0, 4)
      .map((m) => m.model),
    ["writer", "discussion-reviewer", "reviewer2", "reviewer3"],
  );
  assert.equal(
    requests.filter((r) => r.prompt.startsWith("CODEWITH_PLAN_REVIEW")).length,
    2,
  );
});

test("legacy settings receive separate reviewer defaults and validate the new fields", async () => {
  const settings = validatePlanSettings({ judges: [judge], reviewers: 3 });
  assert.equal(settings.discussionReviewers, 1);
  assert.deepEqual(settings.discussionAgents, []);
  assert.deepEqual(settings.judges, [judge]);
  for (const discussionReviewers of [0, 4, 1.5, "2"])
    assert.throws(() => validatePlanSettings({ discussionReviewers }));
  assert.throws(() =>
    validatePlanSettings({
      discussionAgents: [{ provider: "unknown", model: "test" }],
    }),
  );
  assert.throws(() =>
    validatePlanSettings({ discussionAgents: Array(4).fill(reviewer) }),
  );
  const { result } = await execute({ discussionAgents: [] });
  assert.equal(
    result.execution.loop.discussions[0].messages[1].model,
    writer.model,
  );
});
