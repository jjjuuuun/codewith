import { outputSchema } from "./schema.mjs";
import { PLAN_FIELDS } from "./plans.mjs";
import { PLAN_RUBRIC } from "./plan-workflow.mjs";
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const strings = { type: "array", items: { type: "string" } };
const questions = object({ questions: strings });
const plan = object(
  Object.fromEntries(PLAN_FIELDS.map((key) => [key, { type: "string" }])),
);
const review = (rubric) =>
  object({
    candidates: {
      type: "array",
      items: object({
        id: { type: "string" },
        scores: object(
          Object.fromEntries(
            rubric.criteria.map(({ id }) => [id, { type: "number" }]),
          ),
        ),
        reasons: object(
          Object.fromEntries(
            rubric.criteria.map(({ id }) => [id, { type: "string" }]),
          ),
        ),
        criteria: {
          type: "array",
          items: object({
            id: { type: "string" },
            status: { type: "string", enum: ["pass", "fail", "uncertain"] },
            evidence: { type: "string" },
          }),
        },
        blockingIssues: strings,
        suggestions: strings,
      }),
    },
  });
export function planResponseSchema(isReview = false, rubric = PLAN_RUBRIC) {
  return {
    ...outputSchema,
    properties: {
      ...outputSchema.properties,
      files: {
        type: "array",
        items: object({
          path: { type: "string" },
          content: { anyOf: [isReview ? review(rubric) : plan, questions] },
        }),
      },
    },
  };
}
