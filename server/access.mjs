import { AUTH_POLICY } from "../shared/config.mjs";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { id, hash, stamp } from "./store.mjs";
import { problem } from "../shared/schema.mjs";
import { isLoopback } from "./deployment.mjs";
const secret = () => randomBytes(32).toString("base64url");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const newUser = (name) => ({
  id: id("user"),
  login: id("account"),
  name:
    String(name || "CodeWith 사용자")
      .trim()
      .slice(0, 80) || "CodeWith 사용자",
  needsProfile: !String(name || "").trim(),
  createdAt: stamp(),
});
export async function createAccess({
  store,
  config,
  mailTransport,
  webAuthn,
  oidcClient,
}) {
  const { mode, origin, methods } = config,
    db = store.db;
  db.deployment ??= { instanceId: id("instance") };
  const state = db.deployment;
  if (state.mode !== mode) {
    db.sessions = [];
    state.mode = mode;
  }
  const users = db.users.filter((u) => !u.movedTo);
  let personal = null;
  if (mode === "personal") {
    personal =
      users.find((u) => u.id === state.personalUserId) ||
      users.find((u) => u.personalProfile);
    if (!personal) {
      personal = {
        ...newUser("PERSONAL"),
        personalProfile: true,
        needsProfile: false,
      };
      db.users.push(personal);
    }
    state.personalUserId = personal.id;
    store.personalUserId = personal.id;
  }

  const hasCredentials = (u) =>
    u.accessKeys?.length ||
    u.keyFingerprint ||
    u.passkeys?.length ||
    u.emailIdentity ||
    u.oidcIdentities?.length;
  const setupFile = path.join(store.dir, "setup-key");
  if (mode === "shared" && users.some(hasCredentials) && state.setupHash) {
    delete state.setupHash;
    if (fs.existsSync(setupFile)) fs.unlinkSync(setupFile);
  }
  if (mode === "shared" && !users.some(hasCredentials) && !state.setupHash) {
    const key = "cwsetup_" + secret();
    state.setupHash = hash(key);
    fs.writeFileSync(setupFile, key + "\n", { mode: 0o600 });
  }
  await store.persist();
  const pending = new Map(),
    limits = new Map();
  let mail = mailTransport,
    wa = webAuthn,
    oc = oidcClient,
    oidcConfig;
  function rate(req, scope, max = AUTH_POLICY.defaultAttempts) {
    const now = Date.now();
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    const key = scope + ":" + req.socket.remoteAddress;
    const v = limits.get(key) || { n: 0, until: now + AUTH_POLICY.flowMs };
    v.n++;
    limits.set(key, v);
    if (v.n > max)
      throw problem(
        `시도 횟수가 많습니다. ${AUTH_POLICY.flowMs / 60000}분 후 다시 시도하세요.`,
        429,
      );
  }
  const cookie = (value, age, sameSite = "Strict") =>
    `codewith_access=${value}; Path=/api/auth; HttpOnly; SameSite=${sameSite}; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
  function put(req, res, flow) {
    for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
    if (pending.size >= AUTH_POLICY.pendingFlows)
      throw problem("잠시 후 다시 시도하세요.", 429);
    const token = secret();
    pending.set(hash(token), {
      ...flow,
      expires: Date.now() + AUTH_POLICY.flowMs,
    });
    res.setHeader(
      "Set-Cookie",
      cookie(token, 600, flow.kind === "oidc" ? "Lax" : "Strict"),
    );
  }
  function take(req, kind, consume = true) {
    const token = (req.headers.cookie || "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("codewith_access="))
        ?.slice(16),
      key = hash(token || ""),
      f = pending.get(key);
    if (!f || f.kind !== kind || f.expires < Date.now())
      throw problem("인증 요청이 만료되었습니다. 다시 시작하세요.", 401);
    if (consume) pending.delete(key);
    return f;
  }
  const enabled = (method) => {
    if (!methods.includes(method))
      throw problem("이 운영 모드에서 사용할 수 없는 로그인 방식입니다.", 403);
  };
  function issueKey(u) {
    const key = "cwk_" + secret();
    u.accessKeys ??= [];
    u.accessKeys.push({ id: id("key"), hash: hash(key), createdAt: stamp() });
    return key;
  }
  async function done(res, u, login, json, extra = {}) {
    await login(res, u);
    res.setHeader("Set-Cookie", [res.getHeader("Set-Cookie"), cookie("", 0)]);
    return json(res, 200, { user: store.publicUser(u), ...extra });
  }
  function invite(code) {
    const w = db.workspaces.find(
      (w) => !w.deletedAt && w.visibility === "team" && w.inviteCode === code,
    );
    if (!w) throw problem("유효한 워크스페이스 초대 코드가 필요합니다.", 403);
    return w;
  }
  async function waLib() {
    return (wa ??= await import("@simplewebauthn/server"));
  }
  async function oidc() {
    oc ??= await import("openid-client");
    oidcConfig ??= await oc.discovery(
      new URL(config.oidcIssuer),
      config.oidcClientId,
      config.oidcClientSecret,
    );
    return oc;
  }
  return {
    config,
    setupFile,
    personal,
    publicConfig() {
      return {
        mode,
        methods,
        instanceId: state.instanceId,
        setupRequired: mode === "shared" && !!state.setupHash,
        oidcLabel: config.oidcLabel,
      };
    },
    guard(req) {
      if (mode !== "personal") return;
      const hostname = new URL("http://" + req.headers.host).hostname;
      if (
        !isLoopback(req.socket.remoteAddress) ||
        !isLoopback(hostname) ||
        req.headers.forwarded ||
        req.headers["x-forwarded-for"] ||
        req.headers["x-forwarded-host"]
      )
        throw problem(
          "개인용 모드는 이 PC에서만 접속할 수 있습니다. 공유용 모드로 실행하세요.",
          403,
        );
    },
    async handle(req, res, url, b, u, login, json) {
      const p = url.pathname,
        method = req.method;
      if (p === "/api/auth/config" && method === "GET")
        return json(res, 200, this.publicConfig());
      if (p === "/api/auth/personal" && method === "POST") {
        if (mode !== "personal")
          throw problem("개인용 모드에서만 사용할 수 있습니다.", 403);
        if (u?.id === personal.id)
          return json(res, 200, { user: store.publicUser(personal) });
        return done(res, personal, login, json);
      }
      if (mode === "personal")
        throw problem(
          "개인용 모드는 계정과 로그인 수단을 설정하지 않습니다.",
          403,
        );
      if (p === "/api/auth/account" && method === "GET") {
        if (!u) throw problem("로그인이 필요합니다.", 401);
        return json(res, 200, {
          keys: (u.accessKeys || []).map(({ hash, ...x }) => x),
          passkeys: (u.passkeys || []).map(({ id, createdAt }) => ({
            id,
            createdAt,
          })),
          email: u.emailIdentity || null,
          oidc: !!u.oidcIdentities?.length,
        });
      }
      if (p === "/api/auth/keys" && method === "POST") {
        if (!u) throw problem("로그인이 필요합니다.", 401);
        if ((u.accessKeys || []).length >= AUTH_POLICY.maxKeys)
          throw problem(
            "로그인 키는 최대 10개입니다. 사용하지 않는 키를 제거하세요.",
          );
        const key = issueKey(u);
        await store.persist();
        return json(res, 200, {
          key,
          instanceId: state.instanceId,
          user: store.publicUser(u),
        });
      }
      if (p === "/api/auth/keys/revoke" && method === "POST") {
        if (!u) throw problem("로그인이 필요합니다.", 401);
        if (!u.accessKeys?.some((k) => k.id === b.id))
          throw problem("키가 없습니다.", 404);
        if (
          mode !== "personal" &&
          u.accessKeys.length === 1 &&
          !(mode === "server" && methods.includes("key") && u.keyFingerprint) &&
          !(methods.includes("passkey") && u.passkeys?.length) &&
          !(methods.includes("email") && u.emailIdentity) &&
          !(methods.includes("oidc") && u.oidcIdentities?.length)
        )
          throw problem("마지막 로그인 수단은 삭제할 수 없습니다.");
        u.accessKeys = u.accessKeys.filter((k) => k.id !== b.id);
        db.sessions = db.sessions.filter((s) => s.userId !== u.id);
        return done(res, u, login, json);
      }
      if (p === "/api/auth/key/login" && method === "POST") {
        if (mode === "personal")
          throw problem("개인용은 자동 로그인합니다.", 403);
        rate(req, "key");
        const digest = hash(typeof b.key === "string" ? b.key.trim() : ""),
          owner = db.users.find(
            (x) =>
              !x.movedTo && x.accessKeys?.some((k) => equal(k.hash, digest)),
          );
        if (!owner) throw problem("로그인 키를 확인하세요.", 401);
        return done(res, owner, login, json);
      }
      if (p === "/api/auth/key/create" && method === "POST") {
        enabled("key");
        rate(req, "create", AUTH_POLICY.createAttempts);
        let owner, w;
        if (mode === "shared") {
          if (state.setupHash) {
            if (!equal(hash(String(b.setupKey || "")), state.setupHash))
              throw problem("실행 PC의 초기 설정 키를 입력하세요.", 403);
            const existing = db.users.filter((x) => !x.movedTo);
            owner = state.personalUserId
              ? store.user(state.personalUserId)
              : existing.length === 1
                ? existing[0]
                : null;
            if (!owner && existing.length)
              throw problem(
                "운영자가 account:key 명령으로 기존 계정의 로그인 키를 발급해야 합니다.",
                409,
              );
            delete state.setupHash;
          } else w = invite(b.inviteCode);
        }
        if (!owner) {
          owner = newUser(b.name);
          db.users.push(owner);
        }
        if (String(b.name || "").trim()) {
          owner.name = String(b.name).trim().slice(0, 80);
          owner.needsProfile = false;
        }
        const key = issueKey(owner);
        if (w)
          w.requests.push({
            id: id("join"),
            userId: owner.id,
            status: "pending",
            at: stamp(),
          });
        await store.persist();
        if (!state.setupHash && fs.existsSync(setupFile))
          fs.unlinkSync(setupFile);
        return done(res, owner, login, json, {
          key,
          instanceId: state.instanceId,
          pending: !!w,
        });
      }
      if (p.startsWith("/api/auth/passkey/")) {
        enabled("passkey");
        rate(req, "passkey", AUTH_POLICY.passkeyAttempts);
        const lib = await waLib(),
          rpID = new URL(origin).hostname;
        if (p.endsWith("/register/options") && method === "POST") {
          const user = u || newUser(b.name);
          const options = await lib.generateRegistrationOptions({
            rpName: "CodeWith",
            rpID,
            userID: new TextEncoder().encode(user.id),
            userName: user.name,
            userDisplayName: user.name,
            attestationType: "none",
            authenticatorSelection: {
              residentKey: "required",
              userVerification: "required",
            },
            excludeCredentials: (user.passkeys || []).map((k) => ({
              id: k.id,
              transports: k.transports,
            })),
          });
          put(req, res, {
            kind: "passkey-register",
            challenge: options.challenge,
            user,
            userId: u?.id || null,
          });
          return json(res, 200, options);
        }
        if (p.endsWith("/register/verify") && method === "POST") {
          const f = take(req, "passkey-register");
          if (f.userId !== (u?.id || null))
            throw problem("계정이 변경되었습니다.", 401);
          let result;
          try {
            result = await lib.verifyRegistrationResponse({
              response: b,
              expectedChallenge: f.challenge,
              expectedOrigin: origin,
              expectedRPID: rpID,
              requireUserVerification: true,
            });
          } catch {
            throw problem("패스키 등록을 확인하지 못했습니다.", 401);
          }
          if (!result.verified) throw problem("패스키 등록 실패", 401);
          const c = result.registrationInfo.credential;
          if (db.users.some((x) => x.passkeys?.some((k) => k.id === c.id)))
            throw problem("이미 등록된 패스키입니다.", 409);
          const owner = u || f.user;
          owner.passkeys ??= [];
          owner.passkeys.push({
            id: c.id,
            publicKey: Buffer.from(c.publicKey).toString("base64"),
            counter: c.counter,
            transports: c.transports,
            createdAt: stamp(),
          });
          if (!u) db.users.push(owner);
          return done(res, owner, login, json);
        }
        if (p.endsWith("/login/options") && method === "POST") {
          const options = await lib.generateAuthenticationOptions({
            rpID,
            userVerification: "required",
          });
          put(req, res, {
            kind: "passkey-login",
            challenge: options.challenge,
          });
          return json(res, 200, options);
        }
        if (p.endsWith("/login/verify") && method === "POST") {
          const f = take(req, "passkey-login"),
            owner = db.users.find(
              (x) => !x.movedTo && x.passkeys?.some((k) => k.id === b.id),
            ),
            c = owner?.passkeys.find((k) => k.id === b.id);
          if (!c) throw problem("등록되지 않은 패스키입니다.", 401);
          let result;
          try {
            result = await lib.verifyAuthenticationResponse({
              response: b,
              expectedChallenge: f.challenge,
              expectedOrigin: origin,
              expectedRPID: rpID,
              credential: {
                ...c,
                publicKey: new Uint8Array(Buffer.from(c.publicKey, "base64")),
              },
              requireUserVerification: true,
            });
          } catch {
            throw problem("패스키 인증을 확인하지 못했습니다.", 401);
          }
          if (!result.verified) throw problem("패스키 인증 실패", 401);
          c.counter = result.authenticationInfo.newCounter;
          return done(res, owner, login, json);
        }
      }
      if (p === "/api/auth/email/start" && method === "POST") {
        enabled("email");
        rate(req, "email", AUTH_POLICY.emailAttempts);
        const email = String(b.email || "")
          .trim()
          .toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
          throw problem("이메일 주소를 확인하세요.");
        const code = String(randomInt(10000000, 100000000));
        if (!mail) {
          const nm = await import("nodemailer");
          mail = nm.default.createTransport(config.smtpURL, {
            from: config.mailFrom,
          });
        }
        try {
          await mail.sendMail({
            from: config.mailFrom,
            to: email,
            subject: "CodeWith 로그인 인증 코드",
            text: `CodeWith 인증 코드: ${code}\n${AUTH_POLICY.flowMs / 60000}분 안에 입력하세요. 요청하지 않았다면 무시하세요.`,
          });
        } catch {
          throw problem(
            "인증 메일을 보내지 못했습니다. 메일 발송 설정을 확인하세요.",
            502,
          );
        }
        put(req, res, {
          kind: "email",
          email,
          codeHash: hash(code),
          userId: u?.id || null,
          attempts: 0,
        });
        return json(res, 200, { sent: true });
      }
      if (p === "/api/auth/email/verify" && method === "POST") {
        enabled("email");
        rate(req, "email-verify");
        const f = take(req, "email", false);
        if (++f.attempts > 5) {
          take(req, "email");
          throw problem("인증 코드를 다시 요청하세요.", 401);
        }
        if (!equal(hash(String(b.code || "")), f.codeHash))
          throw problem("인증 코드가 올바르지 않습니다.", 401);
        take(req, "email");
        if (f.userId !== (u?.id || null))
          throw problem("계정이 변경되었습니다.", 401);
        let owner = db.users.find(
          (x) => !x.movedTo && x.emailIdentity === f.email,
        );
        if (owner && u && owner.id !== u.id)
          throw problem("다른 계정에 등록된 이메일입니다.", 409);
        owner = owner || u;
        if (!owner) {
          owner = newUser();
          db.users.push(owner);
        }
        owner.emailIdentity = f.email;
        return done(res, owner, login, json);
      }
      if (p === "/api/auth/oidc/start" && method === "POST") {
        enabled("oidc");
        rate(req, "oidc");
        const lib = await oidc(),
          verifier = lib.randomPKCECodeVerifier(),
          state = lib.randomState(),
          nonce = lib.randomNonce();
        const authURL = lib.buildAuthorizationUrl(oidcConfig, {
          redirect_uri: origin + "/api/auth/oidc/callback",
          scope: "openid profile email",
          code_challenge: await lib.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
          state,
          nonce,
        });
        let returnTo = "/";
        try {
          const target = new URL(String(b.returnTo || "/"), origin);
          if (
            target.origin === origin &&
            !target.username &&
            !target.password &&
            target.href.length < 2000
          )
            returnTo = target.pathname + target.search;
        } catch {}
        put(req, res, {
          kind: "oidc",
          verifier,
          state,
          nonce,
          userId: u?.id || null,
          returnTo,
        });
        return json(res, 200, { url: authURL.href });
      }
      if (p === "/api/auth/oidc/callback" && method === "GET") {
        enabled("oidc");
        const f = take(req, "oidc"),
          lib = await oidc();
        let claims;
        try {
          const tokens = await lib.authorizationCodeGrant(
            oidcConfig,
            new URL(url.pathname + url.search, origin),
            {
              pkceCodeVerifier: f.verifier,
              expectedState: f.state,
              expectedNonce: f.nonce,
              idTokenExpected: true,
            },
          );
          claims = tokens.claims();
        } catch {
          throw problem(
            "조직 로그인 인증을 확인하지 못했습니다. 다시 로그인하세요.",
            401,
          );
        }
        if (!claims?.sub || claims.iss !== oidcConfig.serverMetadata().issuer)
          throw problem("조직 계정 식별 정보를 확인하지 못했습니다.", 401);
        const subject = hash(claims.iss + "\0" + claims.sub);
        let owner = db.users.find(
          (x) => !x.movedTo && x.oidcIdentities?.includes(subject),
        );
        const linked = f.userId ? store.user(f.userId) : null;
        if (owner && linked && owner.id !== linked.id)
          throw problem("이미 다른 계정에 연결된 조직 계정입니다.", 409);
        owner = owner || linked;
        if (!owner) {
          owner = newUser(claims.name);
          db.users.push(owner);
        }
        owner.oidcIdentities ??= [];
        if (!owner.oidcIdentities.includes(subject))
          owner.oidcIdentities.push(subject);
        await login(res, owner);
        res.setHeader("Set-Cookie", [
          res.getHeader("Set-Cookie"),
          cookie("", 0),
        ]);
        res.writeHead(303, { Location: f.returnTo || "/" });
        return res.end();
      }
      throw problem("인증 API를 찾을 수 없습니다.", 404);
    },
    close() {
      pending.clear();
      limits.clear();
      mail?.close?.();
    },
  };
}
