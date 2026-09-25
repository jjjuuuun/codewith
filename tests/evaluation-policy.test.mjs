import { planScoreStatus } from "../src/services/plan-status.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EVALUATION_POLICY as defaults,
  resolveEvaluationPolicy,
  resolvePlanRubric,
  validateEvaluationPolicy,
  validateRubricSnapshot,
} from "../shared/plan-evaluation-policy.mjs";
import {
  summarizeReviews,
  validateReview,
  planEvaluationSummary,
  validatePlanEvaluation,
  planReadyForApproval,
  planCriteria,
} from "../shared/plan-workflow.mjs";
import { planResponseSchema } from "../shared/plan-response-schema.mjs";
import { planBasisData } from "../shared/plans.mjs";
const policy = (target) => ({
  ...structuredClone(defaults),
  targetScore: target,
});
const spec = {
  id: "SPEC1",
  title: "전체 계획",
  requirements: [
    {
      id: "R1",
      title: "첫 요구",
      body: "설계",
      criteria: [{ id: "A1", text: "완료 기준" }],
    },
    {
      id: "R2",
      title: "둘째 요구",
      body: "설계",
      criteria: [{ id: "A2", text: "완료 기준" }],
    },
  ],
};
function review(rubric, fraction = 1) {
  return {
    id: "draft-1",
    provider: "codex",
    model: "test",
    scores: Object.fromEntries(
      rubric.criteria.map((c) => [c.id, c.max * fraction]),
    ),
    reasons: Object.fromEntries(
      rubric.criteria.map((c) => [c.id, "설계 및 검증 근거"]),
    ),
    criteria: planCriteria(spec).map((c) => ({
      id: c.id,
      status: "pass",
      evidence: "근거",
    })),
    blockingIssues: [],
    suggestions: [],
  };
}
test("evaluation hierarchy resolves whole policies and removing overrides restores inheritance", () => {
  const global = { evaluationPolicy: policy(85) },
    local = { evaluationPolicy: policy(95) };
  assert.equal(resolveEvaluationPolicy(global, local).policy.targetScore, 95);
  assert.equal(resolveEvaluationPolicy(global, {}).source, "workspace");
  assert.equal(resolveEvaluationPolicy({}, {}).policy.targetScore, 90);
  const snapshot = resolvePlanRubric(global, spec);
  global.evaluationPolicy.criteria[0].label = "수정";
  assert.notEqual(snapshot.criteria[0].label, "수정");
  assert.doesNotThrow(() => validateRubricSnapshot(snapshot));
});
test("invalid totals, targets and duplicate rubric items are rejected", () => {
  const bad = policy(90);
  bad.criteria[0].points = 29;
  assert.throws(() => validateEvaluationPolicy(bad));
  assert.throws(() => validateEvaluationPolicy(policy(101)));
  const r = resolvePlanRubric({}, spec);
  r.requirements[0].itemIds[1] = r.requirements[0].itemIds[0];
  assert.throws(() => validateRubricSnapshot(r));
});
test("spec policy scores the whole plan and retains all completion criteria", () => {
  const rubric = resolvePlanRubric({}, spec),
    r = review(rubric, 0.8);
  validateReview({ candidates: [r] }, ["draft-1"], planCriteria(spec), rubric);
  const summary = summarizeReviews([r], planCriteria(spec), 90, rubric);
  assert.ok(Math.abs(summary.score - 8) < 1e-10);
  assert.equal(summary.passed, false);
  assert.equal(summary.scope, "spec");
  assert.equal(rubric.requirements.length, 1);
  assert.equal(rubric.criteria.length, 5);
  assert.notEqual(planScoreStatus(summary).tone, "success");
  assert.equal(summary.requirementScores[0].passed, false);
  assert.equal(
    summarizeReviews([review(rubric)], planCriteria(spec), 90, rubric).passed,
    true,
  );
  const schema = planResponseSchema(true, rubric).properties.files.items
    .properties.content.anyOf[0];
  assert.deepEqual(
    Object.keys(
      schema.properties.candidates.items.properties.scores.properties,
    ),
    rubric.criteria.map((c) => c.id),
  );
  delete r.scores[rubric.criteria[0].id];
  assert.throws(() =>
    validateReview(
      { candidates: [r] },
      ["draft-1"],
      planCriteria(spec),
      rubric,
    ),
  );
});
test("saved snapshot preserves scoring and changed policy prevents approval", () => {
  const project = { evaluationPolicy: policy(90) },
    rubric = resolvePlanRubric(project, spec);
  const evaluation = {
    rubric,
    rubricId: rubric.id,
    rubricHash: "a".repeat(64),
    evaluatedAt: new Date().toISOString(),
    targetScore: 90,
    criteria: planCriteria(spec),
    selectedId: "draft-1",
    candidates: [
      {
        id: "draft-1",
        provider: "codex",
        model: "test",
        reviews: [review(rubric)],
      },
    ],
  };
  validatePlanEvaluation(evaluation);
  const version = { evaluation };
  assert.equal(planReadyForApproval(version, spec, project), true);
  project.evaluationPolicy.targetScore = 95;
  assert.equal(planReadyForApproval(version, spec, project), false);
  assert.equal(
    planEvaluationSummary(version).requirementScores[0].targetScore,
    90,
  );
  const before = JSON.stringify(planBasisData({ projectSpec: project }, spec));
  const changed = structuredClone(spec);
  changed.evaluationPolicy = policy(88);
  assert.notEqual(
    JSON.stringify(planBasisData({ projectSpec: project }, changed)),
    before,
  );
});

test("variable criterion counts retain a 100-point total and dynamic schema", () => {
  for (const count of [1, 6, 21, 100]) {
    const custom = {
      targetScore: 90,
      criteria: Array.from({ length: count }, (_, i) => ({
        id: `item${i}`,
        label: `기준 ${i}`,
        description: "판단 근거",
        points: i === 0 ? 101 - count : 1,
      })),
    };
    assert.doesNotThrow(() => validateEvaluationPolicy(custom));
    const rubric = resolvePlanRubric({}, { ...spec, evaluationPolicy: custom });
    assert.equal(rubric.criteria.length, count);
    assert.doesNotThrow(() => validateRubricSnapshot(rubric));
    const schema = planResponseSchema(true, rubric).properties.files.items
      .properties.content.anyOf[0];
    assert.equal(
      Object.keys(
        schema.properties.candidates.items.properties.scores.properties,
      ).length,
      count,
    );
  }
  assert.throws(() =>
    validateEvaluationPolicy({ targetScore: 90, criteria: [] }),
  );
});
