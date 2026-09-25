import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createClaudeAuth } from "../server/claude-auth.mjs";
test("Claude code input is enabled only after the actual CLI prompt, with complete code validation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-claude-auth-"));
  let child,
    received = "";
  const adapter = createClaudeAuth({
    dataDir: dir,
    spawnProcess() {
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdin.on("data", (b) => (received += b));
      child.kill = () => {};
      return child;
    },
  });
  try {
    const state = adapter.login("test");
    assert.equal(state.codeInputReady, false);
    assert.throws(() => adapter.code("test", "code#state"));
    child.stdout.write(
      "If the browser did not open: https://claude.ai/oauth/authorize?test=1\n",
    );
    assert.ok(state.authUrl);
    assert.equal(state.codeInputReady, false);
    child.stdout.write("Paste code here if ");
    child.stdout.write("prompted > ");
    assert.equal(state.codeInputReady, true);
    assert.throws(() => adapter.code("test", "partial-code"));
    adapter.code("test", "whole-code#whole-state");
    assert.equal(received, "whole-code#whole-state\n");
    assert.equal(state.codeInputReady, false);
    child.emit("close", 0);
    assert.equal(state.status, "complete");
  } finally {
    adapter.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("current CLI claude.com authorize URL and split terminal hyperlinks are recognized safely", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-claude-url-"));
  let child;
  const adapter = createClaudeAuth({
    dataDir: dir,
    spawnProcess() {
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {};
      return child;
    },
  });
  try {
    const state = adapter.login("new-domain");
    child.stdout.write(
      "Opening browser to sign in…\nIf the browser did not open, visit: https://claude.com/cai/oauth/authorize?test=1\n",
    );
    assert.equal(
      state.authUrl,
      "https://claude.com/cai/oauth/authorize?test=1",
    );
    child.stdout.write(
      "https://claude.com.evil.example/cai/oauth/authorize\nhttps://secret@claude.com/cai/oauth/authorize\nhttp://claude.com/cai/oauth/authorize\n",
    );
    assert.equal(
      state.authUrl,
      "https://claude.com/cai/oauth/authorize?test=1",
    );
    child.stdout.write(
      "\x1b]8;;https://claude.com/cai/oauth/authorize?test=2\x1b",
    );
    child.stdout.write(
      "\\https://claude.com/cai/oauth/authorize?test=2\x1b]8;;\x1b\\\n",
    );
    assert.equal(
      state.authUrl,
      "https://claude.com/cai/oauth/authorize?test=2",
    );
  } finally {
    adapter.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
