import { parseResponseJSON } from "./response-json.mjs";
import {
  partialResponseMessage,
  completedResponseFields,
  completedMarkdownBlocks,
} from "./response-blocks.mjs";
import { PLAN_RUBRIC } from "./plan-workflow.mjs";
export const responseLabels = {
  implementation: "구현 방법",
  before: "변경 전 코드",
  after: "변경 후 코드",
  ui: "화면과 사용자 흐름",
  mockup: "UI 목업 코드",
  database: "DB 변경",
  verification: "검증 계획",
  questions: "확인 질문",
  candidates: "후보별 검토",
  id: "후보",
  scores: "평가 점수",
  reasons: "평가 근거",
  blockingIssues: "해결이 필요한 문제",
  suggestions: "개선 제안",
  message: "응답",
  proposal: "제안",
  ...Object.fromEntries(PLAN_RUBRIC.criteria.map((c) => [c.id, c.label])),
};
export function responseContent(content) {
  if (typeof content !== "string") return content;
  try {
    return parseResponseJSON(content);
  } catch {
    return content;
  }
}
export function agentResponse(
  raw = "",
  { complete = true, partialMessage = false } = {},
) {
  // Providers may send commentary before the structured answer in the same stream.
  const envelope = raw.search(
    /\{\s*"(?:message|specProposal|proposal|files)"\s*:/,
  );
  if (envelope > 0) raw = raw.slice(envelope).replace(/\s*```$/, "");
  if (!complete && envelope < 0) {
    const opening = raw.search(/(?:^|\n)[ \t]*\{\s*(?:"[^"\n]*"?\s*:?)?$/);
    if (opening >= 0)
      return {
        message: completedMarkdownBlocks(raw.slice(0, opening)),
        files: [],
        pending: true,
      };
  }
  const structured =
    /^\s*\{/.test(raw) ||
    /^\s*\[(?=\s*(?:[[{"\d\]-]|true\b|false\b|null\b|$))/.test(raw) ||
    /^\s*```(?:json(?:\s|$)|\s*[{[])/.test(raw);
  if (/^\s*```(?:json)?\s*[{[]/.test(raw))
    raw = raw
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
  if (structured && !complete) {
    let data;
    try {
      data = parseResponseJSON(raw);
    } catch {
      data = completedResponseFields(raw);
    }
    return {
      ...agentResponse(JSON.stringify(data)),
      ...(partialMessage ? { message: partialResponseMessage(raw) } : {}),
      pending: true,
    };
  }
  try {
    const data = parseResponseJSON(raw);
    if (!data || typeof data !== "object")
      return { message: String(data ?? ""), files: [] };
    return {
      message: typeof data.message === "string" ? data.message : "",
      files: (Array.isArray(data.files) ? data.files : [])
        .filter((f) => f && typeof f === "object")
        .map((f) => {
          const content = responseContent(f.content);
          return {
            path: f.path,
            content,
            incomplete:
              typeof f.content === "string" &&
              /^\s*[{[]/.test(f.content) &&
              content === f.content,
          };
        }),
      extra: Object.fromEntries(
        Object.entries(data).filter(
          ([k, v]) => !["message", "files"].includes(k) && v != null,
        ),
      ),
    };
  } catch {
    return structured
      ? { message: "", files: [], incomplete: true }
      : {
          message: completedMarkdownBlocks(raw),
          files: [],
          pending: !complete && completedMarkdownBlocks(raw) !== raw,
          incomplete: complete && completedMarkdownBlocks(raw) !== raw,
        };
  }
}
export function codeMarkdown(text, language = "") {
  const fence = "`".repeat(
    Math.max(3, ...(String(text).match(/`+/g) || []).map((s) => s.length + 1)),
  );
  return `${fence}${language}\n${text}\n${fence}`;
}
