import { planResponseSchema } from "../shared/plan-response-schema.mjs";
const responseSchema = planResponseSchema();
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runOpenAI } from "../server/ai.mjs";
import { runClaude } from "../server/claude.mjs";
import { createClaudeCode } from "../server/claude-code.mjs";

const sse = (events) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));

test("OpenAI keeps writer output and encrypted reasoning but gives judges no writer history", async () => {
  const bodies = [];
  const output = [
    { type: "reasoning", id: "r", encrypted_content: "encrypted", summary: [] },
    { role: "assistant", content: "draft" },
  ];
  const request = async (_, opts) => {
    bodies.push(JSON.parse(opts.body));
    return sse([
      { type: "response.output_text.delta", delta: "draft" },
      { type: "response.completed", response: { output } },
    ]);
  };
  const writer = {};
  const run = (prompt, session) =>
    runOpenAI({
      key: "test",
      model: "test",
      prompt,
      responseSchema,
      session,
      onEvent: () => {},
      request,
    });
  await run("draft", writer);
  await run("review", writer);
  await run("judge");
  assert.deepEqual(bodies[1].input, [
    { role: "user", content: "draft" },
    ...output,
    { role: "user", content: "review" },
  ]);
  assert.deepEqual(bodies[0].text.format.schema, responseSchema);
  assert.equal(bodies[1].store, false);
  assert.deepEqual(bodies[1].include, ["reasoning.encrypted_content"]);
  assert.equal(bodies[2].input, "judge");
});

test("Claude API carries only the selected writer conversation", async () => {
  const bodies = [];
  const request = async (_, opts) => {
    bodies.push(JSON.parse(opts.body));
    return sse([
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "answer" },
      },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ]);
  };
  const writer = {};
  const run = (prompt, session) =>
    runClaude({
      key: "test",
      model: "test",
      prompt,
      responseSchema,
      session,
      onEvent: () => {},
      request,
    });
  await run("draft", writer);
  await run("review", writer);
  await run("judge");
  assert.deepEqual(bodies[0].output_config.format.schema, responseSchema);
  assert.deepEqual(bodies[1].messages, [
    { role: "user", content: "draft" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "review" },
  ]);
  assert.deepEqual(bodies[2].messages, [{ role: "user", content: "judge" }]);
});

test("Claude Code resumes explicit writer IDs and never resumes for final judges", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-plan-session-"));
  const calls = [];
  const adapter = createClaudeCode({
    dataDir: dir,
    spawnProcess(binary, args) {
      calls.push(args);
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {};
      child.stdin.on("finish", () => {
        child.stdout.end(
          JSON.stringify({
            type: "result",
            session_id: "writer-session",
            structured_output: { message: "ok", proposal: null, files: [] },
          }) + "\n",
        );
        setImmediate(() => child.emit("close", 0));
      });
      return child;
    },
  });
  try {
    const writer = {};
    const run = (session) =>
      adapter.run({
        userId: "test",
        model: "test",
        prompt: "request",
        responseSchema,
        session,
        onEvent: () => {},
      });
    await run(writer);
    await run(writer);
    await run();
    assert.deepEqual(
      JSON.parse(calls[0][calls[0].indexOf("--json-schema") + 1]),
      responseSchema,
    );
    assert(!calls[0].includes("--no-session-persistence"));
    assert(!calls[0].includes("--resume"));
    assert.equal(calls[1][calls[1].indexOf("--resume") + 1], "writer-session");
    assert(calls[2].includes("--no-session-persistence"));
    assert(!calls[2].includes("--resume"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
