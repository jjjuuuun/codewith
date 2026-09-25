import { renderMarkdown } from "./markdown.js";
import { escapeHTML as esc } from "./format.js";
export function resourceHTML(a) {
  if (a.type === "image")
    return `<img src="${esc(a.data)}" alt="${esc(a.title)}" class="resource-image">`;
  if (a.type === "table")
    return `<div class="resource-table"><table><thead><tr>${a.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${a.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  if (a.type === "chart") {
    const max = Math.max(1, ...a.values.map((x) => x.value));
    return `<div class="bar-chart">${a.values.map((x) => `<div class="bar-row"><span>${esc(x.label)}</span><div><i style="width:${Math.max(0, (x.value / max) * 100)}%"></i></div><b>${x.value}</b></div>`).join("")}</div>`;
  }
  if (a.type === "flow")
    return `<div class="flow">${a.steps.map((x, i) => `${i ? '<span class="flow-arrow">↓</span>' : ""}<div>${esc(x)}</div>`).join("")}</div>`;
  return `<div class="markdown">${renderMarkdown(a.text)}</div>`;
}
