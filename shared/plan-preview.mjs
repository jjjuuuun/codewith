import { PLAN_DOCUMENT_STYLE } from "./plan-document-style.mjs";
// Display-only theme layer: stored/downloaded plan versions are never rewritten.
export function themedPlanPreview(html, theme) {
  if (!["light", "dark"].includes(theme)) return html;
  const css =
    theme === "light"
      ? ":root{color-scheme:light}"
      : `:root{color-scheme:dark;--syntax-keyword:#d2a8ff;--syntax-string:#a5d6a7;--syntax-number:#ffc078;--syntax-name:#91caff;--syntax-comment:#a5a9b6;--syntax-delete:#ff9c9c}html body,html main{background:#171721;color:#e7e7f2}html .plan-card{background:#21212f;border-color:#35344b}html .tab-state+label{background:#222131;color:#d7d7e5;border-color:#43425b}html .tab-state:checked+label{background:#b7b5f1;color:#22213b}html .plan-card>h2>span{background:#27263c;color:#b9b8d2}html .requirement-id,html .code-comparison h3,html .code-block header{color:#a1a0b8}html .code-comparison>div{border-color:#43425b}html .after{background:#212033}html pre{background:#11111b;color:#d7d7e5}html td,html th{border-color:#43425b}html blockquote{background:#222134;border-color:#6a698c}html .ui-mockup{border-color:#43425b}html body>aside{background:#21212f;color:#bab9d0!important}`;
  return (
    html +
    '<style data-codewith-preview-theme="' +
    theme +
    '">' +
    css +
    PLAN_DOCUMENT_STYLE +
    "</style>"
  );
}
