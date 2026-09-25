import { LIMITS } from "./config.mjs";
import { blankSpec, problem } from "./schema.mjs";

export function validateSpecProposal(value) {
  const text = (s, max) => typeof s === "string" && s.trim() && s.length <= max;
  if (
    !value ||
    !text(value.title, 160) ||
    !Array.isArray(value.requirements) ||
    !value.requirements.length ||
    value.requirements.length > 50 ||
    value.requirements.some(
      (r) =>
        !r ||
        !text(r.title, 300) ||
        !text(r.body, LIMITS.textChars) ||
        !Array.isArray(r.criteria) ||
        !r.criteria.length ||
        r.criteria.length > 50 ||
        r.criteria.some((c) => !text(c, LIMITS.shortTextChars)),
    )
  )
    throw problem(
      "새 명세 제안의 이름·요구사항·완료 기준 형식을 확인하세요.",
      502,
    );
  return value;
}

export function specFromProposal(value, makeId) {
  const proposal = validateSpecProposal(value);
  const spec = blankSpec(makeId("SPEC"), proposal.title);
  spec.requirements = proposal.requirements.map((r) => ({
    id: makeId("REQ"),
    title: r.title,
    body: r.body,
    status: "pending",
    criteria: r.criteria.map((text) => ({ id: makeId("AC"), text })),
    resources: [],
  }));
  return spec;
}
