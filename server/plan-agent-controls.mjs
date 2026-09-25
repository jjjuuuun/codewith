import { runtimeConfig as runtime } from "./runtime-config.mjs";
import { planFailure } from "./plan-failure.mjs";
import { problem } from "../shared/schema.mjs";

// A stopped stage keeps its barrier pending while the other sessions continue.
export function createPlanAgentControls({
  validationRetries = runtime.planValidationRetries,
} = {}) {
  const jobs = new Map();
  async function execute({ jobId, session, signal, emit, waiting, run }) {
    let agents = jobs.get(jobId);
    if (!agents) jobs.set(jobId, (agents = new Map()));
    const entry = { state: "running", controller: null, resume: null };
    agents.set(session.id, entry);
    const publish = (state, failure) => {
      entry.state = state;
      emit({ type: "plan-agent-state", session: session.id, state, failure });
    };
    let previousFailure;
    let previousAnswer;
    let repairs = 0;
    try {
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        entry.controller = new AbortController();
        const local = AbortSignal.any([signal, entry.controller.signal]);
        publish("running");
        try {
          const result = await run(
            local,
            attempt,
            previousFailure
              ? { ...previousFailure, answer: previousAnswer }
              : undefined,
          );
          local.throwIfAborted();
          publish("completed");
          return result;
        } catch (error) {
          signal.throwIfAborted();
          if (["plan_retry_limit", "call_budget"].includes(error.code))
            throw error;
          const paused = entry.controller.signal.aborted;
          previousFailure = paused ? undefined : planFailure(error);
          previousAnswer = paused ? undefined : error.planAnswer;
          if (
            !paused &&
            error.planStep &&
            previousFailure.kind === "validation" &&
            repairs < validationRetries
          ) {
            repairs++;
            publish("repairing", {
              ...previousFailure,
              repairAttempt: repairs,
              repairLimit: validationRetries,
            });
            continue;
          }
          await new Promise((resolve, reject) => {
            const abort = () => reject(signal.reason);
            entry.resume = resolve;
            signal.addEventListener("abort", abort, { once: true });
            waiting(1);
            entry.cleanup = () => {
              signal.removeEventListener("abort", abort);
              entry.resume = null;
              waiting(-1);
            };
            publish(
              paused ? "paused" : "failed",
              paused ? planFailure(error, local) : previousFailure,
            );
          }).finally(() => entry.cleanup());
          repairs = 0;
        }
      }
    } finally {
      agents.delete(session.id);
      if (!agents.size) jobs.delete(jobId);
    }
  }
  function action(jobId, session, action) {
    if (!["stop", "restart"].includes(action))
      throw problem("지원하지 않는 세션 동작입니다.", 400);
    const entry = jobs.get(jobId)?.get(session);
    if (!entry) throw problem("현재 실행 중인 세션이 아닙니다.", 409);
    if (action === "stop") {
      if (entry.state !== "running" || entry.controller.signal.aborted)
        throw problem("이미 정지한 세션입니다.", 409);
      entry.controller.abort(
        Object.assign(problem("사용자가 이 세션을 정지했습니다.", 409), {
          code: "session_cancelled",
        }),
      );
    } else {
      if (!["paused", "failed"].includes(entry.state) || !entry.resume)
        throw problem("정지하거나 실패한 세션만 재시작할 수 있습니다.", 409);
      entry.state = "restarting";
      entry.resume();
    }
  }
  return { execute, action };
}
