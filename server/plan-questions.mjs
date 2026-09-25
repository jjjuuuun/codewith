import { LIMITS } from "../shared/config.mjs";
import { parseResponseJSON } from "../shared/response-json.mjs";
import { problem } from "../shared/schema.mjs";

export function planQuestions(answer) {
  const files = answer?.files;
  if (!Array.isArray(files) || !files.some((f) => f.path === "questions.json"))
    return null;
  if (files.length !== 1)
    throw problem("확인 질문과 부분 계획을 함께 반환할 수 없습니다.", 422);
  let questions;
  try {
    questions = parseResponseJSON(files[0].content).questions;
  } catch {
    throw problem("계획 확인 질문 형식이 올바르지 않습니다.", 422);
  }
  if (
    !Array.isArray(questions) ||
    !questions.length ||
    questions.length > LIMITS.planQuestionCount ||
    questions.some(
      (q) =>
        typeof q !== "string" ||
        !q.trim() ||
        q.length > LIMITS.planQuestionChars,
    )
  )
    throw problem("계획 확인 질문은 1~8개의 짧은 질문이어야 합니다.", 422);
  return questions.map((q) => q.trim());
}
export class PlanQuestions extends Error {
  constructor(questions) {
    super("계획 확인 질문에 답변이 필요합니다.");
    this.questions = questions;
  }
}
