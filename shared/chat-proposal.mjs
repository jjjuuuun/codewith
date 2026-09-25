// Only explicit creation commands trigger a single format-repair attempt.
export function requestedProposal(message, scoped) {
  const text = message.trim();
  if (
    /추가하지|만들지|작성하지|하지\s*마|말고|안\s*해|어떻게|방법|왜|안\s*되|안됐|안된/.test(
      text,
    )
  )
    return null;
  if (
    !/(명세|요구\s*사항)/.test(text) ||
    !/(추가|작성|생성|만들|등록).{0,12}(해|줘|주|부탁|하자|해주세요)|(?:추가|작성|생성|등록)[.!\s]*$/.test(
      text,
    )
  )
    return null;
  return /명세/.test(text) || !scoped ? "specProposal" : "proposal";
}

export function chatMessageText(message) {
  const spec = message?.specProposal;
  const requirements =
    spec?.requirements || (message?.proposal ? [message.proposal] : null);
  if (!requirements) return message?.text || "";
  return [
    ...(spec ? [`# ${spec.title}`] : []),
    ...requirements.map(
      (r) =>
        `## ${r.title}\n\n${r.body}\n\n### 완료 기준\n${r.criteria.map((c) => `- ${c}`).join("\n")}`,
    ),
  ].join("\n\n");
}
