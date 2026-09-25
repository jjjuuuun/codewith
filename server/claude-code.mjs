import { runClaudeProject } from "./claude-project.mjs";
import { runtimeConfig as runtime } from "./runtime-config.mjs";
import { aiError } from "./ai-errors.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { problem, outputSchema } from "../shared/schema.mjs";
export const claudeCodeModels = () =>
  ["sonnet", "opus", "haiku"].map((model) => ({
    id: model,
    model,
    displayName: `Claude ${model[0].toUpperCase() + model.slice(1)} · CLI 별칭`,
    supportedReasoningEfforts: ["low", "medium", "high"].map(
      (reasoningEffort) => ({ reasoningEffort }),
    ),
    defaultReasoningEffort: "auto",
    serviceTiers: [],
    capabilitiesKnown: false,
  }));
export function claudeEnvironment(configDir, token) {
  const env = {};
  for (const k of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP"])
    if (process.env[k]) env[k] = process.env[k];
  return {
    ...env,
    CLAUDE_CONFIG_DIR: configDir,
    ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
export function createClaudeCode({
  dataDir,
  binary = process.env.CODEWITH_CLAUDE_BIN || "claude",
  spawnProcess = spawn,
}) {
  async function check() {
    return new Promise((resolve, reject) => {
      const child = spawnProcess(binary, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      let version = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(problem("Claude Code 확인 시간이 초과되었습니다.", 503));
      }, runtime.cliProbeTimeoutMs);
      child.stdout.on("data", (d) => (version += d));
      child.on("error", () => {
        clearTimeout(timer);
        reject(
          problem(
            "개인 PC에 Claude Code CLI를 설치하거나 CODEWITH_CLAUDE_BIN을 설정하세요.",
            503,
          ),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve({ version: version.trim() })
          : reject(problem("Claude Code CLI를 실행할 수 없습니다.", 503));
      });
    });
  }
  async function run({
    responseSchema = outputSchema,
    projectTools = false,
    cwd,
    approve,
    session,
    userId,
    webSearch = "off",
    images = [],
    key: token,
    prompt,
    model,
    effort,
    onEvent,
    signal,
  }) {
    const configDir = path.join(dataDir, "claude", userId);
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    if (projectTools)
      return runClaudeProject({
        prompt,
        webSearch,
        images,
        model,
        effort,
        cwd,
        env: claudeEnvironment(configDir, token),
        binary,
        session,
        signal,
        onEvent,
        approve,
      });
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(!responseSchema ? ["--include-partial-messages"] : []),
      ...(images.length ? ["--input-format", "stream-json"] : []),
      ...(!session
        ? ["--no-session-persistence"]
        : session.sessionId
          ? ["--resume", session.sessionId]
          : []),
      "--tools",
      webSearch === "auto" ? "WebSearch,WebFetch" : "",
      ...(webSearch === "auto" ? ["--allowedTools", "WebSearch,WebFetch"] : []),
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--setting-sources",
      "",
      "--settings",
      '{"disableAllHooks":true}',
      "--disable-slash-commands",
      "--permission-mode",
      "plan",
      ...(responseSchema
        ? ["--json-schema", JSON.stringify(responseSchema)]
        : []),
      "--model",
      model,
    ];
    if (effort && effort !== "auto") args.push("--effort", effort);
    return new Promise((resolve, reject) => {
      let result,
        bytes = 0,
        settled = false;
      const child = spawnProcess(binary, args, {
        cwd: configDir,
        env: claudeEnvironment(configDir, token),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      const stop = () => {
        if (process.platform === "win32") child.kill();
        else
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill();
          }
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value);
      };
      const interrupt = (error) => {
        stop();
        finish(error);
      };
      const abort = () =>
        interrupt(
          signal?.reason instanceof Error
            ? signal.reason
            : aiError("interrupted", "실행 중단 신호를 받았습니다."),
        );
      const timer = setTimeout(
        () =>
          interrupt(
            aiError(
              "request_timeout",
              `Claude Code 요청당 실행 제한 시간 ${runtime.aiRequestTimeoutMs / 1000}초에 도달했습니다.`,
              {
                timeoutSeconds: runtime.aiRequestTimeoutMs / 1000,
                source: "codewith",
              },
              408,
            ),
          ),
        runtime.aiRequestTimeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      child.on("error", () =>
        finish(problem("Claude Code CLI 실행에 실패했습니다.", 503)),
      );
      child.stderr.on("data", () => {});
      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        bytes += line.length;
        if (bytes > runtime.claudeOutputMaxChars) {
          interrupt(
            aiError(
              "response_size_limit",
              `Claude Code 출력 수신 한도 ${runtime.claudeOutputMaxChars.toLocaleString()}자에 도달했습니다.`,
              { limit: runtime.claudeOutputMaxChars, source: "codewith" },
            ),
          );
          return;
        }
        try {
          const e = JSON.parse(line);
          if (
            !responseSchema &&
            e.type === "stream_event" &&
            e.event?.delta?.type === "text_delta"
          )
            onEvent({ type: "delta", text: e.event.delta.text });
          if (e.type === "assistant")
            for (const c of e.message?.content || []) {
              if (c.type === "text" && responseSchema)
                onEvent({ type: "delta", text: c.text });
              if (
                c.type === "tool_use" &&
                ["WebSearch", "WebFetch"].includes(c.name)
              )
                onEvent({
                  type: "status",
                  message:
                    c.name === "WebSearch"
                      ? "웹을 검색하고 있습니다…"
                      : "외부 문서를 읽고 있습니다…",
                });
            }
          if (e.type === "result") {
            result = e;
            if (e.usage) onEvent({ type: "usage", usage: e.usage });
          }
        } catch {}
      });
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0 || !result || result.is_error) {
          const detail = token
            ? (result?.errors || []).join(" ").split(token).join("[인증 정보]")
            : (result?.errors || []).join(" ");
          finish(
            problem(
              detail ||
                "Claude Code 응답에 실패했습니다. 구독 인증·이용 가능 여부를 확인하세요.",
              502,
            ),
          );
        } else if (responseSchema && !result.structured_output)
          finish(
            aiError(
              "validation",
              "Claude Code가 구조화된 응답을 반환하지 않았습니다.",
            ),
          );
        else {
          if (session) {
            if (!result.session_id)
              return finish(
                problem(
                  "Claude Code 세션 ID가 없어 계획을 이어갈 수 없습니다.",
                  502,
                ),
              );
            session.sessionId = result.session_id;
          }
          onEvent({ type: "usage", usage: result.usage });
          finish(null, {
            text: responseSchema
              ? JSON.stringify(result.structured_output)
              : result.result || "",
          });
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(
        images.length
          ? JSON.stringify({
              type: "user",
              message: {
                role: "user",
                content: [
                  ...images.map((a) => ({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: a.mime,
                      data: a.data,
                    },
                  })),
                  { type: "text", text: prompt },
                ],
              },
            }) + "\n"
          : prompt,
      );
    });
  }
  return { check, models: claudeCodeModels, run };
}
