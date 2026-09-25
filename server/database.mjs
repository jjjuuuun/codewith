import { runtimeConfig as runtime } from "./runtime-config.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openPersistence } from "./persistence.mjs";
const empty = () => ({
  version: 2,
  users: [],
  sessions: [],
  workspaces: [],
  chats: [],
});
export function validateState(state) {
  if (
    state?.version !== 2 ||
    !["users", "sessions", "workspaces", "chats"].every((k) =>
      Array.isArray(state[k]),
    )
  )
    throw new Error("저장소 데이터 형식이 올바르지 않습니다.");
  return state;
}
export async function connectStorage(
  dataDir,
  {
    databaseUrl = process.env.CODEWITH_DATABASE_URL || "",
    importFile = process.env.CODEWITH_IMPORT_FILE === "1",
    adapterPath = process.env.CODEWITH_STORAGE_ADAPTER || "",
    connect,
  } = {},
) {
  if (!databaseUrl.trim() && !adapterPath)
    return openPersistence(dataDir, { databaseUrl: "" });
  if (adapterPath) {
    let adapter;
    try {
      const module = await import(
        pathToFileURL(path.resolve(adapterPath)).href
      );
      adapter = await module.open({ dataDir, databaseUrl });
      if (
        !adapter ||
        !["read", "write", "close"].every(
          (k) => typeof adapter[k] === "function",
        ) ||
        typeof adapter.kind !== "string"
      )
        throw new Error();
      return adapter;
    } catch (e) {
      try {
        await adapter?.close?.();
      } catch {}
      throw new Error(
        "사용자 DB 어댑터를 열 수 없습니다. open/read/write/close 인터페이스를 확인하세요. 파일 저장소로 전환하지 않았습니다.",
      );
    }
  }
  if (databaseUrl.startsWith("sqlite:"))
    return openPersistence(dataDir, { databaseUrl, importFile });
  let kind;
  try {
    const scheme = new URL(databaseUrl).protocol;
    kind = ["postgres:", "postgresql:"].includes(scheme)
      ? "postgresql"
      : ["mysql:", "mariadb:"].includes(scheme)
        ? "mysql"
        : null;
  } catch {}
  if (!kind)
    throw new Error(
      "지원하지 않는 연결 형식입니다. PostgreSQL·MySQL/MariaDB·SQLite URL 또는 CODEWITH_STORAGE_ADAPTER를 지정하세요.",
    );
  let client;
  try {
    client = await (connect || connectDriver)(kind, databaseUrl);
    const pg = kind === "postgresql";
    await client.query(
      `CREATE TABLE IF NOT EXISTS codewith_state (id SMALLINT PRIMARY KEY, revision BIGINT NOT NULL, payload ${pg ? "TEXT" : "LONGTEXT"} NOT NULL, updated_at VARCHAR(40) NOT NULL)${pg ? "" : " ENGINE=InnoDB"}`,
    );
    const rows = await client.query(
      "SELECT revision,payload FROM codewith_state WHERE id=1",
    );
    if (!rows.rows.length) {
      const file = path.join(dataDir, "database.json");
      const initial =
        importFile && fs.existsSync(file)
          ? validateState(JSON.parse(fs.readFileSync(file, "utf8")))
          : empty();
      await client.query(
        pg
          ? "INSERT INTO codewith_state(id,revision,payload,updated_at) VALUES(1,0,$1,$2) ON CONFLICT(id) DO NOTHING"
          : "INSERT INTO codewith_state(id,revision,payload,updated_at) VALUES(1,0,?,?) ON DUPLICATE KEY UPDATE id=id",
        [JSON.stringify(initial), new Date().toISOString()],
      );
    }
    let revision,
      queue = Promise.resolve();
    return {
      kind: databaseUrl.startsWith("mariadb:") ? "mariadb" : kind,
      async read() {
        const { rows } = await client.query(
          "SELECT revision,payload FROM codewith_state WHERE id=1",
        );
        if (rows.length !== 1) throw new Error("DB 상태 행이 없습니다.");
        revision = Number(rows[0].revision);
        return validateState(JSON.parse(rows[0].payload));
      },
      write(state) {
        const payload = JSON.stringify(state);
        queue = queue.then(async () => {
          try {
            const r = await client.query(
              pg
                ? "UPDATE codewith_state SET payload=$1,revision=revision+1,updated_at=$2 WHERE id=1 AND revision=$3"
                : "UPDATE codewith_state SET payload=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?",
              [payload, new Date().toISOString(), revision],
            );
            if (r.rowCount !== 1) throw new Error("revision conflict");
            revision++;
          } catch {
            throw new Error(
              "DB 저장 실패 또는 다른 서버의 변경을 감지했습니다. DB 상태를 확인하고 단일 서버로 다시 시작하세요.",
            );
          }
        });
        return queue;
      },
      async close() {
        await queue.catch(() => {});
        await client.close();
      },
    };
  } catch (e) {
    try {
      await client?.close();
    } catch {}
    throw new Error(
      `${kind} 연결 초기화에 실패했습니다. 드라이버 설치·연결 주소·인증·DB 생성 권한을 확인하세요. 파일 저장소로 전환하지 않았습니다.`,
    );
  }
}
async function connectDriver(kind, url) {
  if (kind === "postgresql") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: runtime.databaseConnectTimeoutMs,
      query_timeout: runtime.databaseQueryTimeoutMs,
    });
    client.on("error", () => {});
    try {
      await client.connect();
    } catch (e) {
      await client.end().catch(() => {});
      throw e;
    }
    return {
      query: (sql, params) => client.query(sql, params),
      close: () => client.end(),
    };
  }
  const { default: mysql } = await import("mysql2/promise");
  const uri = url.replace(/^mariadb:/, "mysql:");
  const client = await mysql.createConnection({
    uri,
    connectTimeout: runtime.databaseConnectTimeoutMs,
  });
  client.on("error", () => {});
  return {
    async query(sql, params) {
      const [r] = await client.query(
        { sql, timeout: runtime.databaseQueryTimeoutMs },
        params,
      );
      return Array.isArray(r)
        ? { rows: r, rowCount: r.length }
        : { rows: [], rowCount: r.affectedRows };
    },
    close: () => client.end(),
  };
}
