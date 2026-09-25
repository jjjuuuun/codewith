import { planResponseSchema } from "../shared/plan-response-schema.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, parseAnswer, CodexClient } from "../server/ai.mjs";
import { sample } from "./fixtures.mjs";
test("image bytes are not mistaken for visual analysis or inserted in text prompts", () => {
  const document = sample();
  document.specs[0].requirements[0].resources.push({
    id: "IMG",
    type: "image",
    title: "등록 목업",
    data: "data:image/png;base64," + "A".repeat(1000000),
  });
  const prompt = buildPrompt({
    document,
    specId: "SPEC-REG",
    role: "supervisor",
    message: "검토해줘",
    history: [],
    selectedFiles: [],
  });
  assert(prompt.length < 5000);
  assert(prompt.includes("등록 목업"));
  assert(prompt.includes("픽셀을 분석하지 않았습니다"));
  assert(!prompt.includes("base64"));
  assert(document.specs[0].requirements[0].resources[1].data.length > 1000000);
});
test("provider output cannot inject unsafe or duplicate file paths", () => {
  const output = (files) =>
    JSON.stringify({ message: "result", proposal: null, files });
  for (const p of [
    "../secret",
    "/absolute",
    "__proto__",
    "src/.env",
    "C:\\secret",
  ])
    assert.throws(() =>
      parseAnswer(output([{ path: p, content: "x" }]), "developer"),
    );
  assert.throws(() =>
    parseAnswer(
      output([
        { path: "A.java", content: "x" },
        { path: "A.java", content: "y" },
      ]),
      "developer",
    ),
  );
  assert.throws(() =>
    parseAnswer(output([{ path: "A.java", content: "x" }]), "tutor"),
  );
});
test("Codex final structured answer supersedes intermediate commentary", async () => {
  const c = new CodexClient("/unused");
  c.start = async () => {};
  const final = JSON.stringify({ message: "완료", proposal: null, files: [] });
  c.request = async (method, params) => {
    if (method === "thread/start") return { thread: { id: "thread-test" } };
    if (method === "turn/start") {
      assert.deepEqual(params.outputSchema, planResponseSchema());
      queueMicrotask(() => {
        const emit = (method, params) =>
          c.emit("notification", {
            method,
            params: { threadId: "thread-test", ...params },
          });
        emit("item/agentMessage/delta", { delta: "분석 중입니다." });
        emit("item/completed", {
          item: { type: "agentMessage", text: "분석 중입니다." },
        });
        emit("item/agentMessage/delta", { delta: final });
        emit("item/completed", { item: { type: "agentMessage", text: final } });
        emit("turn/completed", {
          turn: { id: "turn-test", status: "completed" },
        });
      });
      return { turn: { id: "turn-test" } };
    }
    return {};
  };
  const result = await c.run({
    prompt: "hi",
    responseSchema: planResponseSchema(),
    model: "test",
    cwd: "/unused",
    onEvent: () => {},
  });
  assert.equal(result.text, final);
  assert.equal(c.busy, false);
});

test("workspace prompts include all specs with image redaction while scoped prompts exclude other specs", () => {
  const document = sample(),
    second = structuredClone(document.specs[0]);
  second.id = "SPEC-SECOND";
  second.title = "OTHER-SPEC-UNIQUE";
  second.requirements[0].resources.push({
    id: "IMG",
    type: "image",
    title: "목업",
    data: "data:image/png;base64,SECRETPIXELS",
  });
  document.specs.push(second);
  const args = {
    document,
    role: "discuss",
    message: "검토",
    history: [],
    selectedFiles: [],
  };
  const whole = buildPrompt({ ...args, specId: null }),
    scoped = buildPrompt({ ...args, specId: "SPEC-REG" });
  assert(whole.includes("OTHER-SPEC-UNIQUE"));
  assert(!whole.includes("SECRETPIXELS"));
  assert(!scoped.includes("OTHER-SPEC-UNIQUE"));
  assert.throws(() => buildPrompt({ ...args, specId: "missing" }), /찾을 수/);
});

test("Codex writer turns reuse their own thread while final judging starts a new one", async () => {
  const c = new CodexClient("/unused");
  c.start = async () => {};
  let starts = 0;
  const turns = [];
  c.request = async (method, params) => {
    if (method === "thread/start")
      return { thread: { id: `thread-${++starts}` } };
    if (method === "turn/start") {
      turns.push(params.threadId);
      queueMicrotask(() =>
        c.emit("notification", {
          method: "turn/completed",
          params: {
            threadId: params.threadId,
            turn: { id: "turn", status: "completed" },
          },
        }),
      );
      return { turn: { id: "turn" } };
    }
    return {};
  };
  const a = {},
    b = {};
  const run = (session) =>
    c.run({
      session,
      prompt: "step",
      model: "same-model",
      cwd: "/unused",
      onEvent: () => {},
    });
  await run(a);
  await run(b);
  await run(a);
  await run(b);
  await run(a);
  await run();
  await run();
  assert.equal(starts, 4);
  assert.deepEqual(turns, [
    "thread-1",
    "thread-2",
    "thread-1",
    "thread-2",
    "thread-1",
    "thread-3",
    "thread-4",
  ]);
});
