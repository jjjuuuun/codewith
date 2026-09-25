import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { CodexClient, runOpenAI } from "../server/ai.mjs";
import { runClaude } from "../server/claude.mjs";
import { planFailure } from "../server/plan-failure.mjs";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import { validatePlanSettings } from "../shared/plan-workflow.mjs";
const sse = (events) =>
  new Response(
    events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
  );

function client() {
  const c = new CodexClient("/unused");
  c.start = async () => {};
  c.request = async (method) =>
    method === "thread/start"
      ? { thread: { id: "t" } }
      : method === "turn/start"
        ? { turn: { id: "r" } }
        : {};
  return c;
}
test("Codex local thirty-minute deadline has a distinct cause, not a user stop", async (t) => {
  const original = globalThis.setTimeout;
  let deadline;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms === 1800000) deadline = fn;
    return original(fn, ms, ...args);
  });
  const c = client();
  const running = c.run({ model: "test", prompt: "test", onEvent() {} });
  const done = assert.rejects(
    running,
    (e) =>
      e.code === "request_timeout" && e.diagnostics.timeoutSeconds === 1800,
  );
  await tick();
  assert.equal(typeof deadline, "function");
  deadline();
  await done;
  assert.equal(c.busy, false);
});
test("Codex distinguishes explicit session stop from an unexplained provider interruption", async () => {
  const controller = new AbortController(),
    c = client();
  const running = c.run({
    model: "test",
    prompt: "test",
    signal: controller.signal,
    onEvent() {},
  });
  const done = assert.rejects(running, (e) => e.code === "session_cancelled");
  await tick();
  controller.abort(
    Object.assign(Error("manual stop"), { code: "session_cancelled" }),
  );
  await done;
  const second = c.run({ model: "test", prompt: "test", onEvent() {} });
  const interrupted = assert.rejects(
    second,
    (e) => e.code === "provider_interrupted",
  );
  await tick();
  c.emit("notification", {
    method: "turn/completed",
    params: { threadId: "t", turn: { id: "r", status: "interrupted" } },
  });
  await interrupted;
});
test("explicit provider output limits retain termination reason and usage", async () => {
  const events = [];
  await assert.rejects(
    runOpenAI({
      model: "test",
      prompt: "test",
      onEvent: (e) => events.push(e),
      request: async () =>
        sse([
          {
            type: "response.incomplete",
            response: {
              incomplete_details: { reason: "max_output_tokens" },
              usage: { input_tokens: 20, output_tokens: 30 },
            },
          },
        ]),
    }),
    (e) =>
      e.code === "output_limit" &&
      e.diagnostics.providerReason === "max_output_tokens",
  );
  assert.equal(events.at(-1).usage.output_tokens, 30);
  await assert.rejects(
    runClaude({
      model: "test",
      prompt: "test",
      onEvent: (e) => events.push(e),
      request: async () =>
        sse([
          {
            type: "message_delta",
            delta: { stop_reason: "max_tokens" },
            usage: { output_tokens: 40 },
          },
          { type: "message_stop" },
        ]),
    }),
    (e) => e.code === "output_limit",
  );
  await assert.rejects(
    runOpenAI({
      model: "test",
      prompt: "test",
      onEvent() {},
      request: async () =>
        sse([
          {
            type: "response.incomplete",
            response: { incomplete_details: { reason: "unknown_reason" } },
          },
        ]),
    }),
    (e) => e.code === "provider",
  );
});
test("workflow failures retain received characters, elapsed time and reported tokens", async () => {
  await assert.rejects(
    runPlanWorkflow({
      settings: validatePlanSettings({ mode: "single" }),
      fallback: { provider: "codex", model: "test" },
      skills: [],
      context: "",
      draftPrompt: "",
      signal: new AbortController().signal,
      emit() {},
      validateDraft() {},
      run: async (config, prompt, emit) => {
        emit({ type: "delta", text: "응답😀" });
        emit({
          type: "usage",
          usage: { last: { inputTokens: 20, outputTokens: 30 } },
        });
        throw Object.assign(Error("deadline"), {
          code: "request_timeout",
          diagnostics: { timeoutSeconds: 600 },
        });
      },
    }),
    (e) => {
      const f = planFailure(e);
      assert.equal(f.chars, 3);
      assert(f.durationMs >= 0);
      assert.equal(f.usage.output, 30);
      assert.equal(f.timeoutSeconds, 600);
      assert.equal(f.label, "요청당 시간 초과");
      return true;
    },
  );
});
