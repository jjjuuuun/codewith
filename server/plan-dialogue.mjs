import { LIMITS } from "../shared/config.mjs";
import { randomUUID } from "node:crypto";
import { problem } from "../shared/schema.mjs";

export function createPlanDialogue() {
  const pending = new Map();
  async function ask({
    userId,
    workspaceId,
    jobId,
    questions,
    stage,
    call,
    signal,
    emit,
    waiting = () => {},
  }) {
    const answers = [];
    for (const question of questions) {
      if (signal.aborted)
        throw signal.reason || problem("계획 실행이 중지되었습니다.", 408);
      const id = randomUUID();
      const answer = await new Promise((resolve, reject) => {
        const abort = () => {
          pending.delete(id);
          emit({ type: "plan-question-cancelled", id });
          waiting(-1);
          reject(problem("계획 실행이 중지되었습니다.", 408));
        };
        pending.set(id, {
          userId,
          workspaceId,
          jobId,
          resolve: (text) => {
            pending.delete(id);
            signal.removeEventListener("abort", abort);
            waiting(-1);
            emit({ type: "plan-question-answered", id, answer: text });
            resolve(text);
          },
        });
        signal.addEventListener("abort", abort, { once: true });
        waiting(1);
        emit({ type: "plan-question", id, question, stage, call });
      });
      answers.push({ question, answer });
    }
    return answers;
  }
  function answer(userId, workspaceId, jobId, id, text) {
    const item = pending.get(id);
    if (
      !item ||
      item.userId !== userId ||
      item.workspaceId !== workspaceId ||
      item.jobId !== jobId
    )
      throw problem(
        "답변할 질문을 찾을 수 없습니다. 최신 작업 상태를 확인하세요.",
        404,
      );
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > LIMITS.messageChars
    )
      throw problem("답변은 1~16,000자로 작성하세요.", 400);
    item.resolve(text.trim());
  }
  return { ask, answer };
}
