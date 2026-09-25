import test from "node:test";
import assert from "node:assert/strict";
import { planQuestions, PlanQuestions } from "../server/plan-questions.mjs";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import { validatePlanSettings } from "../shared/plan-workflow.mjs";
const answer = {
  files: [
    {
      path: "questions.json",
      content: JSON.stringify({ questions: ["기존 데이터를 보존할까요?"] }),
    },
  ],
};
test("plan questions are bounded and cannot be mixed with partial HTML", () => {
  assert.deepEqual(planQuestions(answer), ["기존 데이터를 보존할까요?"]);
  assert.equal(planQuestions({ files: [] }), null);
  assert.throws(() =>
    planQuestions({
      files: [...answer.files, { path: "R.html", content: "partial" }],
    }),
  );
  assert.throws(() =>
    planQuestions({
      files: [{ path: "questions.json", content: '{"questions":[]}' }],
    }),
  );
});
test("question response stops the workflow before validation or saving and signals a resumable question", async () => {
  let validated = false;
  const events = [];
  await assert.rejects(
    runPlanWorkflow({
      settings: validatePlanSettings({ mode: "single" }),
      fallback: { provider: "codex", model: "test" },
      skills: [],
      context: "",
      draftPrompt: "",
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      run: async (_agent, _prompt, onEvent) => {
        onEvent({ type: "status", message: "외부 문서를 읽고 있습니다…" });
        return { text: JSON.stringify(answer) };
      },
      validateDraft: () => {
        validated = true;
      },
    }),
    (error) =>
      error instanceof PlanQuestions && error.questions[0].includes("보존"),
  );
  assert.equal(validated, false);
  assert(
    events.some(
      (event) => event.type === "status" && event.message.includes("외부 문서"),
    ),
  );
});

test("questions arrive before peers finish and only their writer resumes in its original session", async () => {
  let releasePeer, answerQuestion, asked, peerStarted;
  const peerGate = new Promise((resolve) => {
    releasePeer = resolve;
  });
  const questionSeen = new Promise((resolve) => {
    asked = resolve;
  });
  const peerSeen = new Promise((resolve) => {
    peerStarted = resolve;
  });
  const calls = new Map(),
    sessions = new Map();
  const controller = new AbortController();
  const run = runPlanWorkflow({
    settings: validatePlanSettings({
      mode: "compare",
      writers: 2,
      reviewers: 2,
    }),
    fallback: { provider: "codex", model: "test" },
    skills: [],
    context: "",
    draftPrompt: "DRAFT",
    signal: controller.signal,
    emit: () => {},
    validateDraft: () => {},
    ask: async ({ questions, signal }) => {
      assert.deepEqual(questions, ["기존 데이터를 보존할까요?"]);
      asked();
      return new Promise((resolve) => {
        answerQuestion = () =>
          resolve([{ question: questions[0], answer: "보존" }]);
        signal.addEventListener("abort", () => resolve([]), { once: true });
      });
    },
    run: async (_agent, prompt, _emit, session, signal) => {
      assert(prompt.startsWith("DRAFT"), "no next stage before peer completes");
      const id = session.id,
        n = (calls.get(id) || 0) + 1;
      calls.set(id, n);
      if (n === 1) sessions.set(id, session);
      else assert.equal(session, sessions.get(id));
      if (id === "writer-1" && n === 1) return { text: JSON.stringify(answer) };
      if (id === "writer-2") {
        peerStarted();
        await peerGate;
      }
      if (id === "writer-1") assert(prompt.includes("보존"));
      if (signal.aborted) throw Error("cancelled");
      return {
        text: JSON.stringify({
          message: "ok",
          files: [{ path: "R.html", content: "full" }],
        }),
      };
    },
  });
  const rejected = assert.rejects(run);
  await Promise.all([questionSeen, peerSeen]);
  assert.equal(calls.get("writer-2"), 1);
  answerQuestion();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.get("writer-1"), 2);
  assert.equal(calls.get("writer-2"), 1);
  controller.abort();
  releasePeer();
  await rejected;
});
