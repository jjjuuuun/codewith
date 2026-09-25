const fields = ["id", "name", "description", "trigger", "keywords", "enabled"];

// Our exported frontmatter uses JSON values, a strict YAML subset. Other
// Markdown (including arbitrary YAML frontmatter) is preserved as plain text.
export function parseSkillMarkdown(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { content: text };
  try {
    const metadata = {};
    for (const line of match[1].split(/\r?\n/)) {
      const index = line.indexOf(":");
      const key = line.slice(0, index);
      if (!fields.includes(key)) return { content: text };
      metadata[key] = JSON.parse(line.slice(index + 1));
    }
    if (!fields.every((key) => key in metadata)) return { content: text };
    if (
      !["id", "name", "description", "trigger"].every(
        (key) => typeof metadata[key] === "string",
      ) ||
      !Array.isArray(metadata.keywords) ||
      !metadata.keywords.every((key) => typeof key === "string") ||
      typeof metadata.enabled !== "boolean"
    )
      return { content: text };
    return {
      ...metadata,
      content: text.slice(match[0].length).replace(/\n$/, ""),
    };
  } catch {
    return { content: text };
  }
}

export function formatSkillMarkdown(skill) {
  return (
    "---\n" +
    fields.map((key) => `${key}: ${JSON.stringify(skill[key])}`).join("\n") +
    "\n---\n" +
    skill.content +
    "\n"
  );
}
