import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { Store } from "../server/store.mjs";
import { createChatThreads } from "../server/chat-threads.mjs";
import { sample, TestPool } from "./fixtures.mjs";
function client(origin) {
  let cookies = new Map();
  return async (p, body, method = body ? "POST" : "GET") => {
    const r = await fetch(origin + "/api" + p, {
      method,
      headers: {
        "X-CodeWith": "1",
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const c of r.headers.getSetCookie()) {
      const [k, ...v] = c.split(";")[0].split("=");
      cookies.set(k, v.join("="));
    }
    const value = r.headers.get("content-type")?.includes("application/json")
      ? await r.json()
      : await r.text();
    return { status: r.status, value, headers: r.headers };
  };
}

for (const databaseUrl of ["", "sqlite:threads.sqlite"])
  test(`chat threads isolate history, regenerate without duplicate questions, rename/delete and survive restart (${databaseUrl || "file"})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-threads-"));
    const pool = new TestPool();
    let app;
    async function start() {
      app = await createApplication({
        dataDir: dir,
        databaseUrl,
        mode: "personal",
        codexPool: pool,
      });
      await new Promise((resolve) =>
        app.server.listen(0, "127.0.0.1", resolve),
      );
      const c = client("http://127.0.0.1:" + app.server.address().port);
      await c("/auth/personal", {});
      return c;
    }
    async function stop() {
      await new Promise((resolve) => app.server.close(resolve));
      await app.closed;
      app = null;
    }
    try {
      let c = await start();
      const w = (await c("/workspaces", { exchange: sample() })).value;
      const create = async () =>
        (await c("/ai/threads", { workspaceId: w.id, specId: null })).value
          .thread;
      const first = await create();
      assert.equal(first.title, "새 대화");
      await c("/ai/start", { provider: "codex" });
      await c("/ai/login", { provider: "codex" });
      await c("/ai/finish", {});
      async function chat(thread, body) {
        const result = await c("/ai/chat", {
          workspaceId: w.id,
          specId: null,
          base: w.head,
          threadId: thread.id,
          ...body,
        });
        assert.equal(result.status, 200, JSON.stringify(result.value));
        assert(result.value.includes('"type":"answer"'), result.value);
      }
      await chat(first, { message: "ONLY_IN_FIRST_THREAD" });
      const second = await create();
      await chat(second, { message: "ONLY_IN_SECOND_THREAD" });
      assert(!pool.calls.at(-1).prompt.includes("ONLY_IN_FIRST_THREAD"));
      const messages = (await c("/ai/threads/" + second.id)).value.messages;
      await chat(second, { regenerateOf: messages.at(-1).id });
      const updated = (await c("/ai/threads/" + second.id)).value.messages;
      assert.equal(updated.filter((m) => m.role === "user").length, 1);
      assert.equal(updated.filter((m) => m.role === "assistant").length, 2);
      assert.equal(updated.at(-1).regeneratedFrom, messages.at(-1).id);
      assert.equal(
        JSON.parse(
          pool.calls
            .at(-1)
            .prompt.split("앞선 대화:\n")[1]
            .split("\n사용자 요청:")[0],
        ).messages.length,
        0,
      );
      assert.equal(
        (
          await c("/ai/chat", {
            workspaceId: w.id,
            base: w.head,
            threadId: second.id,
            regenerateOf: messages[0].id,
          })
        ).status,
        409,
      );
      const renamed = await c(
        "/ai/threads/" + second.id,
        { title: "별도 대화" },
        "PATCH",
      );
      assert.equal(renamed.value.thread.title, "별도 대화");
      const manager = createChatThreads(app.store);
      app.store.db.users.push({ id: "other", name: "Other", login: "other" });
      app.store.db.workspaces[0].members.push({
        userId: "other",
        role: "viewer",
      });
      const foreign = manager.create("other", w.id, null);
      assert.equal((await c("/ai/threads/" + foreign.id)).status, 404);
      assert(
        !(await c("/ai/threads?workspace=" + w.id)).value.threads.some(
          (t) => t.id === foreign.id,
        ),
      );
      await app.store.persist();
      await stop();
      c = await start();
      assert.equal(
        (await c("/ai/threads/" + second.id)).value.thread.title,
        "별도 대화",
      );
      await c("/ai/threads/" + second.id, null, "DELETE");
      assert.equal((await c("/ai/threads/" + second.id)).status, 404);
      assert.equal(
        (await c("/ai/chats?workspace=" + w.id)).value.thread.id,
        first.id,
      );
      assert(
        (await c("/workspaces/" + w.id + "/chats")).value.messages.every(
          (m) => m.threadId === first.id,
        ),
      );
      assert.equal(app.store.db.workspaces[0].document.specs.length, 1);
    } finally {
      if (app) await stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

test("legacy scope-based conversations migrate once and preserve message IDs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-legacy-chat-"));
  let store;
  try {
    store = await Store.open(dir);
    store.db.users.push({ id: "u", name: "U", login: "u" });
    const w = await store.create("u", "테스트");
    store.db.chats.push({
      id: "legacy-message",
      userId: "u",
      workspaceId: w.id,
      specId: null,
      text: "기존 메시지",
      role: "user",
      at: new Date().toISOString(),
    });
    await store.persist();
    await store.close();
    store = await Store.open(dir);
    const id = store.db.chats[0].threadId;
    assert(id);
    assert.equal(store.db.chatThreads.length, 1);
    assert.equal(store.db.chats[0].id, "legacy-message");
    await store.close();
    store = await Store.open(dir);
    assert.equal(store.db.chats[0].threadId, id);
    assert.equal(store.db.chatThreads.length, 1);
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("editing forks the preceding conversation and remaps response references", async () => {
  const store = {
    db: { chatThreads: [], chats: [] },
    workspace: () => ({ document: { specs: [] } }),
    persist: async () => {},
  };
  const threads = createChatThreads(store);
  const original = threads.create("u", "w");
  for (const item of [
    { id: "q1", role: "user", text: "first" },
    { id: "a1", role: "assistant", text: "answer", responseTo: "q1" },
    { id: "q2", role: "user", text: "edit me" },
  ])
    store.db.chats.push({
      ...item,
      userId: "u",
      workspaceId: "w",
      threadId: original.id,
    });
  const fork = await threads.fork("u", original.id, "q2");
  const items = threads.messages(fork);
  assert.equal(items.length, 2);
  assert.equal(items[1].responseTo, items[0].id);
  assert.equal(threads.messages(original).length, 3);
  assert.equal(fork.parentThreadId, original.id);
});
