import test from "node:test";
import assert from "node:assert/strict";
import { createToolApprovals } from "../server/tool-approvals.mjs";
import { runChatAnswer } from "../server/chat-answer.mjs";
import { runClaudeProject } from "../server/claude-project.mjs";
import { CodexClient, runOpenAI } from "../server/ai.mjs";
import { runClaude } from "../server/claude.mjs";

test("native chat preserves Markdown and arbitrary JSON without requiring an envelope", async () => {
  for (const text of [
    '## 설명\n```js\nconsole.log("ok")\n```',
    '{"message":"example"}',
  ]) {
    const answer = await runChatAnswer({
      message: "설명해줘",
      scoped: false,
      options: {},
      run: async (options) => {
        assert.equal(options.responseSchema, null);
        return { text };
      },
    });
    assert.equal(answer.message, text);
  }
});

test("approval requires matching user and job; cancellation and late replies cannot execute tools", async () => {
  const approvals = createToolApprovals();
  const events = [];
  const controller = new AbortController();
  const pending = approvals.request({
    userId: "u",
    jobId: "j",
    detail: { command: "test" },
    signal: controller.signal,
    emit: (e) => events.push(e),
  });
  const id = events[0].id;
  assert.throws(() => approvals.answer("other", "j", id, true));
  assert.throws(() => approvals.answer("u", "other", id, true));
  controller.abort();
  assert.equal(await pending, false);
  assert.throws(() => approvals.answer("u", "j", id, true));
  const next = approvals.request({
    userId: "u",
    jobId: "j",
    emit: (e) => events.push(e),
  });
  approvals.answer("u", "j", events.at(-1).id, true);
  assert.equal(await next, true);
});

test("Codex enables sandboxed project tools only for execution chat and forwards native approval", async () => {
  const client = new CodexClient("/tmp/unused-codewith-test");
  client.start = async () => {};
  const calls = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "t" } };
    if (method === "turn/start") {
      setImmediate(() =>
        client.emit("notification", {
          method: "turn/completed",
          params: { threadId: "t", turn: { status: "completed" } },
        }),
      );
      return { turn: { id: "turn" } };
    }
  };
  await client.run({
    prompt: "test",
    cwd: "/tmp/project",
    projectTools: true,
    responseSchema: null,
    onEvent() {},
  });
  assert.equal(calls[0].params.sandbox, "workspace-write");
  assert.equal(calls[1].params.approvalPolicy, "untrusted");
  assert.deepEqual(calls[1].params.sandboxPolicy.writableRoots, [
    "/tmp/project",
  ]);
  assert(!("outputSchema" in calls[1].params));
  calls.length = 0;
  await client.run({ prompt: "plan", onEvent() {} });
  assert.equal(calls[0].params.sandbox, "read-only");
  assert.equal(calls[0].params.config["features.shell_tool"], false);
  const replies = [];
  client.proc = {
    stdin: { writable: true, write: (line) => replies.push(JSON.parse(line)) },
  };
  client.approve = async (detail) => detail.command === "allowed";
  await client.handleRequest({
    id: 1,
    method: "item/commandExecution/requestApproval",
    params: { command: "allowed" },
  });
  await client.handleRequest({
    id: 2,
    method: "item/commandExecution/requestApproval",
    params: { command: "denied" },
  });
  assert.equal(replies[0].result.decision, "accept");
  assert.equal(replies[1].result.decision, "decline");
});

test("Claude project adapter uses native permissions, streams text, and retains session", async () => {
  const events = [],
    session = {};
  const result = await runClaudeProject({
    prompt: "test",
    cwd: "/tmp/project",
    env: {},
    model: "test",
    session,
    approve: async () => false,
    onEvent: (e) => events.push(e),
    queryAgent: async function* ({ options }) {
      assert.equal(options.cwd, "/tmp/project");
      assert.equal(options.permissionMode, "default");
      assert.equal(options.systemPrompt.preset, "claude_code");
      assert.equal(
        (await options.canUseTool("Bash", { command: "test" })).behavior,
        "deny",
      );
      yield {
        type: "stream_event",
        event: { delta: { type: "text_delta", text: "완료" } },
      };
      yield { type: "result", result: "완료", session_id: "s" };
    },
  });
  assert.equal(result.text, "완료");
  assert.equal(session.sessionId, "s");
  assert.equal(events[0].text, "완료");
});

test("API native chat omits response schemas while structured plan retains them", async () => {
  const sse = (events) =>
    new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    );
  await runOpenAI({
    key: "test",
    model: "test",
    prompt: "text",
    responseSchema: null,
    onEvent() {},
    request: async (_, init) => {
      assert(!JSON.parse(init.body).text);
      return sse([
        { type: "response.output_text.delta", delta: "text" },
        { type: "response.completed", response: {} },
      ]);
    },
  });
  await runClaude({
    key: "test",
    model: "test",
    prompt: "text",
    responseSchema: null,
    onEvent() {},
    request: async (_, init) => {
      assert(!JSON.parse(init.body).output_config);
      return sse([
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "text" },
        },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]);
    },
  });
});

test("native user questions require complete answers and keep their provider keys", async () => {
  const approvals = createToolApprovals();
  let event;
  const pending = approvals.request({
    userId: "u",
    jobId: "j",
    detail: {
      tool: "AskUserQuestion",
      input: { questions: [{ question: "대상 폴더?" }, { question: "언어?" }] },
    },
    emit: (value) => {
      if (value.type === "tool-approval") event = value;
    },
  });
  assert.throws(() =>
    approvals.answer("u", "j", event.id, true, { "언어?": "JS" }),
  );
  approvals.answer("u", "j", event.id, true, {
    "대상 폴더?": "src",
    "언어?": "JS",
    unexpected: "ignored",
  });
  assert.deepEqual(await pending, {
    answers: { "대상 폴더?": "src", "언어?": "JS" },
  });
});
