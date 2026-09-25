import { runtimeConfig as runtime } from "./runtime-config.mjs";
import { AUTH_POLICY } from "../shared/config.mjs";
import { officialLoginURL } from "../shared/auth-urls.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { claudeEnvironment, createClaudeCode } from "./claude-code.mjs";
import { problem } from "../shared/schema.mjs";
export function createClaudeAuth({
  dataDir,
  binary = process.env.CODEWITH_CLAUDE_BIN || "claude",
  spawnProcess = spawn,
}) {
  const adapter = createClaudeCode({ dataDir, binary, spawnProcess }),
    pending = new Map();
  const config = (id) => {
    const d = path.join(dataDir, "claude", id);
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    return d;
  };
  function command(id, args) {
    return new Promise((resolve, reject) => {
      const dir = config(id),
        child = spawnProcess(binary, args, {
          cwd: dir,
          env: claudeEnvironment(dir),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      let out = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(problem("Claude 인증 확인 시간이 초과되었습니다.", 504));
      }, runtime.cliStartupTimeoutMs);
      child.stdout.on("data", (b) => {
        out += b;
        if (out.length > 100000) child.kill();
      });
      child.stderr.on("data", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        reject(problem("서버에서 Claude Code CLI를 찾을 수 없습니다.", 503));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
  }
  async function account(id) {
    const r = await command(id, ["auth", "status"]);
    let value;
    try {
      value = JSON.parse(r.out);
    } catch {
      throw problem(
        "Claude 인증 상태를 읽을 수 없습니다. CLI 버전을 확인하세요.",
        502,
      );
    }
    return {
      account:
        r.code === 0 && value.loggedIn
          ? { type: "claude", email: value.email || null }
          : null,
    };
  }
  function login(id) {
    if (pending.has(id)) return pending.get(id).state;
    const dir = config(id),
      child = spawnProcess(binary, ["auth", "login", "--claudeai"], {
        cwd: dir,
        env: claudeEnvironment(dir),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    const state = { status: "pending", authUrl: null, codeInputReady: false },
      entry = { child, state };
    pending.set(id, entry);
    let buffer = "";
    const scan = (b) => {
      buffer = (buffer + b.toString()).slice(-20000);
      const plain = buffer
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
      if (plain.includes("Paste code here if prompted >"))
        state.codeInputReady = true;
      for (const raw of plain.match(/https:\/\/[^\s<>"'\x1b\x07]+/g) || []) {
        const url = officialLoginURL(raw, "claude-code");
        if (url) state.authUrl = url.href;
      }
    };
    child.stdout.on("data", scan);
    child.stderr.on("data", scan);
    child.stdin.on("error", () => {});
    entry.timer = setTimeout(() => {
      child.kill();
      state.status = "error";
      state.error = "로그인 시간이 만료되었습니다. 다시 시작하세요.";
      pending.delete(id);
    }, AUTH_POLICY.flowMs);
    child.on("error", () => {
      clearTimeout(entry.timer);
      state.status = "error";
      state.error = "Claude Code CLI를 실행할 수 없습니다.";
    });
    child.on("close", (code) => {
      clearTimeout(entry.timer);
      state.status = code === 0 ? "complete" : "error";
      if (code !== 0)
        state.error = "Claude 로그인을 완료하지 못했습니다. 다시 시작하세요.";
    });
    return state;
  }
  function code(id, value) {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_=.+/-]{1,1000}#[A-Za-z0-9_=.+/-]{1,1000}$/.test(value)
    )
      throw problem("공식 페이지에 표시된 인증 코드를 입력하세요.");
    const p = pending.get(id);
    if (!p || p.state.status !== "pending" || !p.state.codeInputReady)
      throw problem("진행 중인 로그인이 없습니다.");
    p.state.codeInputReady = false;
    p.child.stdin.write(value + "\n");
  }
  function cancel(id) {
    const p = pending.get(id);
    if (p) {
      clearTimeout(p.timer);
      p.child.kill();
      pending.delete(id);
    }
  }
  async function logout(id) {
    cancel(id);
    const r = await command(id, ["auth", "logout"]);
    if (r.code !== 0) throw problem("Claude 로그아웃에 실패했습니다.", 502);
  }
  return {
    ...adapter,
    account,
    login,
    code,
    cancel,
    logout,
    loginStatus: (id) => pending.get(id)?.state || null,
    close() {
      for (const id of pending.keys()) cancel(id);
    },
  };
}
