import test from "node:test";
import assert from "node:assert/strict";
import { usePlanProgress } from "../src/composables/usePlanProgress.js";

test("plan progress separates server liveness, streamed output and completed calls", () => {
  const progress = usePlanProgress();
  progress.start("w", { id: "s", title: "명세" });
  progress.receive({ type: "start", timeoutSeconds: 600 });
  progress.receive({
    type: "plan-progress",
    call: 1,
    total: 3,
    stage: "초안",
    status: "running",
    provider: "codex",
    model: "test",
  });
  progress.receive({ type: "delta", text: "계획😀" });
  progress.receive({ type: "heartbeat" });
  assert.equal(progress.task.value.chars, 3);
  assert.equal(progress.task.value.completed, 0);
  assert(progress.task.value.lastSignalAt);
  assert(progress.task.value.lastOutputAt);
  progress.dismiss();
  assert(progress.task.value.active);
  progress.receive({
    type: "plan-progress",
    call: 1,
    total: 3,
    stage: "초안",
    status: "completed",
    durationMs: 1234,
  });
  assert.equal(progress.task.value.completed, 1);
  assert.equal(progress.task.value.steps[0].chars, 3);
  progress.receive({
    type: "plan-progress",
    phase: "saving",
    message: "저장 중",
  });
  assert.equal(progress.task.value.phase, "saving");
  progress.finish();
  assert.equal(progress.task.value.active, false);
  assert.equal(progress.task.value.phase, "completed");
  progress.dismiss();
  assert.equal(progress.task.value, null);
});

test("failed or interrupted generation preserves its stage history and error", () => {
  const progress = usePlanProgress();
  progress.start("w", { id: "s", title: "명세" });
  progress.receive({
    type: "plan-progress",
    call: 1,
    total: 1,
    status: "running",
  });
  progress.finish("연결이 끊겼습니다.");
  progress.receive({ type: "delta", text: "늦은 응답" });
  assert.equal(progress.task.value.steps[0].status, "stopped");
  assert.equal(progress.task.value.error, "연결이 끊겼습니다.");
  assert.equal(progress.task.value.chars, 0);
});

test("hiding progress retains the running task and question drafts", () => {
  const p = usePlanProgress();
  p.start("w", { id: "s", title: "명세" });
  assert.equal(p.visible.value, true);
  p.hide();
  assert.equal(p.task.value.active, true);
  p.questions(["보존 정책은 무엇인가요?"]);
  assert.equal(p.visible.value, true);
  assert.equal(p.task.value.active, false);
  p.task.value.answers[0] = "기존 데이터를 보존합니다.";
  p.hide();
  p.show();
  assert.equal(p.task.value.answers[0], "기존 데이터를 보존합니다.");
  assert.equal(p.task.value.phase, "questions");
});

test("live questions keep peers active, preserve the current draft and advance on acknowledgement", () => {
  const p = usePlanProgress();
  p.start("w", { id: "s", title: "spec" });
  p.receive({
    type: "plan-question",
    id: "a",
    question: "first",
    stage: "A",
    call: 1,
  });
  p.task.value.answers[0] = "draft";
  p.receive({
    type: "plan-question",
    id: "b",
    question: "second",
    stage: "B",
    call: 2,
  });
  p.receive({
    type: "plan-progress",
    stage: "B",
    call: 2,
    status: "running",
    total: 3,
  });
  assert.equal(p.task.value.phase, "questions");
  assert(p.task.value.active);
  assert.equal(p.task.value.answers[0], "draft");
  p.receive({ type: "plan-question-answered", id: "a", answer: "saved" });
  assert.equal(p.task.value.currentQuestion.id, "b");
  assert(p.task.value.message.includes("Awaiting clarification answers"));
  assert.equal(p.task.value.answers[0], "");
  p.receive({ type: "plan-question-answered", id: "b", answer: "done" });
  assert.equal(p.task.value.phase, "running");
  assert.equal(p.task.value.currentQuestion, null);
  assert.equal(p.task.value.questionQueue[0].answer, "saved");
});

test("automatic repair retains the failed attempt and keeps the new request running", () => {
  const progress = usePlanProgress();
  progress.start("w", { id: "s", title: "plan" });
  progress.receive({
    type: "plan-progress",
    call: 1,
    session: "writer-1",
    stage: "draft",
    status: "completed",
  });
  progress.receive({
    type: "plan-agent-state",
    session: "writer-1",
    state: "repairing",
    failure: { detail: "after omitted", repairAttempt: 1 },
  });
  progress.receive({
    type: "plan-agent-state",
    session: "writer-1",
    state: "running",
  });
  progress.receive({
    type: "plan-progress",
    call: 2,
    session: "writer-1",
    stage: "draft",
    status: "running",
  });
  assert.equal(progress.task.value.steps[0].status, "repairing");
  assert.equal(progress.task.value.steps[0].error, "after omitted");
  assert.equal(progress.task.value.steps[1].status, "running");
  assert.equal(progress.task.value.agents["writer-1"], "running");
  assert.equal(progress.task.value.completed, 0);
});

test("budget and stagnation are paused outcomes, never completed goals", () => {
  for (const reason of ["call_budget", "time_budget", "stagnation"]) {
    const p = usePlanProgress();
    p.start("w", { id: "s", title: "명세" });
    p.receive({ type: "plan-loop", stopReason: reason });
    p.finish();
    assert.equal(p.task.value.phase, "paused");
    assert.match(p.task.value.message, /Below target/);
  }
});
