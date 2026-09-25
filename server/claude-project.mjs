import { query } from "@anthropic-ai/claude-agent-sdk";
import { runtimeConfig as runtime } from "./runtime-config.mjs";
import { aiError } from "./ai-errors.mjs";

export async function runClaudeProject({
  prompt,
  webSearch = "off",
  images = [],
  model,
  effort,
  cwd,
  env,
  binary,
  session,
  signal,
  onEvent,
  approve,
  queryAgent = query,
}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(
    () =>
      controller.abort(
        aiError("request_timeout", "Claude Code 요청 시간이 초과되었습니다.", {
          timeoutSeconds: runtime.aiRequestTimeoutMs / 1000,
        }),
      ),
    runtime.aiRequestTimeoutMs,
  );
  let result;
  async function* input() {
    yield {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mime,
              data: image.data,
            },
          })),
          { type: "text", text: prompt },
        ],
      },
    };
  }
  try {
    for await (const event of queryAgent({
      prompt: images.length ? input() : prompt,
      options: {
        cwd,
        env,
        model,
        pathToClaudeCodeExecutable: binary,
        abortController: controller,
        permissionMode: "default",
        disallowedTools: webSearch === "auto" ? [] : ["WebSearch", "WebFetch"],
        settingSources: ["project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        ...(effort && effort !== "auto" ? { effort } : {}),
        ...(session?.sessionId ? { resume: session.sessionId } : {}),
        persistSession: !!session,
        canUseTool: async (tool, input) => {
          const decision = await approve({ tool, input, cwd });
          return decision
            ? {
                behavior: "allow",
                updatedInput: decision.answers
                  ? { ...input, answers: decision.answers }
                  : input,
              }
            : {
                behavior: "deny",
                message: "사용자가 이 작업을 승인하지 않았습니다.",
              };
        },
      },
    })) {
      if (
        event.type === "stream_event" &&
        event.event?.delta?.type === "text_delta"
      )
        onEvent({ type: "delta", text: event.event.delta.text });
      if (event.type === "assistant")
        for (const block of event.message?.content || [])
          if (block.type === "tool_use")
            onEvent({ type: "status", message: `${block.name} 실행 중…` });
      if (event.type === "result") result = event;
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!result || result.is_error)
      throw aiError(
        "provider_error",
        (result?.errors || []).join(" ") ||
          "Claude Code 응답을 완료하지 못했습니다.",
      );
    if (session && result.session_id) session.sessionId = result.session_id;
    if (result.usage) onEvent({ type: "usage", usage: result.usage });
    return { text: result.result || "" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
