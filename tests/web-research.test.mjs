import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexClient, runOpenAI } from "../server/ai.mjs";
import { runClaude } from "../server/claude.mjs";
import { researchClaude } from "../server/claude-research.mjs";
import { createClaudeCode } from "../server/claude-code.mjs";
import { webSources } from "../shared/web-research.mjs";
import { runChatAnswer } from "../server/chat-answer.mjs";
const answer = JSON.stringify({
  message: "확인한 답변",
  proposal: null,
  files: [],
});
const source = { title: "Vue 공식 문서", url: "https://vuejs.org/guide/" };
const sse = (events) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));

test("sources reject unsafe schemes and credentials, deduplicate, and survive proposal repair", async () => {
  assert.deepEqual(
    webSources([
      source,
      source,
      { url: "javascript:alert(1)" },
      { url: "https://secret:password@example.com" },
    ]),
    [source],
  );
  assert.deepEqual(webSources(null), []);
  const calls = [];
  const result = await runChatAnswer({
    message: "명세 추가해줘",
    scoped: true,
    options: { prompt: "context", webSearch: "auto", onEvent() {} },
    run: async (options) => {
      calls.push(options);
      return calls.length === 1
        ? { text: answer, sources: [source] }
        : {
            text: JSON.stringify({
              message: "",
              proposal: null,
              files: [],
              specProposal: {
                title: "등록",
                requirements: [
                  { title: "등록", body: "내용", criteria: ["등록 완료"] },
                ],
              },
            }),
          };
    },
  });
  assert.equal(calls[1].webSearch, "off");
  assert.deepEqual(result.sources, [source]);
  assert(result.specProposal);
});

test("OpenAI search is optional, reports progress and returns citation metadata", async () => {
  const bodies = [],
    events = [];
  const run = (webSearch) =>
    runOpenAI({
      model: "test",
      key: "test",
      prompt: "문서",
      webSearch,
      onEvent: (e) => events.push(e),
      request: async (_, opts) => {
        bodies.push(JSON.parse(opts.body));
        return sse([
          { type: "response.web_search_call.in_progress" },
          { type: "response.output_text.delta", delta: answer },
          {
            type: "response.completed",
            response: {
              output: [
                {
                  content: [
                    { annotations: [{ type: "url_citation", ...source }] },
                  ],
                },
              ],
            },
          },
        ]);
      },
    });
  assert.deepEqual((await run("auto")).sources, [source]);
  await run("off");
  assert.deepEqual(bodies[0].tools, [{ type: "web_search" }]);
  assert.equal(bodies[1].tools, undefined);
  assert(events.some((e) => e.type === "status"));
});

test("Codex enables hosted search without enabling shell or sandbox networking", async () => {
  const client = new CodexClient("/unused");
  client.start = async () => {};
  const starts = [],
    turns = [],
    events = [];
  client.request = async (method, params) => {
    if (method === "thread/start") {
      starts.push(params);
      return { thread: { id: "t" } };
    }
    if (method === "turn/start") {
      turns.push(params);
      queueMicrotask(() => {
        for (const [method, extra] of [
          ["item/started", { item: { type: "webSearch" } }],
          ["item/completed", { item: { type: "agentMessage", text: answer } }],
          ["turn/completed", { turn: { status: "completed" } }],
        ])
          client.emit("notification", {
            method,
            params: { threadId: "t", ...extra },
          });
      });
      return { turn: { id: "turn" } };
    }
  };
  for (const webSearch of ["auto", "off"])
    await client.run({
      model: "test",
      cwd: "/unused",
      prompt: "문서",
      webSearch,
      onEvent: (e) => events.push(e),
    });
  assert.equal(starts[0].config.web_search, "live");
  assert.equal(starts[1].config.web_search, "disabled");
  assert.equal(starts[0].config["features.shell_tool"], false);
  assert.equal(turns[0].sandboxPolicy.networkAccess, false);
  assert(events.some((e) => e.type === "status"));
});

test("Claude Code exposes only web tools when enabled and reports both search and fetch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-web-"));
  const calls = [],
    events = [];
  const adapter = createClaudeCode({
    dataDir: dir,
    spawnProcess(_, args) {
      calls.push(args);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {};
      child.stdin.on("finish", () => {
        child.stdout.end(
          [
            {
              type: "assistant",
              message: {
                content: [
                  { type: "tool_use", name: "WebSearch" },
                  { type: "tool_use", name: "WebFetch" },
                ],
              },
            },
            { type: "result", structured_output: JSON.parse(answer) },
          ]
            .map((e) => JSON.stringify(e) + "\n")
            .join(""),
        );
        setImmediate(() => child.emit("close", 0));
      });
      return child;
    },
  });
  try {
    for (const webSearch of ["auto", "off"])
      await adapter.run({
        userId: "test",
        model: "test",
        prompt: "문서",
        webSearch,
        onEvent: (e) => events.push(e),
      });
    assert.equal(
      calls[0][calls[0].indexOf("--tools") + 1],
      "WebSearch,WebFetch",
    );
    assert.equal(
      calls[0][calls[0].indexOf("--allowedTools") + 1],
      "WebSearch,WebFetch",
    );
    assert.equal(calls[1][calls[1].indexOf("--tools") + 1], "");
    assert(!calls[1].includes("--allowedTools"));
    assert(events.some((e) => e.message?.includes("읽고")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude research continues pause_turn unchanged and preserves strict final JSON", async () => {
  const bodies = [];
  const paused = [{ type: "text", text: "조사 중" }];
  const result = await runClaude({
    model: "test",
    key: "test",
    prompt: "문서",
    webSearch: "auto",
    onEvent() {},
    request: async (_, opts) => {
      const body = JSON.parse(opts.body);
      bodies.push(body);
      if (body.stream)
        return sse([
          {
            type: "content_block_delta",
            delta: { type: "text_delta", text: answer },
          },
          { type: "message_delta", delta: { stop_reason: "end_turn" } },
          { type: "message_stop" },
        ]);
      return Response.json(
        bodies.length === 1
          ? { stop_reason: "pause_turn", content: paused }
          : {
              stop_reason: "end_turn",
              content: [{ type: "text", text: "확인됨", citations: [source] }],
            },
      );
    },
  });
  assert.deepEqual(bodies[1].messages[1], {
    role: "assistant",
    content: paused,
  });
  assert.equal(bodies[0].output_config, undefined);
  assert.equal(bodies[2].output_config.format.type, "json_schema");
  assert.equal(bodies[2].tools, undefined);
  assert.deepEqual(result.sources, [source]);
  assert.equal(result.text, answer);
});

test("Claude research fails clearly and honors cancellation without another request", async () => {
  await assert.rejects(
    researchClaude({
      model: "test",
      prompt: "x",
      onEvent() {},
      request: async () => new Response("", { status: 400 }),
    }),
    /웹 검색 설정/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    researchClaude({
      model: "test",
      prompt: "x",
      signal: controller.signal,
      onEvent() {},
      request: async () => {
        throw Error("should not request");
      },
    }),
    { name: "AbortError" },
  );
});
