import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { deploymentConfig, listenConfig } from "../server/deployment.mjs";
import { TestPool } from "./fixtures.mjs";
function client(origin) {
  const jar = new Map();
  const call = async (p, b, status = 200, extra = {}) => {
    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        origin + "/api" + p,
        {
          method: b === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CodeWith": "1",
            Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; "),
            ...extra,
          },
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, text }),
          );
        },
      );
      req.on("error", reject);
      req.end(b === undefined ? undefined : JSON.stringify(b));
    });
    for (const c of response.headers["set-cookie"] || []) {
      const i = c.indexOf("=");
      jar.set(c.slice(0, i), c.slice(i + 1).split(";")[0]);
    }
    const data =
      response.status === 303
        ? { location: response.headers.location }
        : JSON.parse(response.text);
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  call.jar = jar;
  return call;
}

async function fixture(options = {}) {
  const dir =
    options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "cw-access-"));
  const app = await createApplication({
    dataDir: dir,
    codexPool: new TestPool(),
    ...options,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + app.server.address().port;
  return {
    app,
    dir,
    origin,
    client: () => client(origin),
    async close(remove = true) {
      await new Promise((r) => app.server.close(r));
      await app.closed;
      if (remove) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("personal is default, fixed identity, no outside hosts/proxies or alternate auth", async () => {
  const x = await fixture();
  try {
    const c = x.client();
    assert.equal((await c("/auth/config")).mode, "personal");
    await c("/me", undefined, 401);
    await c("/auth/personal", {});
    const me = await c("/me");
    assert.equal(me.user.name, "PERSONAL");
    assert.equal(me.user.needsProfile, false);
    await c("/auth/account", undefined, 403);
    await c("/auth/keys", {}, 403);
    await c("/auth/logout", {}, 403);
    await c("/profile", { name: "변경" }, 403);
    await c("/workspaces", { name: "보존" }, 201);
    await c("/auth/key/create", {}, 403);
    await c("/auth/key/challenge", {}, 410);
    await c("/auth/personal", {}, 403, { Host: "192.168.1.10" });
    await c("/auth/personal", {}, 403, { "X-Forwarded-For": "192.168.1.10" });
    const d = x.client();
    await d("/auth/personal", {});
    assert.equal((await d("/me")).user.id, me.user.id);
    assert.equal((await d("/workspaces")).workspaces.length, 1);
    assert.throws(() =>
      x.app.access.guard({
        socket: { remoteAddress: "192.168.1.10" },
        headers: { host: "localhost" },
      }),
    );
  } finally {
    await x.close();
  }
});
test("invalid deployment settings fail closed", () => {
  assert.equal(deploymentConfig({}, {}).mode, "personal");
  assert.throws(() => deploymentConfig({ mode: "team" }, {}));
  assert.throws(() =>
    listenConfig(deploymentConfig({}, {}), [], { HOST: "0.0.0.0" }),
  );
  assert.throws(() =>
    deploymentConfig({ mode: "server", authMethods: ["unknown"] }, {}),
  );
  assert.throws(() =>
    deploymentConfig({ mode: "server", authMethods: ["passkey"] }, {}),
  );
  assert.throws(() =>
    deploymentConfig(
      { mode: "server", origin: "https://cw.example", authMethods: ["email"] },
      {},
    ),
  );
  assert.throws(() =>
    deploymentConfig(
      { mode: "server", origin: "https://cw.example", authMethods: ["oidc"] },
      {},
    ),
  );
  assert.equal(
    listenConfig(deploymentConfig({ mode: "shared" }, {}), [], {}).host,
    "0.0.0.0",
  );
});
test("personal to shared to server retains identity and data, invalidates automatic sessions", async () => {
  let x = await fixture();
  const dir = x.dir;
  try {
    let c = x.client();
    await c("/auth/personal", {});
    const identity = await c("/me"),
      w = await c("/workspaces", { name: "계속 사용" }, 201),
      oldCookie = [...c.jar].map(([k, v]) => k + "=" + v).join("; ");
    await x.close(false);
    x = await fixture({ dataDir: dir, mode: "shared" });
    c = x.client();
    await c("/me", undefined, 401, { Cookie: oldCookie });
    await c("/auth/personal", {}, 403);
    const recovered = await c("/auth/key/create", {
      setupKey: fs.readFileSync(path.join(dir, "setup-key"), "utf8").trim(),
      name: "사용자",
    });
    assert.equal(recovered.user.name, "사용자");
    identity.key = recovered.key;
    await c("/auth/key/login", { key: identity.key });
    assert.equal((await c("/me")).user.id, identity.user.id);
    assert.equal((await c("/workspaces/" + w.id)).role, "owner");
    await x.close(false);
    x = await fixture({ dataDir: dir, mode: "server" });
    c = x.client();
    await c("/auth/key/login", { key: identity.key });
    assert.equal((await c("/me")).user.id, identity.user.id);
    assert.equal((await c("/workspaces/" + w.id)).commits.length, 1);
    assert.ok(
      !fs
        .readFileSync(path.join(dir, "database.json"), "utf8")
        .includes(identity.key),
    );
  } finally {
    await x.close();
  }
});
test("shared bootstrap is operator-bound and single-use; invitation needs approval", async () => {
  const x = await fixture({ mode: "shared" });
  try {
    const a = x.client(),
      b = x.client();
    await a("/auth/key/create", { name: "공격자" }, 403);
    const setupKey = fs
      .readFileSync(path.join(x.dir, "setup-key"), "utf8")
      .trim();
    const owner = await a("/auth/key/create", { name: "관리자", setupKey });
    assert.equal((await a("/auth/config")).setupRequired, false);
    assert.ok(!fs.existsSync(path.join(x.dir, "setup-key")));
    await b("/auth/key/create", { name: "새 사람", setupKey }, 403);
    const w = await a(
      "/workspaces",
      { name: "팀 프로젝트", visibility: "team" },
      201,
    );
    const member = await b("/auth/key/create", {
      name: "팀원",
      inviteCode: w.inviteCode,
    });
    assert.equal(member.pending, true);
    await b("/workspaces/" + w.id, undefined, 403);
    const v = await a("/workspaces/" + w.id);
    await a("/workspaces/" + w.id + "/members", {
      requestId: v.requests[0].id,
      approve: true,
      role: "viewer",
    });
    assert.equal((await b("/workspaces/" + w.id)).role, "viewer");
    assert.notEqual(owner.user.id, member.user.id);
    assert.equal(owner.user.name, "관리자");
    assert.equal(member.user.name, "팀원");
    await b("/auth/logout", {});
    await b("/auth/key/login", { key: member.key });
    assert.equal((await b("/me")).user.id, member.user.id);
  } finally {
    await x.close();
  }
});
test("key rotation, account privacy, recovery and revoked sessions", async () => {
  const x = await fixture({ mode: "server" });
  try {
    const a = x.client(),
      b = x.client();
    const first = await a("/auth/key/create", { name: "A" });
    await b("/auth/key/login", { key: first.key });
    let info = await a("/auth/account");
    assert.ok(!JSON.stringify(info).includes(first.key));
    await a("/auth/keys/revoke", { id: info.keys[0].id }, 400);
    const next = await a("/auth/keys", {});
    await a("/auth/keys/revoke", { id: info.keys[0].id });
    await b("/me", undefined, 401);
    await b("/auth/key/login", { key: first.key }, 401);
    await b("/auth/key/login", { key: next.key });
    assert.equal((await b("/me")).user.id, first.user.id);
  } finally {
    await x.close();
  }
});
test("email OTP is browser-bound, verified before account creation, replay-proof and linkable", async () => {
  const sent = [];
  const x = await fixture({
    mode: "server",
    origin: "http://localhost",
    authMethods: ["email"],
    smtpURL: "smtp://localhost",
    mailFrom: "cw@example.com",
    mailTransport: {
      async sendMail(m) {
        sent.push(m);
      },
    },
  });
  const headers = { Host: "localhost" };
  try {
    const a = x.client(),
      b = x.client();
    await a("/auth/email/start", { email: "A@example.com" }, 200, headers);
    assert.equal(x.app.store.db.users.length, 0);
    const code = sent[0].text.match(/\d{8}/)[0];
    await b("/auth/email/verify", { code }, 401, headers);
    await a("/auth/email/verify", { code: "00000000" }, 401, headers);
    const first = await a("/auth/email/verify", { code }, 200, headers);
    assert.equal(first.user.needsProfile, true);
    await a("/auth/email/verify", { code }, 401, headers);
    const key = await a("/auth/keys", {}, 200, headers);
    await a("/auth/logout", {}, 200, headers);
    await a("/auth/key/login", { key: key.key }, 200, headers);
    await a("/auth/email/start", { email: "other@example.com" }, 200, headers);
    const changed = await a(
      "/auth/email/verify",
      { code: sent[1].text.match(/\d{8}/)[0] },
      200,
      headers,
    );
    assert.equal(changed.user.id, first.user.id);
    assert.ok(!JSON.stringify(x.app.store.db).includes(code));
    assert.equal(x.app.store.db.users.length, 1);
  } finally {
    await x.close();
  }
});
test("failed mail delivery and excessive verification attempts never log in", async () => {
  let fail = true;
  const sent = [];
  const x = await fixture({
    mode: "server",
    origin: "http://localhost",
    authMethods: ["email"],
    smtpURL: "smtp://localhost",
    mailFrom: "cw@example.com",
    mailTransport: {
      async sendMail(m) {
        if (fail) throw Error("SMTP secret");
        sent.push(m);
      },
    },
  });
  try {
    const c = x.client(),
      h = { Host: "localhost" };
    const bad = await c(
      "/auth/email/start",
      { email: "x@example.com" },
      502,
      h,
    );
    assert.ok(!bad.error.includes("secret"));
    fail = false;
    await c("/auth/email/start", { email: "x@example.com" }, 200, h);
    for (let n = 0; n < 6; n++)
      await c("/auth/email/verify", { code: "0" }, 401, h);
    await c(
      "/auth/email/verify",
      { code: sent[0].text.match(/\d{8}/)[0] },
      401,
      h,
    );
    assert.equal(x.app.store.db.users.length, 0);
  } finally {
    await x.close();
  }
});
test("passkey endpoints reject forged proof, changed browser and unknown credentials", async () => {
  const x = await fixture({
    mode: "server",
    origin: "http://localhost",
    authMethods: ["passkey"],
  });
  try {
    const a = x.client(),
      b = x.client(),
      h = { Host: "localhost" };
    const options = await a("/auth/passkey/register/options", {}, 200, h);
    assert.equal(options.rp.id, "localhost");
    assert.equal(options.authenticatorSelection.userVerification, "required");
    await b("/auth/passkey/register/verify", {}, 401, h);
    await a("/auth/passkey/register/verify", {}, 401, h);
    await a("/auth/passkey/login/options", {}, 200, h);
    await a("/auth/passkey/login/verify", { id: "forged" }, 401, h);
    assert.equal(x.app.store.db.users.length, 0);
  } finally {
    await x.close();
  }
});
test("OIDC flow binds browser, state, nonce and PKCE; uses issuer/sub not email", async () => {
  let checks,
    fail = false;
  const fake = {
    discovery: async () => ({
      serverMetadata: () => ({ issuer: "https://sso.example" }),
    }),
    randomPKCECodeVerifier: () => "test-verifier",
    randomState: () => "test-state",
    randomNonce: () => "test-nonce",
    calculatePKCECodeChallenge: async () => "challenge",
    buildAuthorizationUrl: (_c, p) =>
      new URL("https://sso.example/authorize?" + new URLSearchParams(p)),
    authorizationCodeGrant: async (_c, url, c) => {
      checks = c;
      if (fail || url.searchParams.get("state") !== c.expectedState)
        throw Error("bad state");
      return {
        claims: () => ({
          iss: "https://sso.example",
          sub: "subject-1",
          email: "unverified@example.com",
          name: "조직 사용자",
        }),
      };
    },
  };
  const x = await fixture({
    mode: "server",
    origin: "http://localhost",
    authMethods: ["oidc"],
    oidcIssuer: "https://sso.example",
    oidcClientId: "client",
    oidcClient: fake,
  });
  try {
    const a = x.client(),
      b = x.client(),
      h = { Host: "localhost" };
    const start = await a("/auth/oidc/start", {}, 200, h);
    assert.ok(start.url.includes("code_challenge_method=S256"));
    await b("/auth/oidc/callback?code=ok&state=test-state", undefined, 401, h);
    await a("/auth/oidc/callback?code=ok&state=wrong", undefined, 401, h);
    assert.equal(x.app.store.db.users.length, 0);
    await a("/auth/oidc/start", {}, 200, h);
    await a("/auth/oidc/callback?code=ok&state=test-state", undefined, 303, h);
    assert.deepEqual(checks, {
      pkceCodeVerifier: "test-verifier",
      expectedState: "test-state",
      expectedNonce: "test-nonce",
      idTokenExpected: true,
    });
    const first = (await a("/me", undefined, 200, h)).user;
    assert.ok(!x.app.store.db.users[0].emailIdentity);
    await a("/auth/oidc/start", { returnTo: "/workspaces/example" }, 200, h);
    assert.equal(
      (
        await a(
          "/auth/oidc/callback?code=ok&state=test-state",
          undefined,
          303,
          h,
        )
      ).location,
      "/workspaces/example",
    );
    await a("/auth/oidc/start", { returnTo: "/\t/evil.example" }, 200, h);
    assert.equal(
      (
        await a(
          "/auth/oidc/callback?code=ok&state=test-state",
          undefined,
          303,
          h,
        )
      ).location,
      "/",
    );
    await b("/auth/oidc/start", {}, 200, h);
    await b("/auth/oidc/callback?code=ok&state=test-state", undefined, 303, h);
    assert.equal((await b("/me", undefined, 200, h)).user.id, first.id);
  } finally {
    await x.close();
  }
});

test("personal never offers or accepts account selection and preserves other users", async () => {
  let x = await fixture({ mode: "server" });
  const dir = x.dir;
  try {
    const c = x.client();
    const a = await c("/auth/key/create", { name: "A" });
    await c("/auth/key/create", { name: "B" });
    await x.close(false);
    x = await fixture({ dataDir: dir });
    const local = x.client(),
      config = await local("/auth/config");
    assert.ok(!config.selectAccount && !config.accounts);
    await local("/auth/personal", { userId: a.user.id });
    const me = await local("/me");
    assert.equal(me.user.name, "PERSONAL");
    assert.notEqual(me.user.id, a.user.id);
    assert.equal(x.app.store.db.users.length, 3);
    assert.equal(x.app.store.user(a.user.id).name, "A");
    await x.close(false);
    x = await fixture({ dataDir: dir });
    const again = x.client();
    await again("/auth/personal", {});
    assert.equal((await again("/me")).user.id, me.user.id);
    assert.equal(x.app.store.db.users.length, 3);
  } finally {
    await x.close();
  }
});
test("existing personal profile keeps workspaces and original shared name without selection", async () => {
  let x = await fixture({ mode: "server" });
  const dir = x.dir;
  try {
    const c = x.client();
    const identity = await c("/auth/key/create", { name: "기존 이름" }),
      w = await c("/workspaces", { name: "보존할 프로젝트" }, 201);
    x.app.store.db.deployment.personalUserId = identity.user.id;
    await x.app.store.persist();
    await x.close(false);
    x = await fixture({ dataDir: dir });
    const local = x.client();
    await local("/auth/personal", { userId: "ignored" });
    const me = await local("/me");
    assert.equal(me.user.name, "PERSONAL");
    assert.equal(me.user.id, identity.user.id);
    assert.equal(x.app.store.user(identity.user.id).name, "기존 이름");
    assert.equal((await local("/workspaces/" + w.id)).role, "owner");
    assert.equal(x.app.store.actor(identity.user.id).name, "PERSONAL");
    assert.equal(
      x.app.store.db.workspaces[0].commits[0].author.name,
      "기존 이름",
    );
  } finally {
    await x.close();
  }
});
