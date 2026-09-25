const claudeHosts = new Set([
  "claude.com",
  "claude.ai",
  "console.anthropic.com",
  "platform.claude.com",
  "auth.claude.com",
]);
const openaiHosts = new Set(["chatgpt.com", "auth.openai.com"]);
export function officialLoginURL(value, provider) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    if (provider === "claude-code")
      return claudeHosts.has(url.hostname) &&
        /oauth|authorize/.test(url.pathname)
        ? url
        : null;
    return claudeHosts.has(url.hostname) || openaiHosts.has(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}
