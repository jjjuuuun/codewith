import { keyLogin } from "./auth-helper.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
test("existing server AI records are preserved and private secrets stay out of me", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-private-")),
    app = await createApplication({ mode: "server", dataDir: dir });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  let cookie = "";
  async function req(p, b) {
    const r = await fetch(base + "/api" + p, {
      method: b ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        "X-CodeWith": "1",
        "Content-Type": "application/json",
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json() };
  }
  try {
    const resultLogin = await keyLogin(base, {}, "이전 사용자");
    cookie = resultLogin.cookie;
    const { data } = resultLogin;
    const u = app.store.user(data.user.id);
    Object.assign(u, {
      apiKey: "secret-key",
      claudeToken: "secret-token",
      aiSettings: { provider: "codex", model: "model" },
    });
    app.store.db.chats.push(
      { id: "own", userId: u.id, text: "personal" },
      { id: "other", userId: "other", text: "other-private" },
    );
    fs.mkdirSync(path.join(dir, "codex", u.id), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "codex", u.id, "auth.json"),
      "secret-credential",
    );
    await app.store.persist();
    const result = await req("/me");
    assert.equal(result.data.settings.model, "model");
    assert(!JSON.stringify(result.data).includes("secret-"));
    assert.equal(
      (await req("/ai/local-migration", { savedLocally: true })).status,
      401,
    );
    assert.equal(u.apiKey, "secret-key");
    assert.equal(app.store.db.chats.length, 2);
    assert(fs.existsSync(path.join(dir, "codex", u.id)));
  } finally {
    await new Promise((r) => app.server.close(r));
    await app.closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
