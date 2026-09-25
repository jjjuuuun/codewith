import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { sample, TestPool } from "./fixtures.mjs";
const catalog = [{ id: "test-model", model: "test-model", isDefault: true }];
function client(origin) {
  const jar = new Map();
  return async (p, b, expected = 200) => {
    const r = await fetch(origin + "/api" + p, {
      method: b ? "POST" : "GET",
      headers: {
        Origin: origin,
        "X-CodeWith": "1",
        "Content-Type": "application/json",
        Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    for (const c of r.headers.getSetCookie()) {
      const pair = c.split(";")[0],
        i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const value = r.headers.get("content-type")?.includes("event-stream")
      ? await r.text()
      : await r.json();
    assert.equal(r.status, expected, JSON.stringify(value));
    return value;
  };
}
async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-server-ai-")),
    pool = new TestPool(),
    calls = [],
    api = {
      models: async (key) => {
        if (key === "invalid") throw Error("secret should not leak");
        return catalog;
      },
      run: async (options) => {
        calls.push(options);
        return {
          sources: [{ title: "공식 문서", url: "https://vuejs.org/guide/" }],
          text: JSON.stringify({
            message: "서버에서 저장한 응답",
            proposal: null,
            files: [],
          }),
        };
      },
    };
  const app = await createApplication({
    mode: "server",
    dataDir: dir,
    codexPool: pool,
    openai: api,
    claude: api,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  return {
    dir,
    pool,
    calls,
    app,
    origin: "http://127.0.0.1:" + app.server.address().port,
    async close() {
      await new Promise((r) => app.server.close(r));
      await app.closed;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function apiLogin(c, key, name = "사용자") {
  await c("/ai/start", { provider: "openai" });
  await c("/ai/key", { provider: "openai", key });
  await c("/ai/settings", {
    provider: "openai",
    model: "test-model",
    effort: "high",
  });
  return c("/ai/finish", { name });
}
test("server AI: encrypted credentials, private settings/chat, workspace ACL and cross-device identity", async () => {
  const x = await setup();
  try {
    const a = client(x.origin),
      b = client(x.origin),
      again = client(x.origin);
    await a("/ai/settings", undefined, 401);
    const identity = await a("/auth/key/create", { name: "A" });
    await b("/auth/key/create", { name: "B" });
    const first = await apiLogin(a, "secret-user-a");
    await apiLogin(b, "secret-user-b");
    const w = await a(
      "/workspaces",
      { exchange: sample(), visibility: "team" },
      201,
    );
    await b("/ai/chats?workspace=" + w.id + "&spec=SPEC-REG", undefined, 403);
    await b(
      "/ai/chat",
      {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
        message: "attack",
      },
      403,
    );
    await b("/join", { code: w.inviteCode });
    let view = await a("/workspaces/" + w.id);
    await a("/workspaces/" + w.id + "/members", {
      requestId: view.requests[0].id,
      approve: true,
    });
    const answer = await a("/ai/chat", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: w.head,
      message: "내 대화",
      document: { injected: true },
    });
    assert.ok(answer.includes("서버에서 저장한 응답"));
    assert.equal(
      (await b("/ai/chats?workspace=" + w.id + "&spec=SPEC-REG")).messages
        .length,
      0,
    );
    assert.equal(
      (await a("/ai/chats?workspace=" + w.id + "&spec=SPEC-REG")).messages
        .length,
      2,
    );
    await again("/auth/key/login", { key: identity.key });
    const second = await apiLogin(again, "secret-user-a");
    assert.equal(second.user.id, first.user.id);
    assert.equal((await again("/workspaces")).workspaces[0].id, w.id);
    assert.equal((await again("/ai/settings")).settings.effort, "high");
    assert.equal(
      (await again("/ai/chats?workspace=" + w.id + "&spec=SPEC-REG")).messages
        .length,
      2,
    );
    const raw = fs.readFileSync(path.join(x.dir, "database.json"), "utf8");
    assert.ok(!raw.includes("secret-user-a"));
    assert.ok(!raw.includes("secret-user-b"));
    assert.ok(!JSON.stringify(await a("/me")).includes("secret"));
    await a(
      "/ai/chat",
      { workspaceId: w.id, specId: "SPEC-REG", base: "old", message: "stale" },
      409,
    );
    await a("/auth/login", { login: "admin", password: "1234" }, 410);
  } finally {
    await x.close();
  }
});
test("fresh official CLI login is isolated, same AI account never merges CodeWith users, forged client identity ignored", async () => {
  const x = await setup();
  try {
    const a = client(x.origin),
      b = client(x.origin);
    for (const c of [a, b]) {
      await c("/auth/key/create", { name: "계정" });
      await c("/ai/start", { provider: "codex" });
      await c(
        "/ai/finish",
        { name: "forged", email: "victim@example.com" },
        401,
      );
      const start = await c("/ai/login", { provider: "codex" });
      assert.ok(start.authUrl);
      await c("/ai/settings", { provider: "codex", model: "test-codex" });
      await c("/ai/finish", { name: "공식 사용자", email: "forged" });
    }
    assert.equal(x.app.store.db.users.length, 2);
    assert.equal(x.app.store.db.users[0].login.startsWith("ai:"), false);
    assert.ok(
      !JSON.stringify(x.app.store.db.users[0]).includes("victim@example.com"),
    );
  } finally {
    await x.close();
  }
});
test("failed API authentication cannot create an account and errors never echo credentials", async () => {
  const x = await setup();
  try {
    const c = client(x.origin);
    await c("/auth/key/create", { name: "A" });
    await c("/ai/start", { provider: "openai" });
    const failure = await c(
      "/ai/key",
      { provider: "openai", key: "invalid" },
      502,
    );
    assert.ok(!failure.error.includes("secret"));
    await c("/ai/finish", {}, 401);
    assert.equal(x.app.store.db.users.length, 1);
    assert.ok(!x.app.store.db.users[0].aiConnections);
  } finally {
    await x.close();
  }
});
for (const databaseUrl of [undefined, "sqlite:ai.sqlite"])
  test(`server restart restores private AI settings, chat and encrypted key (${databaseUrl || "file"})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-ai-restart-"));
    let app;
    const api = {
      models: async (key) => {
        assert.equal(key, "persisted-secret");
        return catalog;
      },
      run: async () => ({
        text: JSON.stringify({
          message: "재시작 테스트",
          proposal: null,
          files: [],
        }),
      }),
    };
    async function start() {
      app = await createApplication({
        mode: "server",
        dataDir: dir,
        databaseUrl,
        openai: api,
        codexPool: new TestPool(),
      });
      await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
      return client("http://127.0.0.1:" + app.server.address().port);
    }
    try {
      let c = await start();
      const identity = await c("/auth/key/create", { name: "A" });
      await c("/preferences", {
        instructions: "persistent preference",
        revision: 0,
      });
      const first = await apiLogin(c, "persisted-secret"),
        w = await c("/workspaces", { exchange: sample() }, 201);
      await c("/ai/chat", {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
        message: "보관할 대화",
      });
      await new Promise((r) => app.server.close(r));
      await app.closed;
      c = await start();
      await c("/auth/key/login", { key: identity.key });
      const second = await apiLogin(c, "persisted-secret");
      assert.equal(
        (await c("/preferences")).instructions,
        "persistent preference",
      );
      assert.equal(second.user.id, first.user.id);
      assert.equal((await c("/ai/models")).models[0].id, "test-model");
      assert.equal(
        (await c("/ai/chats?workspace=" + w.id + "&spec=SPEC-REG")).messages
          .length,
        2,
      );
      assert.equal((await c("/ai/settings")).settings.effort, "high");
      await c("/ai/chat", {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
        message: "다시 요청",
      });
      assert.equal(app.store.db.chats.length, 4);
    } finally {
      if (app?.server.listening) await new Promise((r) => app.server.close(r));
      await app?.closed;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test("Claude subscription authenticates through the server and anonymous flows cannot inspect each other", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-claude-server-")),
    accounts = new Map(),
    cc = {
      cancel() {},
      close() {},
      login(id) {
        accounts.set(id, true);
        return {
          status: "pending",
          authUrl: "https://claude.ai/oauth/authorize?test=1",
        };
      },
      async account(id) {
        return {
          account: accounts.has(id)
            ? { type: "claude", email: "verified-claude@example.com" }
            : null,
        };
      },
      loginStatus() {
        return { status: "complete" };
      },
      models() {
        return catalog;
      },
      code() {},
      async logout(id) {
        accounts.delete(id);
      },
    };
  const app = await createApplication({
    mode: "server",
    dataDir: dir,
    claudeCode: cc,
    codexPool: new TestPool(),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  try {
    const origin = "http://127.0.0.1:" + app.server.address().port,
      a = client(origin),
      b = client(origin);
    await a("/auth/key/create", { name: "A" });
    await a("/ai/start", { provider: "claude-code" });
    await a("/ai/login", { provider: "claude-code" });
    await b("/ai/login/status?provider=claude-code", undefined, 401);
    await b("/auth/key/create", { name: "B" });
    await b("/ai/start", { provider: "claude-code" });
    assert.equal(
      (await b("/ai/login/status?provider=claude-code")).account,
      null,
    );
    await a("/ai/settings", { provider: "claude-code", model: "test-model" });
    await a("/ai/finish", { name: "Claude 사용자" });
    assert.equal(app.store.db.users.length, 2);
    await b("/ai/finish", {}, 401);
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("first login chooses the default model and requests a name only after authentication", async () => {
  const x = await setup();
  try {
    const c = client(x.origin),
      other = client(x.origin);
    await c("/auth/key/create", {});
    await c("/ai/start", { provider: "openai" });
    await c("/ai/key", { provider: "openai", key: "new-account-secret" });
    const result = await c("/ai/finish", {});
    assert.equal(result.settings.model, "test-model");
    assert.equal(result.user.needsProfile, true);
    await other("/profile", { name: "forged" }, 401);
    await c("/profile", { name: "   " }, 400);
    const saved = await c("/profile", { name: "  김개발  " });
    assert.equal(saved.user.name, "김개발");
    assert.equal(saved.user.needsProfile, false);
    assert.equal((await c("/me")).user.needsProfile, false);
  } finally {
    await x.close();
  }
});

test("AI connection and disconnection cannot sign in, rename or delete a CodeWith identity", async () => {
  const x = await setup();
  try {
    const c = client(x.origin);
    await c("/ai/start", { provider: "openai" }, 401);
    const identity = await c("/auth/key/create", { name: "내 이름" });
    await apiLogin(c, "shared-api-key", "forged name");
    assert.equal((await c("/me")).user.name, "내 이름");
    await c("/ai/logout", { provider: "openai" });
    assert.equal((await c("/me")).user.id, identity.user.id);
    assert.deepEqual(x.app.store.db.users[0].aiConnections, {});
    await c("/auth/logout", {});
    await c("/ai/start", { provider: "openai" }, 401);
    await c("/auth/key/login", { key: identity.key });
    assert.equal((await c("/me")).user.id, identity.user.id);
  } finally {
    await x.close();
  }
});

test("personal common settings are private, revision checked, and used only for their owner AI prompts", async () => {
  const x = await setup();
  try {
    const a = client(x.origin),
      b = client(x.origin),
      anon = client(x.origin);
    await anon("/preferences", undefined, 401);
    await a("/auth/key/create", { name: "A" });
    await b("/auth/key/create", { name: "B" });
    await apiLogin(a, "key-a");
    await apiLogin(b, "key-b");
    assert.deepEqual(await a("/preferences"), {
      instructions: "",
      revision: 0,
    });
    await a("/preferences", {
      instructions: "PRIVATE-A-PREFERENCE",
      revision: 0,
    });
    await b("/preferences", {
      instructions: "PRIVATE-B-PREFERENCE",
      revision: 0,
    });
    await a("/preferences", { instructions: "stale", revision: 0 }, 409);
    await a("/preferences", { instructions: 7, revision: 1 }, 400);
    const doc = sample();
    doc.projectSpec.instructions = "SHARED-WORKSPACE-INSTRUCTION";
    const w = await a(
      "/workspaces",
      { exchange: doc, visibility: "team" },
      201,
    );
    await b("/join", { code: w.inviteCode });
    let view = await a("/workspaces/" + w.id);
    view = await a("/workspaces/" + w.id + "/members", {
      requestId: view.requests[0].id,
      approve: true,
    });
    for (const c of [a, b])
      await c("/ai/chat", {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
        message: "검토",
      });
    assert(x.calls[0].prompt.includes("PRIVATE-A-PREFERENCE"));
    assert(!x.calls[0].prompt.includes("PRIVATE-B-PREFERENCE"));
    assert(x.calls[1].prompt.includes("PRIVATE-B-PREFERENCE"));
    assert(!x.calls[1].prompt.includes("PRIVATE-A-PREFERENCE"));
    assert(
      x.calls.every((c) => c.prompt.includes("SHARED-WORKSPACE-INSTRUCTION")),
    );
    assert(!JSON.stringify(view).includes("PRIVATE-"));
    assert(
      !JSON.stringify(await a("/workspaces/" + w.id + "/export")).includes(
        "PRIVATE-",
      ),
    );
    assert.equal(
      (await a("/preferences")).instructions,
      "PRIVATE-A-PREFERENCE",
    );
  } finally {
    await x.close();
  }
});

test("workspace chat works without specs and separates history, scope and access", async () => {
  const x = await setup();
  try {
    const a = client(x.origin),
      b = client(x.origin);
    await a("/auth/key/create", { name: "A" });
    await b("/auth/key/create", { name: "B" });
    await apiLogin(a, "workspace-key");
    const empty = await a("/workspaces", { name: "빈 워크스페이스" }, 201);
    await a("/ai/chat", {
      workspaceId: empty.id,
      base: empty.head,
      message: "EMPTY-WORKSPACE-QUESTION",
    });
    assert(x.calls[0].prompt.includes("워크스페이스 협의자"));
    assert.equal(
      (await a("/ai/chats?workspace=" + empty.id)).messages.length,
      2,
    );
    await b("/ai/chats?workspace=" + empty.id, undefined, 403);
    await b(
      "/ai/chat",
      { workspaceId: empty.id, base: empty.head, message: "no" },
      403,
    );
    const doc = sample(),
      w = await a("/workspaces", { exchange: doc }, 201);
    await a("/ai/chat", {
      workspaceId: w.id,
      specId: null,
      base: w.head,
      message: "WORKSPACE-HISTORY-ONLY",
    });
    await a("/ai/chat", {
      workspaceId: w.id,
      specId: "SPEC-REG",
      base: w.head,
      message: "SPEC-HISTORY-ONLY",
    });
    assert(!x.calls[2].prompt.includes("WORKSPACE-HISTORY-ONLY"));
    await a("/ai/chat", {
      workspaceId: w.id,
      base: w.head,
      message: "WORKSPACE-FOLLOW-UP",
    });
    assert(x.calls[3].prompt.includes("WORKSPACE-HISTORY-ONLY"));
    assert(!x.calls[3].prompt.includes("SPEC-HISTORY-ONLY"));
    const general = (await a("/ai/chats?workspace=" + w.id)).messages,
      specific = (await a("/ai/chats?workspace=" + w.id + "&spec=SPEC-REG"))
        .messages;
    assert.equal(general.length, 4);
    assert(general.every((m) => m.specId === null && !m.proposal));
    assert.equal(specific.length, 2);
    await a(
      "/ai/chat",
      { workspaceId: w.id, specId: "missing", base: w.head, message: "no" },
      404,
    );
    await a(
      "/ai/chat",
      { workspaceId: w.id, base: "stale", message: "no" },
      409,
    );
  } finally {
    await x.close();
  }
});

test("web search preference is private, persists, reaches adapters and retains sources", async () => {
  const x = await setup();
  try {
    const a = client(x.origin);
    await a("/auth/key/create", { name: "A" });
    await apiLogin(a, "test-key");
    const w = await a("/workspaces", { exchange: sample() }, 201);
    assert.equal((await a("/ai/settings")).settings.webSearch, "auto");
    for (const webSearch of ["auto", "off"]) {
      await a("/ai/settings", {
        provider: "openai",
        model: "test-model",
        webSearch,
      });
      assert.equal((await a("/ai/settings")).settings.webSearch, webSearch);
      await a("/ai/chat", {
        workspaceId: w.id,
        specId: "SPEC-REG",
        base: w.head,
        message: "공식 문서를 확인해줘",
      });
      assert.equal(x.calls.at(-1).webSearch, webSearch);
    }
    const history = await a("/ai/chats?workspace=" + w.id + "&spec=SPEC-REG");
    assert.equal(
      history.messages.at(-1).sources[0].url,
      "https://vuejs.org/guide/",
    );
  } finally {
    await x.close();
  }
});
