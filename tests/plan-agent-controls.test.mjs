import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { createPlanAgentControls } from "../server/plan-agent-controls.mjs";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import { validatePlanSettings } from "../shared/plan-workflow.mjs";
import { createPlanDialogue } from "../server/plan-dialogue.mjs";

const until = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await tick();
  }
  assert.fail("condition not reached");
};
test("stopping a writer keeps peers running and resumes only its stage in the same session", async () => {
  const controls = createPlanAgentControls(),
    parent = new AbortController();
  const sessions = [],
    events = [];
  let waiting = 0;
  const result = runPlanWorkflow({
    settings: validatePlanSettings({
      mode: "compare",
      writers: 2,
      rounds: 1,
      reviewers: 1,
    }),
    fallback: { provider: "codex", model: "test" },
    skills: [],
    context: "",
    draftPrompt: "DRAFT",
    signal: parent.signal,
    emit: (e) => events.push(e),
    validateDraft: () => {},
    control: (stage) =>
      controls.execute({
        ...stage,
        jobId: "job",
        emit: (e) => events.push(e),
        waiting: (n) => (waiting += n),
      }),
    run: async (config, prompt, emit, session, signal) => {
      sessions.push(session);
      if (
        prompt.startsWith("DRAFT") &&
        session.id === "writer-1" &&
        sessions.filter((s) => s === session).length === 1
      )
        await new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      if (prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
        parent.abort(Error("test ends at review barrier"));
        throw parent.signal.reason;
      }
      return {
        text: JSON.stringify({ files: [{ path: "R.html", content: "full" }] }),
      };
    },
  });
  const done = assert.rejects(result, /test ends at review barrier/);
  await until(() =>
    events.some((e) => e.session === "writer-2" && e.state === "completed"),
  );
  controls.action("job", "writer-1", "stop");
  await until(() => waiting === 1);
  assert.equal(sessions.length, 2);
  assert.throws(() => controls.action("other", "writer-1", "restart"));
  controls.action("job", "writer-1", "restart");
  assert.throws(() => controls.action("job", "writer-1", "restart"));
  await done;
  assert.strictEqual(sessions[2], sessions[0]);
  assert.equal(waiting, 0);
  assert.throws(() => controls.action("job", "writer-1", "stop"));
});
test("stopping a waiting question cancels it; whole-plan abort releases a paused session", async () => {
  const controls = createPlanAgentControls(),
    dialogue = createPlanDialogue(),
    parent = new AbortController();
  const events = [];
  let waiting = 0;
  const task = controls.execute({
    jobId: "j",
    session: { id: "writer" },
    signal: parent.signal,
    emit: (e) => events.push(e),
    waiting: (n) => (waiting += n),
    run: (signal) =>
      dialogue.ask({
        userId: "u",
        workspaceId: "w",
        jobId: "j",
        questions: ["question"],
        stage: "draft",
        call: 1,
        signal,
        emit: (e) => events.push(e),
        waiting: (n) => (waiting += n),
      }),
  });
  const done = assert.rejects(task, /whole stop/);
  const id = events.find((e) => e.type === "plan-question").id;
  controls.action("j", "writer", "stop");
  await until(() => events.some((e) => e.state === "paused"));
  assert(
    events.some((e) => e.type === "plan-question-cancelled" && e.id === id),
  );
  assert.throws(() => dialogue.answer("u", "w", "j", id, "late"));
  assert.equal(waiting, 1);
  parent.abort(Error("whole stop"));
  await done;
  assert.equal(waiting, 0);
});

test("a failed stage waits independently and retries with corrective context and the same session", async () => {
  const controls = createPlanAgentControls({ validationRetries: 0 }),
    parent = new AbortController();
  const events = [],
    requests = [];
  let waiting = 0;
  const result = runPlanWorkflow({
    settings: validatePlanSettings({ mode: "single" }),
    fallback: { provider: "codex", model: "test" },
    skills: [],
    context: "",
    draftPrompt: "DRAFT\noutput contract",
    signal: parent.signal,
    emit: (e) => events.push(e),
    validateDraft: (files) => {
      if (files[0].content === "invalid")
        throw Object.assign(Error("R.html invalid inner JSON"), {
          status: 422,
        });
    },
    control: (stage) =>
      controls.execute({
        ...stage,
        jobId: "j",
        emit: (e) => events.push(e),
        waiting: (n) => (waiting += n),
      }),
    run: async (config, prompt, emit, session) => {
      requests.push({ prompt, session });
      return {
        text: JSON.stringify({
          files: [
            {
              path: "R.html",
              content: requests.length === 1 ? "invalid" : "valid",
            },
          ],
        }),
      };
    },
  });
  await until(() => events.some((e) => e.state === "failed"));
  assert.equal(parent.signal.aborted, false);
  assert.equal(waiting, 1);
  assert.equal(events.find((e) => e.state === "failed").failure.call, 1);
  // A separate writer can complete while this stage is waiting for recovery.
  assert.equal(
    await controls.execute({
      jobId: "j",
      session: { id: "peer" },
      signal: parent.signal,
      emit: (e) => events.push(e),
      waiting: (n) => (waiting += n),
      run: async () => "peer completed",
    }),
    "peer completed",
  );
  controls.action("j", "writer-1", "restart");
  const completed = await result;
  assert.equal(completed.answer.files[0].content, "valid");
  assert.equal(requests.length, 2);
  assert.strictEqual(requests[0].session, requests[1].session);
  assert.match(requests[1].prompt, /R.html invalid inner JSON/);
  assert.equal(waiting, 0);
});

test("a draft failure does not abort its active peer or repeat the peer on recovery", async () => {
  const controls = createPlanAgentControls(),
    parent = new AbortController();
  const events = [],
    counts = new Map();
  let releasePeer, peerSignal;
  const gate = new Promise((resolve) => {
    releasePeer = resolve;
  });
  const execution = runPlanWorkflow({
    settings: validatePlanSettings({
      mode: "compare",
      writers: 2,
      rounds: 1,
      reviewers: 1,
    }),
    fallback: { provider: "codex", model: "test" },
    skills: [],
    context: "",
    draftPrompt: "DRAFT",
    signal: parent.signal,
    emit: (e) => events.push(e),
    validateDraft: () => {},
    control: (stage) =>
      controls.execute({
        ...stage,
        jobId: "j",
        emit: (e) => events.push(e),
        waiting: () => {},
      }),
    run: async (config, prompt, emit, session, signal) => {
      if (prompt.startsWith("CODEWITH_PLAN_REVIEW")) {
        parent.abort(Error("review barrier reached"));
        throw parent.signal.reason;
      }
      counts.set(session.id, (counts.get(session.id) || 0) + 1);
      if (session.id === "writer-1" && counts.get(session.id) === 1)
        throw Error("provider failed");
      if (session.id === "writer-2") {
        peerSignal = signal;
        await gate;
      }
      return {
        text: JSON.stringify({ files: [{ path: "R.html", content: "full" }] }),
      };
    },
  });
  const done = assert.rejects(execution, /review barrier reached/);
  await until(() =>
    events.some((e) => e.session === "writer-1" && e.state === "failed"),
  );
  assert.equal(peerSignal.aborted, false);
  releasePeer();
  await until(() =>
    events.some((e) => e.session === "writer-2" && e.state === "completed"),
  );
  assert.equal(parent.signal.aborted, false);
  controls.action("j", "writer-1", "restart");
  await done;
  assert.equal(counts.get("writer-1"), 2);
  assert.equal(counts.get("writer-2"), 1);
});

test("validation failures automatically repair only the failing code and retain other requirements", async () => {
  const { renderPlanHTML, PLAN_FIELDS } = await import("../shared/plans.mjs");
  const controls = createPlanAgentControls({ validationRetries: 2 });
  const parent = new AbortController();
  const events = [],
    requests = [];
  const base = Object.fromEntries(
    PLAN_FIELDS.map((k) => [k, k === "mockup" ? "" : "keep-" + k]),
  );
  const good = { path: "A.html", content: { ...base } };
  const bad = {
    path: "B.html",
    content: { ...base, after: "```js\n// ...\n```" },
  };
  const fixed = "```js\nconst value = 1;\n```";
  const result = await runPlanWorkflow({
    settings: validatePlanSettings({ mode: "single" }),
    fallback: { provider: "codex", model: "test" },
    skills: [],
    context: "",
    draftPrompt: "DRAFT\ncontract",
    signal: parent.signal,
    emit: (e) => events.push(e),
    validateDraft: (files) =>
      renderPlanHTML(
        {
          title: "plan",
          requirements: [
            { id: "A", title: "a" },
            { id: "B", title: "b" },
          ],
        },
        files,
      ),
    control: (stage) =>
      controls.execute({
        ...stage,
        jobId: "repair",
        emit: (e) => events.push(e),
        waiting: () =>
          assert.fail("automatic repair must not wait for a person"),
      }),
    run: async (_, prompt, emit, session) => {
      requests.push({ prompt, session });
      return {
        text: JSON.stringify({
          message: "result",
          files:
            requests.length === 1
              ? [good, bad]
              : [
                  {
                    ...bad,
                    content: {
                      ...base,
                      before: "unwanted rewrite",
                      after: fixed,
                    },
                  },
                ],
        }),
      };
    },
  });
  assert.equal(requests.length, 2);
  assert.strictEqual(requests[0].session, requests[1].session);
  assert.match(requests[1].prompt, /B.html · after/);
  assert.match(requests[1].prompt, /지적한 부분만 수정/);
  assert.deepEqual(result.answer.files[0], good);
  assert.equal(result.answer.files[1].content.before, base.before);
  assert.equal(result.answer.files[1].content.after, fixed);
  assert(events.some((e) => e.state === "repairing"));
  assert(!events.some((e) => e.state === "failed"));
});

test("automatic repair is bounded and global stop still releases an exhausted session", async () => {
  const controls = createPlanAgentControls({ validationRetries: 2 });
  const parent = new AbortController();
  let calls = 0,
    waiting = 0;
  const events = [];
  const task = controls.execute({
    jobId: "limit",
    session: { id: "s" },
    signal: parent.signal,
    emit: (e) => events.push(e),
    waiting: (n) => (waiting += n),
    run: async () => {
      calls++;
      throw Object.assign(Error("invalid"), {
        status: 422,
        planStep: { call: calls },
      });
    },
  });
  const done = assert.rejects(task, /stop/);
  await until(() => waiting === 1);
  assert.equal(calls, 3);
  assert.equal(events.filter((e) => e.state === "repairing").length, 2);
  parent.abort(Error("stop"));
  await done;
  assert.equal(waiting, 0);
});
