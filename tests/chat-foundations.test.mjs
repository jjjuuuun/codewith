import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  conversationContext,
  planChatIntent,
} from "../shared/chat-context.mjs";
import { createChatAttachments } from "../server/chat-attachments.mjs";
import { createChatRuns } from "../server/chat-runs.mjs";
import { CodexPool, runOpenAI } from "../server/ai.mjs";
import { runClaude } from "../server/claude.mjs";
import { createClaudeCode } from "../server/claude-code.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const sse = (events) =>
  new Response(
    events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
  );

test("long conversations retain old agreements and retrieve relevant originals after compaction", () => {
  const messages = Array.from({ length: 70 }, (_, i) => ({
    id: "m" + i,
    role: i % 2 ? "assistant" : "user",
    text:
      i === 0 ? "고유계약 보존: 결제 통화는 KRW다." : "unrelated ".repeat(100),
  }));
  const normal = conversationContext(messages, "고유계약");
  assert.equal(normal.messages.length, 70);
  const compact = conversationContext(messages, "고유계약", 6000);
  assert(compact.compacted);
  assert(
    compact.retrieved.some((m) => m.id === "m0" && m.content.includes("KRW")),
  );
  assert(compact.summary);
  assert(JSON.stringify(compact).length < 10000);
});
test("questions never modify plans; explicit change requests do", () => {
  for (const message of [
    "왜 이 구조를 선택했어?",
    "계획 내용을 설명해줘",
    "어떻게 수정할 수 있나요?",
    "계획은 수정하지 마",
    "질문이 있어",
  ])
    assert.equal(planChatIntent(message), "discuss", message);
  for (const message of [
    "계획을 작성해줘",
    "계획 수정해줘",
    "DB의 중복 처리와 검증 절차를 보강해 줘.",
    "이 내용을 반영해줘",
  ])
    assert.equal(planChatIntent(message), "change", message);
});
test("attachments preserve complete text and real image bytes and enforce user/workspace ownership", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-attachments-"));
  const store = {
    db: {},
    workspace: (wid, uid) => {
      if (wid !== "w" || uid !== "u") throw Error("forbidden");
    },
    persist: async () => {},
  };
  try {
    const files = createChatAttachments(store, dir);
    const text = await files.upload("u", {
      workspaceId: "w",
      name: "기준.md",
      data: Buffer.from("전체 요구사항\n완료 기준").toString("base64"),
    });
    const image = await files.upload("u", {
      workspaceId: "w",
      name: "화면.png",
      data: png,
    });
    const context = await files.context("u", "w", [text.id, image.id]);
    assert(context.text.includes("완료 기준"));
    assert.equal(context.images[0].data, png);
    assert.equal(context.images[0].mime, "image/png");
    await assert.rejects(files.context("other", "w", [image.id]), /forbidden/);
    await assert.rejects(
      files.upload("u", {
        workspaceId: "w",
        name: "bad.exe",
        data: Buffer.from("hi").toString("base64"),
      }),
      /첨부/,
    );
    await assert.rejects(
      files.context("u", "w", Array(6).fill(text.id)),
      /5개/,
    );
    // A real PDF text stream, no external tools or paid model calls.
    const pdf =
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length 45 >> stream\nBT /F1 12 Tf 30 100 Td (Hello document) Tj ET\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF";
    const document = await files.upload("u", {
      workspaceId: "w",
      name: "document.pdf",
      data: Buffer.from(pdf).toString("base64"),
    });
    assert(
      (await files.context("u", "w", [document.id])).text.includes(
        "Hello document",
      ),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Codex authors use separate processes with the same private account home", () => {
  const pool = new CodexPool("/unused");
  const a = pool.get("u", "writer-1"),
    b = pool.get("u", "writer-2");
  assert.notEqual(a, b);
  assert.equal(a.home, b.home);
  assert.equal(pool.get("u", "writer-1"), a);
  pool.release("u", "writer-1");
  assert(!pool.clients.has("u:writer-1"));
  pool.close();
});
test("OpenAI and Claude receive images as native multimodal content, not text", async () => {
  const images = [{ mime: "image/png", data: png, name: "screen" }];
  let body;
  await runOpenAI({
    model: "test",
    prompt: "inspect",
    images,
    onEvent() {},
    request: async (_, opts) => {
      body = JSON.parse(opts.body);
      return sse([{ type: "response.completed", response: { output: [] } }]);
    },
  });
  assert.equal(body.input[0].content[1].type, "input_image");
  assert(body.input[0].content[1].image_url.endsWith(png));
  await runClaude({
    model: "test",
    prompt: "inspect",
    images,
    onEvent() {},
    request: async (_, opts) => {
      body = JSON.parse(opts.body);
      return sse([
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]);
    },
  });
  assert.equal(body.messages[0].content[0].type, "image");
  assert.equal(body.messages[0].content[0].source.data, png);
});
test("Claude Code sends image blocks through stream-json input", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-image-cli-"));
  let args,
    input = "";
  const adapter = createClaudeCode({
    dataDir: dir,
    spawnProcess(_, params) {
      args = params;
      const child = new EventEmitter();
      for (const k of ["stdout", "stderr", "stdin"])
        child[k] = new PassThrough();
      child.kill = () => {};
      child.stdin.on("data", (chunk) => (input += chunk));
      child.stdin.on("finish", () => {
        child.stdout.end(
          JSON.stringify({
            type: "result",
            structured_output: { message: "ok", files: [] },
          }) + "\n",
        );
        setImmediate(() => child.emit("close", 0));
      });
      return child;
    },
  });
  try {
    await adapter.run({
      userId: "test",
      model: "test",
      prompt: "inspect",
      images: [{ mime: "image/png", data: png }],
      onEvent() {},
    });
    assert(args.includes("--input-format"));
    assert.equal(JSON.parse(input).message.content[0].source.data, png);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("server restart preserves interrupted partial replies without executing a new request", () => {
  const store = {
    db: {
      chats: [],
      aiRuns: [
        {
          id: "r",
          kind: "chat",
          state: "running",
          userId: "u",
          workspaceId: "w",
          specId: null,
          threadId: "t",
          events: [
            { type: "start", userMessageId: "q" },
            { type: "delta", text: '{"message":"작성하던 응답' },
          ],
        },
      ],
    },
  };
  createChatRuns(store);
  assert.equal(store.db.chats[0].text, "작성하던 응답");
  assert(store.db.chats[0].partial);
  assert.equal(store.db.aiRuns[0].state, "interrupted");
});

test("disconnected streams replay a single continuing job with private access", async () => {
  let persisted = 0;
  const store = {
    db: { chats: [] },
    workspace(wid, uid) {
      assert.equal(wid, "w");
      assert.equal(uid, "u");
    },
    persist() {
      persisted++;
    },
  };
  const runs = createChatRuns(store);
  function response() {
    const res = new EventEmitter();
    res.body = "";
    res.writeHead = () => {};
    res.write = (text) => {
      res.body += text;
    };
    res.end = () => {
      res.emit("close");
    };
    return res;
  }
  let proceed, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    proceed = resolve;
  });
  const first = response();
  let calls = 0;
  const running = runs.start(
    "chat",
    {},
    first,
    { workspaceId: "w" },
    { id: "u" },
    async (_req, sink) => {
      calls++;
      sink.writeHead(200);
      sink.write('data: {"type":"delta","text":"first"}\n\n');
      started();
      await gate;
      sink.write('data: {"type":"answer","text":"complete"}\n\n');
    },
  );
  await ready;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert(
    persisted > 0,
    "synchronous Store.persist must survive the background timer",
  );
  first.destroyed = true;
  first.emit("close");
  const job = runs.latest("u", "w", null, "chat");
  assert.equal(job.state, "running");
  assert.throws(() => runs.get("other", job.id));
  const reconnected = response();
  runs.attach(runs.get("u", job.id), reconnected);
  assert.match(reconnected.body, /first/);
  proceed();
  await running;
  assert.match(reconnected.body, /complete/);
  assert.equal(calls, 1);
  assert.equal(runs.get("u", job.id).state, "completed");
});

test("parallel plan session deltas stay separate when persisted and replayed", async () => {
  const store = { db: { chats: [] }, workspace() {}, persist() {} };
  const runs = createChatRuns(store);
  const res = new EventEmitter();
  res.writeHead = () => {};
  res.write = () => {};
  res.end = () => res.emit("close");
  await runs.start(
    "plan",
    {},
    res,
    { workspaceId: "w" },
    { id: "u" },
    async (req, sink) => {
      sink.writeHead(200);
      for (const [call, text] of [
        [1, "A"],
        [2, "B"],
        [2, "C"],
        [1, "D"],
      ])
        sink.write(
          "data: " + JSON.stringify({ type: "delta", call, text }) + "\n\n",
        );
    },
  );
  assert.deepEqual(
    store.db.aiRuns[0].events.map((e) => [e.call, e.text]),
    [
      [1, "A"],
      [2, "BC"],
      [1, "D"],
    ],
  );
});
