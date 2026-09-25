import hljs from "highlight.js/lib/common";
import { createPlanMarkdown } from "../shared/plan-markdown.mjs";
export const renderPlanMarkdown = createPlanMarkdown((code, language) => {
  const name = String(language || "")
    .trim()
    .split(/\s/)[0]
    .toLowerCase();
  if (!name || !hljs.getLanguage(name)) return undefined;
  return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
});
