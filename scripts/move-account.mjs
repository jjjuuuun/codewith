import { Store } from "../server/store.mjs";
const args = process.argv.slice(2),
  value = (k) => args[args.indexOf(k) + 1];
if (!args.includes("--from") || !args.includes("--to"))
  throw Error(
    "사용법: npm run account:move -- --from 원본ID또는login --to 대상ID [--apply]. 서버를 먼저 중지하세요.",
  );
const store = await Store.open(process.env.CODEWITH_DATA_DIR || ".codewith", {
  databaseUrl: process.env.CODEWITH_DATABASE_URL,
});
try {
  const from = store.db.users.find(
      (u) => u.id === value("--from") || u.login === value("--from"),
    ),
    to = store.db.users.find((u) => u.id === value("--to"));
  if (!from || !to || from.id === to.id)
    throw Error("서로 다른 원본·대상 계정을 지정하세요.");
  const workspaces = store.db.workspaces.filter((w) =>
      w.members.some((m) => m.userId === from.id),
    ),
    chats = store.db.chats.filter((m) => m.userId === from.id);
  console.log(
    JSON.stringify(
      {
        from: from.id,
        to: to.id,
        workspaces: workspaces.length,
        chats: chats.length,
        apply: args.includes("--apply"),
      },
      null,
      2,
    ),
  );
  if (args.includes("--apply")) {
    for (const w of workspaces) {
      const old = w.members.find((m) => m.userId === from.id),
        current = w.members.find((m) => m.userId === to.id);
      if (w.ownerId === from.id) w.ownerId = to.id;
      if (current) {
        if (
          old.role === "owner" ||
          (old.role === "editor" && current.role === "viewer")
        )
          current.role = old.role;
        w.members = w.members.filter((m) => m !== old);
      } else old.userId = to.id;
      for (const r of w.requests) if (r.userId === from.id) r.userId = to.id;
    }
    for (const m of chats) m.userId = to.id;
    store.db.sessions = store.db.sessions.filter((s) => s.userId !== from.id);
    from.movedTo = to.id;
    await store.persist();
    console.log(
      "계정 데이터를 이전했습니다. AI 인증과 과거 커밋 작성자는 자동 병합하지 않았습니다.",
    );
  }
} finally {
  await store.close();
}
