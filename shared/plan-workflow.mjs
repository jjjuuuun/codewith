import {
  validateRubricSnapshot,
  resolvePlanRubric,
} from "./plan-evaluation-policy.mjs";
import { LIMITS, PLAN_DEFAULTS, PLAN_POLICY } from "./config.mjs";
export const PLAN_TARGET = PLAN_DEFAULTS.targetScore / 10;
export const planTargetScore = (version) =>
  version?.evaluation?.targetScore ?? PLAN_DEFAULTS.targetScore;
// Historical rubric remains fixed so pre-policy versions retain their scores.
export const PLAN_RUBRIC = {
  id: "implementation-v1",
  criteria: [
    { id: "requirements", label: "요구사항·완료 기준", max: 3 },
    { id: "feasibility", label: "코드 근거·구현 가능성·코드 완전성", max: 3 },
    { id: "safety", label: "예외·보안·데이터 처리", max: 2 },
    { id: "verification", label: "검증 계획", max: 1 },
    { id: "scope", label: "변경 범위·복잡성", max: 1 },
  ],
};
export const defaultPlanReviewSkill = { id: "codewith-plan-review" };
export const defaultPlanFlowSkill = { id: "codewith-plan-flow" };
export const defaultPlanSettings = {
  ...PLAN_DEFAULTS,
  agents: [],
  judges: [],
  discussionAgents: [],
};
const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
export function planCallBreakdown(settings) {
  const writers = settings.mode === "compare" ? settings.writers : 1;
  if (settings.adaptive)
    return {
      writers,
      reviews: 0,
      revisions: 0,
      finalReviews: settings.reviewers,
      total: settings.maxCalls ?? PLAN_POLICY.defaultCallBudget,
    };
  const rounds = settings.mode === "single" ? 0 : settings.rounds;
  if (settings.loop) {
    const revisions = writers * rounds;
    const finalReviews = settings.reviewers * (rounds + 1);
    return {
      writers,
      reviews: 0,
      revisions,
      finalReviews,
      total: writers + revisions + finalReviews,
    };
  }
  const reviews = writers * rounds;
  const revisions = writers * rounds;
  const finalReviews = settings.mode === "single" ? 0 : settings.reviewers;
  return {
    writers,
    reviews,
    revisions,
    finalReviews,
    total: writers + reviews + revisions + finalReviews,
  };
}
export function planCallCount(settings) {
  return planCallBreakdown(settings).total;
}
export function validatePlanSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("계획 설정 형식을 확인하세요.");
  const s = Object.fromEntries(
    Object.keys(defaultPlanSettings).map((k) => [
      k,
      value[k] ?? defaultPlanSettings[k],
    ]),
  );
  // Upgrade the former default persisted before the limit control was removed.
  if (!s.adaptive && s.timeoutSeconds === 600)
    s.timeoutSeconds = defaultPlanSettings.timeoutSeconds;
  if (typeof s.adaptive !== "boolean") fail("계획 실행 설정을 확인하세요.");
  if (typeof s.discussion !== "boolean") fail("토론 사용 여부를 확인하세요.");
  if (s.discussion && (!s.loop || !s.adaptive))
    fail("토론은 적응형 계획 루프에서 사용할 수 있습니다.");
  if (typeof s.loop !== "boolean") fail("계획 반복 설정을 확인하세요.");
  if (s.loop && s.mode === "single") s.mode = "review";
  if (value.maxCalls == null)
    s.maxCalls = s.adaptive ? PLAN_POLICY.defaultCallBudget : planCallCount(s);
  if (!["single", "review", "compare"].includes(s.mode))
    fail("계획 실행 방식을 선택하세요.");
  for (const [key, min, max] of [
    ["writers", PLAN_POLICY.writersMin, PLAN_POLICY.writersMax],
    ["reviewers", 1, PLAN_POLICY.reviewersMax],
    ["discussionReviewers", 1, PLAN_POLICY.discussionReviewersMax],
    ["rounds", 0, PLAN_POLICY.roundsMax],
    ["targetScore", 1, 100],
    ["maxCalls", 1, PLAN_POLICY.callsMax],
    [
      "timeoutSeconds",
      PLAN_POLICY.timeoutMinSeconds,
      PLAN_POLICY.timeoutMaxSeconds,
    ],
  ])
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max)
      fail("계획 실행 인원·반복·한도를 확인하세요.");
  for (const [key, max] of [
    ["agents", PLAN_POLICY.writersMax],
    ["judges", PLAN_POLICY.reviewersMax],
    ["discussionAgents", PLAN_POLICY.discussionReviewersMax],
  ]) {
    if (!Array.isArray(s[key]) || s[key].length > max)
      fail("계획 모델 구성을 확인하세요.");
    s[key] = s[key].map((a) => {
      if (
        !a ||
        !["codex", "claude-code", "openai", "claude"].includes(a.provider) ||
        typeof a.model !== "string" ||
        !a.model ||
        a.model.length > 160
      )
        fail("계획 모델을 선택하세요.");
      return { provider: a.provider, model: a.model };
    });
  }
  if (
    s.adaptive &&
    s.maxCalls < (s.mode === "compare" ? s.writers : 1) + s.reviewers
  )
    fail("호출 예산은 최초 작성과 평가를 수행할 수 있어야 합니다.");
  if (planCallCount(s) > s.maxCalls)
    fail(
      `이 구성은 ${planCallCount(s)}회 호출이 필요합니다. 호출 한도를 이 값 이상으로 설정하세요(같아도 저장 가능). 또는 작성자·평가자·검토 횟수를 줄이세요.`,
    );
  return s;
}
export function validateReview(
  review,
  ids,
  expectedCriteria,
  rubric = PLAN_RUBRIC,
) {
  if (
    !review ||
    !Array.isArray(review.candidates) ||
    review.candidates.length !== ids.length ||
    new Set(review.candidates.map((x) => x?.id)).size !== ids.length
  )
    fail("평가 응답에서 후보가 누락되거나 중복되었습니다.");
  return review.candidates.map((c) => {
    if (!ids.includes(c.id) || !c.scores || !c.reasons)
      fail("평가 후보와 근거를 확인하세요.");
    for (const k of rubric.criteria) {
      if (
        typeof c.scores[k.id] !== "number" ||
        !Number.isFinite(c.scores[k.id]) ||
        c.scores[k.id] < 0 ||
        c.scores[k.id] > k.max ||
        typeof c.reasons[k.id] !== "string" ||
        !c.reasons[k.id].trim() ||
        c.reasons[k.id].length > LIMITS.planReasonChars
      )
        fail("평가 점수 또는 항목별 근거가 올바르지 않습니다.");
    }
    for (const key of ["blockingIssues", "suggestions"])
      if (
        !Array.isArray(c[key]) ||
        c[key].length > PLAN_POLICY.reviewIssuesMax ||
        c[key].some(
          (x) =>
            typeof x !== "string" ||
            !x.trim() ||
            x.length > LIMITS.planReasonChars,
        )
      )
        fail("평가 문제 목록이 올바르지 않습니다.");
    if (expectedCriteria) {
      if (
        !Array.isArray(c.criteria) ||
        c.criteria.length !== expectedCriteria.length ||
        new Set(c.criteria.map((x) => x?.id)).size !==
          expectedCriteria.length ||
        c.criteria.some(
          (x) =>
            !expectedCriteria.some((e) => e.id === x.id) ||
            !["pass", "fail", "uncertain"].includes(x.status) ||
            typeof x.evidence !== "string" ||
            !x.evidence.trim() ||
            x.evidence.length > LIMITS.planReasonChars,
        )
      )
        fail("완료 기준별 판정과 근거가 누락되거나 올바르지 않습니다.");
    }
    return {
      ...(c.criteria ? { criteria: c.criteria } : {}),
      id: c.id,
      scores: Object.fromEntries(
        rubric.criteria.map((k) => [k.id, c.scores[k.id]]),
      ),
      reasons: Object.fromEntries(
        rubric.criteria.map((k) => [k.id, c.reasons[k.id]]),
      ),
      blockingIssues: c.blockingIssues,
      suggestions: c.suggestions,
    };
  });
}
export function reviewScore(review, rubric = PLAN_RUBRIC) {
  return (
    rubric.criteria.reduce((n, k) => n + review.scores[k.id], 0) /
    (rubric.requirements?.length || 1)
  );
}
export function summarizeReviews(
  reviews,
  criteria,
  targetScore = PLAN_DEFAULTS.targetScore,
  rubric = PLAN_RUBRIC,
) {
  const verdicts = (criteria || []).map((criterion) => {
    const checks = reviews.map((r) =>
      r.criteria?.find((c) => c.id === criterion.id),
    );
    return {
      ...criterion,
      status: checks.some((c) => c?.status === "fail")
        ? "fail"
        : checks.length && checks.every((c) => c?.status === "pass")
          ? "pass"
          : "uncertain",
      evidence: checks.map((c) => c?.evidence || "검토 근거 없음"),
    };
  });
  const score = reviews.length
    ? reviews.reduce((n, r) => n + reviewScore(r, rubric), 0) / reviews.length
    : 0;
  const blockingIssues = [...new Set(reviews.flatMap((r) => r.blockingIssues))];
  const requirementScores = (rubric.requirements || []).map((r) => {
    const score = reviews.length
      ? reviews.reduce(
          (n, review) =>
            n + r.itemIds.reduce((sum, id) => sum + review.scores[id], 0),
          0,
        ) / reviews.length
      : 0;
    return {
      ...r,
      score,
      passed: reviews.length > 0 && score + 1e-10 >= r.targetScore / 10,
    };
  });
  return {
    scope: rubric.id === "spec-v1" ? "spec" : "requirement",
    requirementScores,
    target: targetScore,
    criteria: verdicts,
    passed:
      reviews.length > 0 &&
      (requirementScores.length
        ? requirementScores.every((r) => r.passed)
        : score + 1e-10 >= targetScore / 10) &&
      blockingIssues.length === 0 &&
      (!criteria ||
        (criteria.length > 0 && verdicts.every((c) => c.status === "pass"))),
    score,
    blockingIssues,
  };
}

export function planCriteria(spec) {
  return spec.requirements.flatMap((r) =>
    r.criteria.length
      ? r.criteria.map((c) => ({ id: c.id, requirementId: r.id, text: c.text }))
      : [{ id: r.id, requirementId: r.id, text: r.body }],
  );
}
export function planReadyForApproval(version, spec, projectSpec) {
  const expected = planCriteria(spec);
  return (
    (!projectSpec ||
      !version?.evaluation?.rubric ||
      JSON.stringify(version.evaluation.rubric) ===
        JSON.stringify(resolvePlanRubric(projectSpec, spec))) &&
    expected.length > 0 &&
    JSON.stringify(version?.evaluation?.criteria) ===
      JSON.stringify(expected) &&
    planEvaluationSummary(version)?.passed === true
  );
}

export function validatePlanEvaluation(e) {
  if (e?.rubric) validateRubricSnapshot(e.rubric);
  if (
    e?.targetScore !== undefined &&
    (!Number.isInteger(e.targetScore) ||
      e.targetScore < 1 ||
      e.targetScore > 100)
  )
    fail("목표 점수는 1~100 사이의 정수여야 합니다.");
  if (
    !e ||
    e.rubricId !== (e.rubric?.id || PLAN_RUBRIC.id) ||
    !/^[a-f0-9]{64}$/.test(e.rubricHash) ||
    !Number.isFinite(Date.parse(e.evaluatedAt)) ||
    !Array.isArray(e.candidates) ||
    !e.candidates.length ||
    e.candidates.length > 4 ||
    new Set(e.candidates.map((c) => c?.id)).size !== e.candidates.length
  )
    fail("계획 평가 기록이 올바르지 않습니다.");
  if (
    e.criteria !== undefined &&
    (!Array.isArray(e.criteria) ||
      !e.criteria.length ||
      e.criteria.length > 10000 ||
      new Set(e.criteria.map((c) => c?.id)).size !== e.criteria.length ||
      e.criteria.some(
        (c) =>
          !c ||
          typeof c.id !== "string" ||
          typeof c.requirementId !== "string" ||
          typeof c.text !== "string" ||
          !c.text.trim(),
      ))
  )
    fail("평가 완료 기준 목록이 올바르지 않습니다.");
  for (const c of e.candidates) {
    if (
      !/^draft-[1-4]$/.test(c.id) ||
      !Array.isArray(c.reviews) ||
      !c.reviews.length ||
      c.reviews.length > 3
    )
      fail("계획 평가자 기록이 올바르지 않습니다.");
    for (const a of [c, ...c.reviews])
      if (
        typeof a.model !== "string" ||
        a.model.length > 160 ||
        !["codex", "claude-code", "openai", "claude"].includes(a.provider)
      )
        fail("평가 모델 기록을 확인하세요.");
    for (const r of c.reviews)
      validateReview(
        { candidates: [r] },
        [c.id],
        e.criteria,
        e.rubric || PLAN_RUBRIC,
      );
  }
  if (!e.candidates.some((c) => c.id === e.selectedId))
    fail("선정 후보가 없습니다.");
  return e;
}
export function planEvaluationSummary(version) {
  const e = version?.evaluation,
    c = e?.candidates.find((c) => c.id === e.selectedId);
  if (!c) return null;
  const summary = summarizeReviews(
    c.reviews,
    e.criteria,
    planTargetScore(version),
    e.rubric || PLAN_RUBRIC,
  );
  return {
    ...summary,
    passed: summary.passed,
    count: c.reviews.length,
  };
}

export function validatePlanExecution(execution) {
  if (
    !execution ||
    typeof execution !== "object" ||
    JSON.stringify(execution).length > LIMITS.planExecutionChars
  )
    fail("계획 실행 기록이 올바르지 않습니다.");
  validatePlanSettings(execution.settings);
  if (
    !execution.settings ||
    !Array.isArray(execution.skills) ||
    execution.skills.length > 100 ||
    execution.skills.some(
      (s) =>
        !s ||
        typeof s.id !== "string" ||
        typeof s.content !== "string" ||
        s.content.length > LIMITS.textChars,
    )
  )
    fail("계획 적용 스킬 기록이 올바르지 않습니다.");
  if (
    !Array.isArray(execution.calls) ||
    !execution.calls.length ||
    execution.calls.length > 64 ||
    execution.calls.some(
      (c) =>
        !c ||
        typeof c.stage !== "string" ||
        c.stage.length > 160 ||
        typeof c.model !== "string" ||
        c.model.length > 160 ||
        !["codex", "claude-code", "openai", "claude"].includes(c.provider),
    )
  )
    fail("계획 모델 호출 기록이 올바르지 않습니다.");
  if (execution.loop?.checkpoint) {
    for (const candidate of [
      execution.loop.checkpoint.best,
      execution.loop.checkpoint.latest,
    ]) {
      if (
        !candidate ||
        !Array.isArray(candidate.answer?.files) ||
        !candidate.answer.files.length ||
        candidate.answer.files.some(
          (f) =>
            !f ||
            typeof f.path !== "string" ||
            !(
              typeof f.content === "string" ||
              (f.content && typeof f.content === "object")
            ),
        )
      )
        fail("계획 재개 기록이 올바르지 않습니다.");
    }
    if (
      !Array.isArray(execution.loop.rounds) ||
      execution.loop.rounds.length > 128 ||
      execution.loop.rounds.some(
        (r) =>
          !Number.isInteger(r.round) ||
          !Number.isFinite(r.score) ||
          !Array.isArray(r.criteria) ||
          !Array.isArray(r.blockingIssues),
      )
    )
      fail("계획 회차 기록이 올바르지 않습니다.");
  }
  return execution;
}
