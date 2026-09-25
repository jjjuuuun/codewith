import { keyLogin } from "./auth-helper.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../server/index.mjs";
import { sample, TestPool } from "./fixtures.mjs";
import { validateDocument, copy, blankSpec } from "../shared/schema.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codewith-test-"));
const pool = new TestPool();
const { server, store } = await createApplication({
  mode: "server",
  dataDir: dir,
  codexPool: pool,
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
function client() {
  let cookie = "";
  const profile = {};
  return async (p, method = "GET", body, expected = 200) => {
    if (p === "/test-key-login") {
      const result = await keyLogin(base, profile, body.name);
      cookie = result.cookie;
      return result.data;
    }
    const r = await fetch(base + "/api" + p, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CodeWith": "1",
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (r.headers.has("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const j = r.headers.get("content-type")?.includes("event-stream")
      ? await r.text()
      : await r.json();
    assert.equal(r.status, expected, JSON.stringify(j));
    return j;
  };
}
const owner = client(),
  member = client(),
  other = client();
let w, initial, memberId;
test.after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});
test("key accounts, workspace ownership, anonymous access", async () => {
  const a = await owner("/test-key-login", "POST", {
    name: "소유자",
    login: "owner",
    password: "password-123",
  });
  memberId = (
    await member("/test-key-login", "POST", {
      name: "팀원",
      login: "member",
      password: "password-123",
    })
  ).user.id;
  await other("/test-key-login", "POST", {
    name: "외부 사용자",
    login: "other",
    password: "password-123",
  });
  w = await owner(
    "/workspaces",
    "POST",
    { exchange: sample(), visibility: "team" },
    201,
  );
  initial = w.head;
  assert.equal(w.role, "owner");
  assert.equal(w.document.specs[0].createdBy.id, a.user.id);
  await member("/workspaces/" + w.id, "GET", undefined, 403);
  const r = await fetch(base + "/api/me");
  assert.equal(r.status, 401);
});
test("owner approves members; viewer cannot modify; editor can", async () => {
  await member("/join", "POST", { code: w.inviteCode });
  w = await owner("/workspaces/" + w.id);
  const request = w.requests[0];
  await other(
    "/workspaces/" + w.id + "/members",
    "POST",
    { requestId: request.id, approve: true },
    403,
  );
  w = await owner("/workspaces/" + w.id + "/members", "POST", {
    requestId: request.id,
    approve: true,
    role: "viewer",
  });
  await member(
    "/workspaces/" + w.id,
    "PATCH",
    { base: w.head, document: w.document },
    403,
  );
  w = await owner("/workspaces/" + w.id + "/members", "POST", {
    userId: memberId,
    role: "editor",
  });
  const doc = copy(w.document);
  doc.specs[0].requirements[0].title = "중복 요청 거절";
  w = await member("/workspaces/" + w.id, "PATCH", {
    base: w.head,
    document: doc,
    message: "팀원 수정",
  });
  assert.equal(w.commits[0].author.id, memberId);
});
test("conflict rejection, reference validation, custom IDs, aggregated uniqueness", async () => {
  await owner(
    "/workspaces/" + w.id,
    "PATCH",
    { base: initial, document: w.document },
    409,
  );
  const doc = copy(w.document);
  doc.specs[0].requirements[0].id = "TEAM-REQ-100";
  await owner(
    "/workspaces/" + w.id,
    "PATCH",
    { base: w.head, document: doc },
    400,
  );
  doc.specs[0].tasks[0].req = "TEAM-REQ-100";
  w = await owner("/workspaces/" + w.id, "PATCH", {
    base: w.head,
    document: doc,
    message: "식별번호 변경",
  });
  const duplicate = copy(w.document);
  duplicate.specs.push({
    ...blankSpec("SPEC-2", "둘째"),
    requirements: copy(duplicate.specs[0].requirements).map(
      ({ recordId, ...requirement }) => requirement,
    ),
  });
  assert.throws(() => validateDocument(duplicate), /식별번호/);
});
test("requirement resources round trip and invalid assets rejected", async () => {
  const doc = copy(w.document);
  doc.specs[0].requirements[0].resources.push(
    {
      id: "GRAPH-1",
      type: "chart",
      title: "목표",
      values: [{ label: "ms", value: 200 }],
    },
    {
      id: "FLOW-1",
      type: "flow",
      title: "등록 흐름",
      steps: ["입력", "중복 확인", "저장"],
    },
  );
  w = await owner("/workspaces/" + w.id, "PATCH", {
    base: w.head,
    document: doc,
  });
  const exchange = await owner("/workspaces/" + w.id + "/export");
  assert.deepEqual(exchange.document, w.document);
  assert.equal(exchange.document.specs[0].requirements[0].resources.length, 3);
  assert.equal(exchange.members, undefined);
  const bad = copy(doc);
  bad.specs[0].requirements[0].resources.push({
    id: "BAD",
    type: "image",
    title: "실행 SVG",
    data: "data:image/svg+xml;base64,PHN2Zz4=",
  });
  assert.throws(() => validateDocument(bad), /이미지/);
});
test("legacy agreement state no longer gates editing and does not mean implemented", async () => {
  let doc = copy(w.document);
  doc.specs[0].status = "accepted";
  doc.specs[0].requirements[0].status = "accepted";
  w = await owner("/workspaces/" + w.id, "PATCH", {
    base: w.head,
    document: doc,
  });
  assert.equal(w.document.specs[0].status, "pending");
  const v = w.document.specs[0].version;
  doc = copy(w.document);
  doc.specs[0].tasks[0].done = true;
  w = await owner("/workspaces/" + w.id, "PATCH", {
    base: w.head,
    document: doc,
  });
  assert.equal(w.document.specs[0].version, v);
  assert.equal(w.document.specs[0].status, "pending");
});
test("server AI endpoints require configured connections; manual code fixtures still persist", async () => {
  await owner(
    "/ai/key",
    "POST",
    { provider: "codex", key: "must-not-store" },
    401,
  );
  assert.equal(store.db.chats.length, 0);
  let doc = copy(w.document);
  doc.files["src/Example.java"] = "class Example {}";
  w = await owner("/workspaces/" + w.id, "PATCH", {
    base: w.head,
    document: doc,
  });
  assert.equal(w.document.specs[0].status, "pending");
  assert.equal(
    fs.readFileSync(
      path.join(dir, "projects", w.id, "src/Example.java"),
      "utf8",
    ),
    "class Example {}",
  );
});
test("path traversal rejected and external file edits are not overwritten", async () => {
  let doc = copy(w.document);
  doc.files["../escape.java"] = "bad";
  await owner(
    "/workspaces/" + w.id,
    "PATCH",
    { base: w.head, document: doc },
    400,
  );
  const p = Object.keys(w.document.files)[0],
    target = path.join(dir, "projects", w.id, p);
  fs.writeFileSync(target, "external change");
  doc = copy(w.document);
  doc.files[p] = "new content";
  await owner(
    "/workspaces/" + w.id,
    "PATCH",
    { base: w.head, document: doc },
    409,
  );
  assert.equal(fs.readFileSync(target, "utf8"), "external change");
  fs.writeFileSync(target, w.document.files[p]);
});
test("restoring project appends a commit and restores code and materials, never membership", async () => {
  const oldHead = w.head;
  w = await owner("/workspaces/" + w.id + "/restore", "POST", {
    base: w.head,
    commitId: initial,
  });
  assert.notEqual(w.head, initial);
  assert.equal(w.commits[0].parent, oldHead);
  assert.equal(w.commits[0].restoreOf, initial);
  assert.equal(Object.keys(w.document.files).length, 0);
  assert.equal(w.document.specs[0].requirements[0].id, "REG-001");
  assert.equal(w.document.specs[0].status, "pending");
  assert.equal(w.members.length, 2);
});
test("mutations require same origin; state persists on disk without cleartext passwords", async () => {
  const r = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.invalid",
      "X-CodeWith": "1",
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
  const saved = fs.readFileSync(path.join(dir, "database.json"), "utf8");
  assert(!saved.includes("password-123"));
  assert(JSON.parse(saved).workspaces[0].commits.length > 3);
});

test("editing an agreed spec reopens it before lifecycle validation; legacy goals survive", async () => {
  const doc = sample();
  doc.specs[0].subtitle = "보존할 기존 목표";
  doc.specs[0].requirements[0].status = "accepted";
  doc.specs[0].status = "accepted";
  let own = await owner("/workspaces", "POST", { exchange: doc }, 201);
  const changed = copy(own.document);
  changed.specs[0].requirements.push({
    id: "REG-NEW",
    title: "추가 요구",
    body: "추가 동작",
    status: "draft",
    criteria: [],
  });
  own = await owner("/workspaces/" + own.id, "PATCH", {
    base: own.head,
    document: changed,
  });
  assert.equal(own.document.specs[0].status, "pending");
  assert.equal(own.document.specs[0].version, 2);
  assert.equal(own.document.specs[0].subtitle, "보존할 기존 목표");
  const bad = copy(own.document);
  bad.specs[0].status = "accepted";
  own = await owner("/workspaces/" + own.id, "PATCH", {
    base: own.head,
    document: bad,
  });
  assert.equal(own.document.specs[0].status, "pending");
  delete bad.specs[0].subtitle;
  bad.specs[0].status = "draft";
  assert.equal(validateDocument(bad).specs[0].subtitle, "");
});

test("only owner may delete a current workspace; deletion blocks all access and survives restart", async () => {
  let target = await owner(
    "/workspaces",
    "POST",
    { exchange: sample(), visibility: "team" },
    201,
  );
  const code = target.inviteCode;
  await member("/join", "POST", { code });
  target = await owner("/workspaces/" + target.id);
  target = await owner("/workspaces/" + target.id + "/members", "POST", {
    requestId: target.requests[0].id,
    approve: true,
    role: "editor",
  });
  await member(
    "/workspaces/" + target.id,
    "DELETE",
    { base: target.head },
    403,
  );
  await other("/workspaces/" + target.id, "DELETE", { base: target.head }, 403);
  await owner("/workspaces/" + target.id, "DELETE", { base: "stale" }, 409);
  await owner("/workspaces/" + target.id, "DELETE", { base: target.head });
  assert(
    !(await owner("/workspaces")).workspaces.some((x) => x.id === target.id),
  );
  assert(
    !(await member("/workspaces")).workspaces.some((x) => x.id === target.id),
  );
  for (const endpoint of [
    "",
    "/export",
    "/head",
    "/chats?spec=SPEC-REG",
    "/commits/" + target.head,
  ])
    await owner("/workspaces/" + target.id + endpoint, "GET", undefined, 404);
  await member("/workspaces/" + target.id, "GET", undefined, 404);
  await other("/join", "POST", { code }, 404);
  await owner(
    "/workspaces/" + target.id,
    "PATCH",
    { base: target.head, document: target.document },
    404,
  );
  const { Store } = await import("../server/store.mjs");
  const reopened = await Store.open(dir);
  try {
    assert(!reopened.list(target.ownerId).some((x) => x.id === target.id));
    assert.throws(
      () => reopened.workspace(target.id, target.ownerId),
      /찾을 수/,
    );
    assert(reopened.db.workspaces.find((x) => x.id === target.id).deletedAt);
  } finally {
    await reopened.close();
  }
});

test("deep links serve the app shell without exposing workspace data; unknown routes remain 404", async () => {
  for (const suffix of [
    "",
    "/history",
    "/project",
    "/specs/SPEC-REG/requirements",
    "/specs/SPEC-REG/plan",
  ]) {
    const r = await fetch(base + "/workspaces/" + w.id + suffix);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(await r.text(), /src="\/assets\/[^" ]+\.js"/);
  }
  assert.equal((await fetch(base + "/routes.js")).status, 200);
  assert.equal(
    (await fetch(base + "/workspaces/" + w.id + "/unknown")).status,
    404,
  );
  assert.equal((await fetch(base + "/api/workspaces/" + w.id)).status, 401);
});

test("workspace rename commits and rejects stale changes and non-owner updates", async () => {
  const before = w.head;
  await member(
    "/workspaces/" + w.id,
    "PATCH",
    { base: before, document: { ...w.document, project: "forbidden" } },
    403,
  );
  await member(
    "/workspaces/" + w.id + "/name",
    "POST",
    { base: before, name: "forbidden" },
    403,
  );
  await owner(
    "/workspaces/" + w.id + "/name",
    "POST",
    { base: "stale", name: "changed" },
    409,
  );
  await owner(
    "/workspaces/" + w.id + "/name",
    "POST",
    { base: before, name: "  " },
    400,
  );
  w = await owner("/workspaces/" + w.id + "/name", "POST", {
    base: before,
    name: "  새 프로젝트 이름  ",
  });
  assert.equal(w.document.project, "새 프로젝트 이름");
  assert.equal(w.commits[0].parent, before);
  assert.equal(w.commits[0].message, "워크스페이스 이름 수정");
  assert.equal(
    (await owner("/workspaces")).workspaces.find((x) => x.id === w.id).name,
    "새 프로젝트 이름",
  );
});

test("workspace basic settings update together with owner checks and revision protection", async () => {
  const before = w.head;
  await member(
    "/workspaces/" + w.id + "/settings",
    "POST",
    { base: before, name: "member change", purpose: "" },
    403,
  );
  await owner(
    "/workspaces/" + w.id + "/settings",
    "POST",
    { base: "old", name: "new", purpose: "" },
    409,
  );
  await owner(
    "/workspaces/" + w.id + "/settings",
    "POST",
    { base: before, name: "new", purpose: 12 },
    400,
  );
  w = await owner("/workspaces/" + w.id + "/settings", "POST", {
    base: before,
    name: "기본 설정 테스트",
    purpose: "프로젝트 목적을 합의한다.",
  });
  assert.equal(w.document.project, "기본 설정 테스트");
  assert.equal(w.document.projectSpec.purpose, "프로젝트 목적을 합의한다.");
  assert.equal(w.commits[0].message, "워크스페이스 기본 설정 수정");
  assert.equal(w.commits[0].parent, before);
});

test("retired bridge authentication cannot create sessions", async () => {
  for (const route of ["challenge", "verify"]) {
    const response = await fetch(base + "/api/auth/key/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CodeWith": "1" },
      body: JSON.stringify({ publicKey: "legacy", signature: "legacy" }),
    });
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});
