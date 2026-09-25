import { runtimeConfig as runtime } from "./runtime-config.mjs";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const empty = () => ({
  version: 2,
  users: [],
  sessions: [],
  workspaces: [],
  chats: [],
});
function validate(state) {
  if (
    state?.version !== 2 ||
    !["users", "sessions", "workspaces", "chats"].every((k) =>
      Array.isArray(state[k]),
    )
  )
    throw new Error("지원하지 않거나 손상된 CodeWith 저장소입니다.");
  return state;
}
export function openPersistence(
  dir,
  {
    databaseUrl = process.env.CODEWITH_DATABASE_URL || "",
    importFile = process.env.CODEWITH_IMPORT_FILE === "1",
  } = {},
) {
  const file = path.join(dir, "database.json");
  if (!databaseUrl.trim())
    return {
      kind: "file",
      location: file,
      read: () =>
        fs.existsSync(file)
          ? validate(JSON.parse(fs.readFileSync(file, "utf8")))
          : empty(),
      write(state) {
        const temp = file + ".tmp";
        fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
        fs.renameSync(temp, file);
      },
      close() {},
    };
  if (!databaseUrl.startsWith("sqlite:"))
    throw new Error(
      "현재 DB 연결은 sqlite: 경로를 지원합니다. 설정한 DB에 실패하면 파일 저장소로 전환하지 않습니다.",
    );
  const value = databaseUrl.slice(7);
  if (
    !value ||
    value === ":memory:" ||
    value.includes("?") ||
    value.includes("#")
  )
    throw new Error(
      "SQLite 연결에는 영속 DB 파일 경로를 지정하세요. 예: sqlite:codewith.sqlite",
    );
  const location = path.resolve(dir, value);
  if (location === file)
    throw new Error("SQLite 경로로 기존 database.json을 지정할 수 없습니다.");
  fs.mkdirSync(path.dirname(location), { recursive: true, mode: 0o700 });
  let db;
  try {
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(location);
    db.exec(
      `PRAGMA busy_timeout=${runtime.sqliteBusyTimeoutMs}; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS codewith_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;`,
    );
    const current = db
      .prepare("SELECT revision,payload FROM codewith_state WHERE id=1")
      .get();
    if (!current) {
      const state =
        importFile && fs.existsSync(file)
          ? validate(JSON.parse(fs.readFileSync(file, "utf8")))
          : empty();
      db.prepare(
        "INSERT INTO codewith_state(id,revision,payload,updated_at) VALUES(1,0,?,?)",
      ).run(JSON.stringify(state), new Date().toISOString());
    }
    let revision;
    return {
      kind: "sqlite",
      location,
      read() {
        const row = db
          .prepare("SELECT revision,payload FROM codewith_state WHERE id=1")
          .get();
        revision = row.revision;
        return validate(JSON.parse(row.payload));
      },
      write(state) {
        const result = db
          .prepare(
            "UPDATE codewith_state SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?",
          )
          .run(JSON.stringify(state), new Date().toISOString(), revision);
        if (result.changes !== 1)
          throw new Error(
            "다른 서버가 DB를 변경했습니다. 단일 서버로 다시 시작하세요.",
          );
        revision++;
      },
      close() {
        db.close();
      },
    };
  } catch (e) {
    try {
      db?.close();
    } catch {}
    throw new Error(
      "SQLite 저장소를 열 수 없습니다. DB 경로·권한·형식을 확인하세요. 파일 저장소로 자동 전환하지 않았습니다.",
      { cause: e },
    );
  }
}
