export function selectInstructions(
  projectSpec,
  { role, message = "", selectedFiles = [], specTitle = "" } = {},
) {
  const all = (projectSpec.skills || []).map((x) => ({ ...x, kind: "skill" }));
  const ids = [
    ...message.matchAll(/(?:^|\s)[/$]([a-zA-Z0-9_-]+)(?=\s|$|[.,!?])/g),
  ].map((m) => m[1]);
  for (const id of ids) {
    const item = all.find((x) => x.id === id);
    if (!item) throw new Error(`/${id} 스킬을 찾을 수 없습니다.`);
    if (!item.enabled) throw new Error(`/${id}은 비활성화되어 있습니다.`);
  }
  const haystack = [message, specTitle, ...selectedFiles]
    .join(" ")
    .toLowerCase();
  return all
    .filter((x) => x.enabled)
    .flatMap((x) => {
      const reason = ids.includes(x.id)
        ? "직접 지정"
        : x.trigger === "always"
          ? "항상 적용"
          : x.trigger === "auto" &&
              x.keywords.some((k) => haystack.includes(k.toLowerCase()))
            ? "조건 일치"
            : null;
      return reason ? [{ ...x, reason }] : [];
    });
}
