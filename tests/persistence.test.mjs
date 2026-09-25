import { keyLogin } from "./auth-helper.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, id, passwordHash, stamp } from "../server/store.mjs";
import { sample, TestPool } from "./fixtures.mjs";
import { createApplication } from "../server/index.mjs";
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "codewith-storage-"));
for (const databaseUrl of ["", "sqlite:codewith.sqlite"])
  test(`${databaseUrl || "file default"}: restart preserves accounts, owner, commits and private settings`, async () => {
    const dir = temp();
    let store;
    try {
      store = new Store(dir, { databaseUrl });
      const uid = id("user");
      store.db.users.push({
        id: uid,
        name: "관리자",
        login: "admin",
        password: passwordHash("test-password"),
        createdAt: stamp(),
        aiSettings: { provider: "codex", model: "personal-model" },
      });
      const w = await store.create(uid, "테스트", "team", sample());
      const wid = w.id,
        head = w.head;
      store.close();
      store = new Store(dir, { databaseUrl });
      assert.equal(store.workspace(wid, uid).head, head);
      assert.equal(store.workspace(wid, uid).ownerId, uid);
      assert.equal(store.user(uid).aiSettings.model, "personal-model");
      assert.equal(store.persistence.kind, databaseUrl ? "sqlite" : "file");
      assert.equal(
        fs.existsSync(path.join(dir, "database.json")),
        !databaseUrl,
      );
    } finally {
      store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
test("explicit file-to-SQLite import preserves source and does not repeat on restart", () => {
  const dir = temp();
  let store;
  try {
    store = new Store(dir, { databaseUrl: "" });
    store.db.users.push({ id: "u1", name: "기존 사용자" });
    store.persist();
    store.close();
    const original = fs.readFileSync(path.join(dir, "database.json"), "utf8");
    store = new Store(dir, {
      databaseUrl: "sqlite:db.sqlite",
      importFile: true,
    });
    assert.equal(store.db.users[0].id, "u1");
    store.db.users.push({ id: "u2" });
    store.persist();
    store.close();
    store = new Store(dir, {
      databaseUrl: "sqlite:db.sqlite",
      importFile: true,
    });
    assert.equal(store.db.users.length, 2);
    assert.equal(
      fs.readFileSync(path.join(dir, "database.json"), "utf8"),
      original,
    );
  } finally {
    store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("invalid configured database never silently falls back to file", () => {
  const dir = temp();
  try {
    assert.throws(
      () => new Store(dir, { databaseUrl: "postgres://unused" }),
      /현재 DB 연결/,
    );
    fs.writeFileSync(path.join(dir, "bad.sqlite"), "not a database");
    assert.throws(
      () => new Store(dir, { databaseUrl: "sqlite:bad.sqlite" }),
      /자동 전환하지/,
    );
    assert(!fs.existsSync(path.join(dir, "database.json")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("SQLite stale writers fail instead of overwriting newer data", () => {
  const dir = temp();
  let a, b;
  try {
    a = new Store(dir, { databaseUrl: "sqlite:db.sqlite" });
    b = new Store(dir, { databaseUrl: "sqlite:db.sqlite" });
    assert.throws(() => a.persist(), /다른 서버/);
    assert.throws(
      () => a.assertHealthy(),
      (e) => e.status === 503,
    );
  } finally {
    a?.close();
    b?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP login and workspace authorization work on SQLite after server restart", async () => {
  const dir = temp();
  let app;
  try {
    app = await createApplication({
      mode: "server",
      dataDir: dir,
      databaseUrl: "sqlite:db.sqlite",
      codexPool: new TestPool(),
    });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    let origin = "http://127.0.0.1:" + app.server.address().port;
    const post = (p, body, cookie = "") =>
      fetch(origin + "/api" + p, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CodeWith": "1",
          Cookie: cookie,
        },
        body: JSON.stringify(body),
      });
    const identity = {};
    let auth = await keyLogin(origin, identity, "관리자"),
      cookie = auth.cookie,
      r;
    r = await post("/workspaces", { name: "DB 테스트" }, cookie);
    assert.equal(r.status, 201);
    const w = await r.json();
    await new Promise((r) => app.server.close(r));
    app = await createApplication({
      mode: "server",
      dataDir: dir,
      databaseUrl: "sqlite:db.sqlite",
      codexPool: new TestPool(),
    });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    origin = "http://127.0.0.1:" + app.server.address().port;
    auth = await keyLogin(origin, identity);
    cookie = auth.cookie;
    r = await fetch(origin + "/api/workspaces/" + w.id, {
      headers: { Cookie: cookie },
    });
    assert.equal((await r.json()).role, "owner");
    assert.equal(
      (await (await fetch(origin + "/api/health")).json()).storage,
      "sqlite",
    );
  } finally {
    if (app?.server.listening) await new Promise((r) => app.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("custom adapter allows a user-selected database without coupling routes to its driver", async () => {
  const dir = temp();
  let store;
  try {
    const adapter = path.join(dir, "custom.mjs");
    fs.writeFileSync(
      adapter,
      `let saved={version:2,users:[],sessions:[],workspaces:[],chats:[]};export async function open({databaseUrl}){if(databaseUrl!=='custom://test')throw Error('wrong URL');return {kind:'custom-test',async read(){return structuredClone(saved)},async write(state){saved=structuredClone(state)},async close(){}}}`,
    );
    store = await Store.open(dir, {
      databaseUrl: "custom://test",
      adapterPath: adapter,
    });
    store.db.users.push({ id: "custom-user", name: "Custom" });
    await store.persist();
    await store.close();
    store = await Store.open(dir, {
      databaseUrl: "custom://test",
      adapterPath: adapter,
    });
    assert.equal(store.db.users[0].id, "custom-user");
    assert(!fs.existsSync(path.join(dir, "database.json")));
  } finally {
    await store?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
