import { LIMITS } from "./config.mjs";
import { chatMessageText } from "./chat-proposal.mjs";
const words = (text) => [
  ...new Set(
    String(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}_]{2,}/gu) || [],
  ),
];
export function conversationContext(
  history,
  query,
  budget = LIMITS.chatContextChars,
) {
  const items = history.map((m) => ({
    id: m.id,
    role: m.role,
    content: chatMessageText(m),
  }));
  if (JSON.stringify(items).length <= budget)
    return {
      messages: items,
      summary: "",
      retrieved: [],
      total: items.length,
      compacted: false,
    };
  const recent = [],
    older = [...items];
  let used = 0;
  while (older.length && recent.length < 24) {
    const item = older.at(-1);
    if (used + item.content.length > budget * 0.55) break;
    recent.unshift(older.pop());
    used += item.content.length;
  }
  const terms = words(query);
  const ranked = older
    .map((m, i) => ({
      m,
      i,
      score: terms.reduce(
        (sum, term) =>
          sum + (m.content.toLowerCase().includes(term) ? term.length : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const retrieved = [];
  let retrievalSize = 0;
  for (const { m, score } of ranked) {
    if (!score || retrievalSize + m.content.length > budget * 0.3) continue;
    retrieved.push(m);
    retrievalSize += m.content.length;
    if (retrieved.length >= 16) break;
  }
  // Extractive overview, not an invented model memory. Full originals remain searchable.
  const perItem = Math.max(
    30,
    Math.min(500, Math.floor((budget * 0.12) / Math.max(1, older.length))),
  );
  const summary = older
    .map(
      (m) =>
        `${m.role} [${m.id || ""}]: ${m.content.slice(0, perItem)}${m.content.length > perItem ? "…" : ""}`,
    )
    .join("\n")
    .slice(0, budget * 0.15);
  return {
    messages: recent,
    summary,
    retrieved,
    total: items.length,
    compacted: true,
  };
}

// A question never starts a write workflow merely because the plan tab is open.
export function planChatIntent(text) {
  if (
    /하지\s*마|말고|설명|알려|궁금|어떻게|왜|무엇|뭐야|인가요|나요\s*[?？]?$|가능.*[?？]/i.test(
      text,
    )
  )
    return "discuss";
  return /(?:계획|구현|내용|항목|코드|검증|절차|DB|UI|요구사항).*(?:작성|생성|수정|변경|반영|추가|보강|삭제|제거|고쳐|만들|세워|세우|재작성)|(?:수정|반영|추가|변경|작성|생성|보강|고쳐|만들).*(?:해\s*줘|해주세요|부탁|하자)|^(?:다시\s*)?(?:작성|생성|수정|반영|고쳐|만들어|진행)(?:해|줘|해줘|해주세요|하자)/i.test(
    text,
  )
    ? "change"
    : "discuss";
}
