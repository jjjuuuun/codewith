import test from "node:test";
import assert from "node:assert/strict";
import { planFailure } from "../server/plan-failure.mjs";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import { validatePlanSettings } from "../shared/plan-workflow.mjs";
test("failure details distinguish timeout and cancellation and redact credentials", () => {
  const e = Object.assign(
    Error("quota exceeded sk-secret123 Bearer private api_key=private"),
    { planStep: { stage: "draft", provider: "codex", model: "test", call: 2 } },
  );
  const f = planFailure(e);
  assert.equal(f.call, 2);
  assert(f.message.includes("quota exceeded"));
  assert(!f.detail.includes("private"));
  assert(!f.detail.includes("secret123"));
  const abort = new AbortController();
  abort.abort(Object.assign(Error("execution timeout"), { code: "timeout" }));
  assert.equal(planFailure(e, abort.signal).kind, "timeout");
  assert.equal(planFailure(e, abort.signal).detail, "execution timeout");
});
test("invalid candidate reports the originating model, preserves raw response and marks its step failed", async () => {
  const events = [];
  await assert.rejects(
    runPlanWorkflow({
      settings: validatePlanSettings({ mode: "single" }),
      fallback: { provider: "codex", model: "test" },
      skills: [],
      context: "",
      draftPrompt: "",
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      run: async () => ({
        text: JSON.stringify({
          files: [{ path: "R.html", content: "incomplete" }],
        }),
      }),
      validateDraft: () => {
        throw Object.assign(Error("omitted code"), { status: 422 });
      },
    }),
    (e) =>
      e.planStep?.model === "test" &&
      e.planStep?.call === 1 &&
      e.planStep.chars > 0 &&
      e.planStep.durationMs >= 0,
  );
  assert(
    events.some(
      (e) => e.type === "plan-agent-response" && e.text.includes("incomplete"),
    ),
  );
  assert(
    events.some(
      (e) =>
        e.type === "plan-progress" && e.call === 1 && e.status === "failed",
    ),
  );
});
