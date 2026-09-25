export function toolQuestions(detail) {
  if (!["AskUserQuestion", "item/tool/requestUserInput"].includes(detail?.tool))
    return [];
  const questions = detail.questions || detail.input?.questions;
  return Array.isArray(questions)
    ? questions.map((question) => ({
        ...question,
        key: question.id || question.question,
      }))
    : [];
}
