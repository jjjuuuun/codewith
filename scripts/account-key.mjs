import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Store, id, hash, stamp } from "../server/store.mjs";
const args = process.argv.slice(2),
  value = (k) => args[args.indexOf(k) + 1];
const store = await Store.open(process.env.CODEWITH_DATA_DIR || ".codewith", {
  databaseUrl: process.env.CODEWITH_DATABASE_URL,
});
try {
  if (args.includes("--list"))
    console.log(
      JSON.stringify(
        store.db.users
          .filter((u) => !u.movedTo)
          .map(({ id, login, name }) => ({ id, login, name })),
        null,
        2,
      ),
    );
  else {
    if (!args.includes("--user"))
      throw Error(
        "서버를 중지하고 실행하세요: npm run account:key -- --user 사용자ID또는login [--output 파일.json] [--apply]. 목록: --list",
      );
    const u = store.db.users.find(
      (u) =>
        !u.movedTo && (u.id === value("--user") || u.login === value("--user")),
    );
    if (!u) throw Error("계정이 없습니다. --list로 확인하세요.");
    const output = path.resolve(
      args.includes("--output") ? value("--output") : "codewith-login-key.json",
    );
    console.log(
      JSON.stringify(
        { userId: u.id, name: u.name, output, apply: args.includes("--apply") },
        null,
        2,
      ),
    );
    if (args.includes("--apply")) {
      const key = "cwk_" + randomBytes(32).toString("base64url");
      store.db.deployment ??= { instanceId: id("instance") };
      fs.writeFileSync(
        output,
        JSON.stringify(
          {
            format: "codewith-login-key-v1",
            instanceId: store.db.deployment.instanceId,
            accountId: u.id,
            key,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
      u.accessKeys ??= [];
      u.accessKeys.push({ id: id("key"), hash: hash(key), createdAt: stamp() });
      store.db.sessions = store.db.sessions.filter((s) => s.userId !== u.id);
      delete store.db.deployment.setupHash;
      await store.persist();
      const setupFile = path.join(store.dir, "setup-key");
      if (fs.existsSync(setupFile)) fs.unlinkSync(setupFile);
      console.log(
        "계정 ID와 기존 데이터는 유지했습니다. 발급 파일은 계정 소유자에게 안전하게 전달하세요.",
      );
    }
  }
} finally {
  await store.close();
}
