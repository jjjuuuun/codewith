import { toolQuestions } from "../shared/tool-input.mjs";
import { randomUUID } from "node:crypto";
import { problem } from "../shared/schema.mjs";

// Approval ownership is kept server-side; replayed events never grant permission.
export function createToolApprovals() {
  const pending = new Map();
  return {
    request({ userId, jobId, detail, signal, emit }) {
      if (signal?.aborted) return Promise.resolve(false);
      return new Promise((resolve) => {
        const id = randomUUID();
        const finish = (allowed) => {
          pending.delete(id);
          signal?.removeEventListener("abort", abort);
          emit({ type: "tool-approval-resolved", id });
          resolve(allowed);
        };
        const abort = () => finish(false);
        pending.set(id, {
          userId,
          jobId,
          finish,
          questions: toolQuestions(detail),
        });
        signal?.addEventListener("abort", abort, { once: true });
        emit({ type: "tool-approval", id, jobId, detail });
      });
    },
    answer(userId, jobId, id, allowed, answers) {
      const item = pending.get(id);
      if (!item || item.userId !== userId || item.jobId !== jobId)
        throw problem("이미 처리되었거나 접근할 수 없는 승인 요청입니다.", 409);
      if (typeof allowed !== "boolean")
        throw problem("승인 여부를 확인하세요.");
      if (allowed && item.questions.length) {
        const validated = {};
        for (const question of item.questions) {
          const value = answers?.[question.key];
          if (typeof value !== "string" || !value.trim() || value.length > 5000)
            throw problem("질문에 대한 답변을 확인하세요.");
          validated[question.key] = value.trim();
        }
        item.finish({ answers: validated });
      } else item.finish(allowed);
    },
    cancel(jobId) {
      for (const item of pending.values())
        if (item.jobId === jobId) item.finish(false);
    },
  };
}
