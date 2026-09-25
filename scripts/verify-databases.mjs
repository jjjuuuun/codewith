import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Store } from "../server/store.mjs";
import { createApplication } from "../server/index.mjs";
import { keyLogin } from "../tests/auth-helper.mjs";
import { TestPool, sample } from "../tests/fixtures.mjs";
const exec = promisify(execFile);
const docker = async (args) =>
  (await exec("docker", args, { maxBuffer: 5000000 })).stdout.trim();
async function check({ image, kind, port, env }) {
  const suffix = randomBytes(5).toString("hex"),
    name = "codewith-dbtest-" + suffix,
    password = randomBytes(18).toString("hex"),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "codewith-" + kind + "-"));
  let started = false,
    store,
    app;
  try {
    console.log(`${kind}: starting isolated ${image}`);
    await docker([
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-p",
      `127.0.0.1::${port}`,
      ...env(password).flatMap((x) => ["-e", x]),
      image,
    ]);
    started = true;
    const mapping = await docker(["port", name, String(port) + "/tcp"]);
    const hostPort = Number(mapping.split(":").at(-1));
    const databaseUrl = `${kind}://codewith:${password}@127.0.0.1:${hostPort}/codewith`;
    let error;
    for (let i = 0; i < 90; i++) {
      try {
        store = await Store.open(dir, { databaseUrl });
        break;
      } catch (e) {
        error = e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!store) throw error;
    app = await createApplication({
      mode: "server",
      dataDir: dir,
      databaseUrl,
      codexPool: new TestPool(),
    });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const profile = {};
    const { data } = await keyLogin(
      "http://127.0.0.1:" + app.server.address().port,
      profile,
      "DB 관리자",
    );
    const uid = data.user.id;
    await new Promise((r) => app.server.close(r));
    await app.closed;
    app = null;
    await store.close();
    store = await Store.open(dir, { databaseUrl });
    const w = await store.create(uid, "DB 테스트", "team", sample());
    const wid = w.id;
    const doc = structuredClone(w.document);
    doc.specs[0].title = "DB에 저장된 명세";
    await store.commit(w, uid, doc, "DB 커밋", w.head);
    const head = w.head;
    await store.close();
    store = null;
    app = await createApplication({
      mode: "server",
      dataDir: dir,
      databaseUrl,
      codexPool: new TestPool(),
    });
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    const origin = "http://127.0.0.1:" + app.server.address().port;
    const { cookie } = await keyLogin(origin, profile);
    const saved = await (
      await fetch(origin + "/api/workspaces/" + wid, {
        headers: { Cookie: cookie },
      })
    ).json();
    assert.equal(saved.head, head);
    assert.equal(saved.role, "owner");
    assert.equal(saved.document.specs[0].title, "DB에 저장된 명세");
    assert(!fs.existsSync(path.join(dir, "database.json")));
    console.log(
      `${kind}: PASS — restart, login, owner, spec, commit; no file fallback`,
    );
  } finally {
    if (app) {
      await new Promise((r) => app.server.close(r));
      await app.closed;
    }
    await store?.close();
    if (started) await docker(["stop", "--time", "2", name]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const results = await Promise.allSettled([
  check({
    image: "postgres:17-alpine",
    kind: "postgresql",
    port: 5432,
    env: (p) => [
      "POSTGRES_USER=codewith",
      "POSTGRES_PASSWORD=" + p,
      "POSTGRES_DB=codewith",
    ],
  }),
  check({
    image: "mariadb:11.4",
    kind: "mariadb",
    port: 3306,
    env: (p) => [
      "MARIADB_ROOT_PASSWORD=" + p,
      "MARIADB_DATABASE=codewith",
      "MARIADB_USER=codewith",
      "MARIADB_PASSWORD=" + p,
    ],
  }),
]);
for (const r of results)
  if (r.status === "rejected") {
    console.error(r.reason.message);
    process.exitCode = 1;
  }
