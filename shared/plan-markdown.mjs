import MarkdownIt from "markdown-it";

// Plan documents need tables and reviewable task lists; raw HTML remains text.
export function createPlanMarkdown(highlight) {
  const md = new MarkdownIt({ html: false, breaks: true });
  md.core.ruler.after("inline", "plan-checklist", (state) => {
    state.tokens.forEach((token, index) => {
      if (
        token.type !== "inline" ||
        state.tokens[index - 2]?.type !== "list_item_open"
      )
        return;
      const first = token.children?.[0];
      const match =
        first?.type === "text" && first.content.match(/^\[([ xX])\]\s+/);
      if (!match) return;
      first.content = first.content.slice(match[0].length);
      state.tokens[index - 2].attrJoin("class", "plan-task");
      const open = new state.Token("html_inline", "", 0);
      open.content = `<label class="plan-check"><input type="checkbox" data-plan-check disabled${match[1].toLowerCase() === "x" ? " checked" : ""}><span>`;
      const close = new state.Token("html_inline", "", 0);
      close.content = "</span></label>";
      token.children.unshift(open);
      token.children.push(close);
    });
  });
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0];
    return `<div class="code-block"><header><span>${md.utils.escapeHtml(language || "코드")}</span></header><pre><code>${highlight?.(token.content.replace(/\n$/, ""), language) ?? md.utils.escapeHtml(token.content.replace(/\n$/, ""))}</code></pre></div>`;
  };
  md.renderer.rules.table_open = () => '<div class="plan-table"><table>';
  md.renderer.rules.table_close = () => "</table></div>";
  return (text) => md.render(String(text || ""));
}
