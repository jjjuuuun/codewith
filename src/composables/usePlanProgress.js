import { t as __t } from "../i18n/index.js";
import { ref } from "vue";
import { planStopLabels } from "../../shared/plan-loop.mjs";

export function usePlanProgress() {
  const task = ref(null);
  const visible = ref(false);
  function start(workspaceId, spec) {
    visible.value = true;
    task.value = {
      workspaceId,
      specId: spec.id,
      title: spec.title,
      active: true,
      phase: "preparing",
      message: __t("프로젝트 코드와 AI 연결 준비 중…"),
      startedAt: Date.now(),
      endedAt: null,
      lastSignalAt: null,
      lastOutputAt: null,
      chars: 0,
      total: 0,
      completed: 0,
      steps: [],
      agents: {},
      questionQueue: [],
      error: "",
    };
  }
  function receive(event) {
    const t = task.value;
    if (!t?.active) return;
    t.lastSignalAt = Date.now();
    if (event.type === "plan-loop") t.loop = event;
    if (event.type === "error") {
      t.failure = event.failure || null;
      const failed = t.steps.find((s) => s.call === event.failure?.call);
      if (failed) {
        failed.error = event.failure.detail;
        failed.failure = event.failure;
        if (!["cancelled", "timeout"].includes(event.failure.kind))
          failed.status = "failed";
      }
    }
    if (event.type === "plan-agent-state") {
      t.agents[event.session] = event.state;
      const latest = t.steps.findLast((s) => s.session === event.session);
      if (latest && ["paused", "failed", "repairing"].includes(event.state)) {
        latest.status = event.state;
        if (event.failure) {
          latest.error = event.failure.detail;
          latest.failure = event.failure;
        }
        t.completed = t.steps.filter((s) => s.status === "completed").length;
      }
    }
    if (event.type === "plan-question-cancelled") {
      const question = t.questionQueue.find((q) => q.id === event.id);
      if (question) question.cancelled = true;
    }
    if (event.type === "plan-agent-response") {
      const step = t.steps.find((s) => s.call === event.call);
      if (step) step.response = event.text;
    }
    if (
      event.type === "plan-question" &&
      !t.questionQueue.some((q) => q.id === event.id)
    )
      t.questionQueue.push({ ...event, answer: "", answered: false });
    if (event.type === "plan-question-answered") {
      const question = t.questionQueue.find((q) => q.id === event.id);
      if (question) {
        question.answered = true;
        question.answer = event.answer;
      }
    }

    if (event.type === "start") {
      t.phase = "running";
      t.timeoutSeconds = event.timeoutSeconds;
    }
    if (event.type === "plan-progress") {
      t.message = event.message;
      t.phase = event.phase || "running";
      if (event.call) {
        t.total = Math.max(t.total, event.total || 0);
        const old = t.steps.find((step) => step.call === event.call);
        if (old) Object.assign(old, event);
        else t.steps.push({ ...event, chars: 0 });
        t.completed = t.steps.filter(
          (step) => step.status === "completed",
        ).length;
      }
    }
    if (event.type === "delta") {
      const chars = Array.from(event.text || "").length;
      t.chars += chars;
      if (chars) t.lastOutputAt = Date.now();
      const current = t.steps.find((step) =>
        event.call ? step.call === event.call : step.status === "running",
      );
      if (current) {
        current.chars += chars;
        current.output = (current.output || "") + (event.text || "");
      }
    }
    if (event.type === "status" && event.message) t.message = event.message;
    const next = t.questionQueue.find((q) => !q.answered && !q.cancelled);
    if (next) {
      if (t.currentQuestion?.id !== next.id) {
        t.currentQuestion = next;
        t.message = __t("{0} · 확인 질문 답변 대기", [next.stage]);
        t.questions = [next.question];
        t.answers = [next.answer || ""];
        t.questionIndex = 0;
        t.answerError = "";
      }
      t.phase = "questions";
    } else if (t.currentQuestion) {
      t.currentQuestion = null;
      t.phase = "running";
      t.message =
        event.type === "plan-question-cancelled"
          ? __t("해당 세션의 질문 대기를 취소했습니다.")
          : __t("답변을 전달했습니다. 해당 에이전트가 작업을 이어갑니다…");
    }
  }
  function finish(error = "", disconnected = false) {
    if (!task.value) return;
    Object.assign(task.value, {
      active: false,
      endedAt: Date.now(),
      error,
      phase: disconnected
        ? "disconnected"
        : error
          ? "failed"
          : task.value.loop?.stopReason &&
              task.value.loop.stopReason !== "target_met"
            ? "paused"
            : "completed",
      message:
        error ||
        __t(planStopLabels[task.value.loop?.stopReason]) ||
        __t("계획과 평가를 저장했습니다."),
    });
    for (const step of task.value.steps)
      if (["running", "waiting", "paused"].includes(step.status))
        step.status = disconnected
          ? "unknown"
          : error
            ? "stopped"
            : "completed";
  }
  return {
    task,
    visible,
    show: () => {
      if (task.value) visible.value = true;
    },
    hide: () => {
      visible.value = false;
    },
    questions: (questions) => {
      Object.assign(task.value, {
        active: false,
        phase: "questions",
        endedAt: Date.now(),
        questions,
        questionIndex: 0,
        answers: questions.map(() => ""),
        message: __t("계획을 이어가기 전에 답변이 필요합니다."),
      });
      visible.value = true;
    },
    start,
    receive,
    finish,
    dismiss: () => {
      if (!task.value?.active) {
        task.value = null;
        visible.value = false;
      }
    },
  };
}
