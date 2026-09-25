export const MAX_EVALUATION_CRITERIA = 100;
export const DEFAULT_EVALUATION_POLICY = {
  targetScore: 90,
  criteria: [
    {
      id: "requirements",
      label: "요구사항·완료 기준",
      description:
        "모든 요구사항과 완료 기준에 구체적인 설계와 검증 방법이 있는가",
      points: 30,
    },
    {
      id: "feasibility",
      label: "코드 근거·구현 가능성·코드 완전성",
      description: "제공된 코드에 근거하며 변경 코드와 의존 관계가 구체적인가",
      points: 30,
    },
    {
      id: "safety",
      label: "예외·보안·데이터 처리",
      description: "실패 상황, 권한과 입력 검증, 데이터 일관성을 고려했는가",
      points: 20,
    },
    {
      id: "verification",
      label: "검증 계획",
      description: "성공과 실패를 재현하고 확인할 검증 절차가 있는가",
      points: 10,
    },
    {
      id: "scope",
      label: "변경 범위·복잡성",
      description: "불필요한 변경 없이 요구 범위를 충족하는가",
      points: 10,
    },
  ],
};
const fail = () => {
  throw Object.assign(
    new Error(
      "평가 기준은 항목별 이름·판단 설명과 배점 합계 100점, 목표 1~100점이 필요합니다.",
    ),
    { status: 400 },
  );
};
export function validateEvaluationPolicy(value) {
  if (value == null) return null;
  if (
    !value ||
    Array.isArray(value) ||
    !Number.isInteger(value.targetScore) ||
    value.targetScore < 1 ||
    value.targetScore > 100 ||
    !Array.isArray(value.criteria) ||
    !value.criteria.length ||
    value.criteria.length > MAX_EVALUATION_CRITERIA
  )
    fail();
  const ids = new Set();
  for (const c of value.criteria) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.label !== "string" ||
      !c.label.trim() ||
      c.label.length > 160 ||
      typeof c.description !== "string" ||
      !c.description.trim() ||
      c.description.length > 4000 ||
      !Number.isInteger(c.points) ||
      c.points < 1 ||
      c.points > 100
    )
      fail();
    ids.add(c.id);
  }
  if (value.criteria.reduce((n, c) => n + c.points, 0) !== 100) fail();
  return JSON.parse(JSON.stringify(value));
}
export function resolveEvaluationPolicy(projectSpec, spec) {
  const source = spec?.evaluationPolicy
    ? "spec"
    : projectSpec?.evaluationPolicy
      ? "workspace"
      : "system";
  return {
    source,
    policy: validateEvaluationPolicy(
      spec?.evaluationPolicy ??
        projectSpec?.evaluationPolicy ??
        DEFAULT_EVALUATION_POLICY,
    ),
  };
}
export function resolvePlanRubric(projectSpec, spec) {
  const { source, policy } = resolveEvaluationPolicy(projectSpec, spec);
  const criteria = policy.criteria.map((c, i) => ({
    id: `c${i + 1}`,
    label: c.label,
    description: c.description,
    max: c.points / 10,
    requirementId: spec.id,
  }));
  return {
    id: "spec-v1",
    criteria,
    requirements: [
      {
        id: spec.id,
        title: spec.title,
        source,
        targetScore: policy.targetScore,
        itemIds: criteria.map((c) => c.id),
      },
    ],
  };
}

export function validateRubricSnapshot(rubric) {
  if (
    !rubric ||
    !["requirements-v1", "spec-v1"].includes(rubric.id) ||
    !Array.isArray(rubric.requirements) ||
    !rubric.requirements.length ||
    rubric.requirements.length > 500 ||
    !Array.isArray(rubric.criteria)
  )
    fail();
  if (rubric.id === "spec-v1" && rubric.requirements.length !== 1) fail();
  const ids = new Set(),
    used = new Set();
  for (const r of rubric.requirements) {
    if (
      !r ||
      typeof r.id !== "string" ||
      ids.has(r.id) ||
      typeof r.title !== "string" ||
      !["system", "workspace", "requirement", "spec"].includes(r.source) ||
      !Array.isArray(r.itemIds) ||
      new Set(r.itemIds).size !== r.itemIds.length
    )
      fail();
    ids.add(r.id);
    const items = r.itemIds.map((id) => {
      if (used.has(id)) fail();
      used.add(id);
      const c = rubric.criteria.find((c) => c.id === id);
      if (
        !c ||
        c.requirementId !== r.id ||
        typeof c.max !== "number" ||
        !Number.isFinite(c.max)
      )
        fail();
      return { ...c, points: Math.round(c.max * 10 * 1e8) / 1e8 };
    });
    validateEvaluationPolicy({ targetScore: r.targetScore, criteria: items });
  }
  if (used.size !== rubric.criteria.length) fail();
  return rubric;
}
