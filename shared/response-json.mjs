// Decode transport wrappers only; never rewrite code, escapes or truncated JSON.
export function parseResponseJSON(value) {
  if (value && typeof value === "object") return value;
  let text = String(value).trim();
  if (/^```(?:json)?\s*[[{]/.test(text))
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch (error) {
    // CLI commentary may precede the final structured answer.
    const start = text.search(
      /\{\s*"(?:message|specProposal|proposal|files)"\s*:/,
    );
    if (start > 0) return JSON.parse(text.slice(start).replace(/\s*```$/, ""));
    throw error;
  }
}
