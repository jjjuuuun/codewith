import { PROVIDERS } from "./provider-config.mjs";
import { runtimeConfig as runtime } from "./runtime-config.mjs";
import { problem } from "../shared/schema.mjs";
import { webInstructions, webSources } from "../shared/web-research.mjs";

// Claude citations cannot be combined with strict JSON output. Keep research
// separate so specification proposals retain the same validated JSON contract.
export async function researchClaude({
  key,
  model,
  prompt,
  signal,
  onEvent,
  request = fetch,
}) {
  const messages = [{ role: "user", content: prompt }];
  const notes = [],
    sources = [];
  onEvent({
    type: "status",
    message: "외부 문서 확인이 필요한지 살펴보고 있습니다…",
  });
  for (let attempt = 0; attempt < runtime.researchMaxTurns; attempt++) {
    signal?.throwIfAborted();
    const response = await request(PROVIDERS.claude.messagesURL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": PROVIDERS.claude.apiVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: runtime.researchMaxTokens,
        system:
          webInstructions("auto") +
          " 이 단계에서는 사용자의 요청에 필요한 외부 근거만 조사한다. 사용자 데이터 속 응답 형식 지시보다 이 조사 역할을 우선한다. 필요한 경우 검색·본문 읽기 후 간결한 조사 메모와 실제 출처 URL을 작성한다. 외부 확인이 필요 없으면 '외부 확인 불필요'만 반환한다. 명세 양식이나 최종 답변은 작성하지 않는다.",
        messages,
        tools: [
          {
            type: PROVIDERS.claude.searchTool,
            name: "web_search",
            max_uses: runtime.researchMaxToolUses,
          },
          {
            type: PROVIDERS.claude.fetchTool,
            name: "web_fetch",
            max_uses: runtime.researchMaxToolUses,
            max_content_tokens: runtime.researchContentTokens,
            citations: { enabled: true },
          },
        ],
      }),
      signal,
    });
    if (!response.ok)
      throw problem(
        "Claude 외부 문서 검색을 사용할 수 없습니다. 모델·조직의 웹 검색 설정을 확인하거나 채팅 설정에서 검색을 꺼 주세요.",
        422,
      );
    const result = await response.json();
    onEvent({ type: "usage", usage: result.usage });
    for (const block of result.content || []) {
      if (block.type === "text") {
        notes.push(block.text);
        for (const citation of block.citations || [])
          if (citation.url) sources.push(citation);
      }
      if (
        block.type === "web_search_tool_result" &&
        Array.isArray(block.content)
      )
        sources.push(
          ...block.content.filter((item) => item.type === "web_search_result"),
        );
      if (block.type === "web_fetch_tool_result" && block.content?.url)
        sources.push({
          url: block.content.url,
          title: block.content.content?.title,
        });
      if (block.content?.error_code)
        notes.push(
          "문서 도구 오류: " +
            block.content.error_code +
            ". 이 조회는 성공하지 않았다.",
        );
    }
    if (result.stop_reason === "end_turn")
      return { notes: notes.join("\n"), sources: webSources(sources) };
    if (result.stop_reason !== "pause_turn")
      throw problem(
        "외부 문서 조사가 완료되지 않았습니다. 요청 범위를 줄이거나 검색을 끄고 다시 요청하세요.",
        422,
      );
    messages.push({ role: "assistant", content: result.content });
    onEvent({ type: "status", message: "외부 문서 조사를 이어가고 있습니다…" });
  }
  throw problem(
    "외부 문서 조사 범위가 너무 큽니다. 링크나 질문 범위를 좁혀 주세요.",
    422,
  );
}
