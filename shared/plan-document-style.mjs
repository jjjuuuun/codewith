// Shared by generated documents and the editor, including existing saved plans.
export const PLAN_DOCUMENT_STYLE = `
.plan-card table{display:table;width:100%;border-collapse:separate;border-spacing:0;font-size:14px;line-height:1.75;overflow:visible}
.plan-table{max-width:100%;overflow-x:auto;margin:16px 0;border:1px solid #8885;border-radius:10px}
.plan-card th,.plan-card td{padding:14px 16px;border:0;border-bottom:1px solid #8884;vertical-align:top;text-align:left;overflow-wrap:anywhere;min-width:110px}
.plan-card th{font-weight:700;background:color-mix(in srgb,currentColor 8%,transparent)}
.plan-card tbody tr:nth-child(even){background:color-mix(in srgb,currentColor 3%,transparent)}
.plan-card tr:last-child td{border-bottom:0}
.plan-card td p{margin:0}
.plan-card li{margin:10px 0;line-height:1.85}
.plan-card li.plan-task{list-style:none}
.plan-card .plan-check{display:grid;grid-template-columns:18px minmax(0,1fr);align-items:start;column-gap:12px;padding:8px 0;line-height:1.8;cursor:pointer}
.plan-card input[type=checkbox]{width:18px;height:18px;font:inherit;flex-shrink:0;margin:0 12px 0 0;vertical-align:middle;accent-color:#7773c7;cursor:pointer}
.plan-card .plan-check>input[type=checkbox]{margin:calc((1.8em - 18px)/2) 0 0}
.plan-card .plan-check>span{min-width:0;overflow-wrap:anywhere}
.plan-card input[type=checkbox]:checked+span{color:inherit}
[data-plan-review-notes]{margin:24px;padding:20px;border:1px solid #8885;border-radius:12px;line-height:1.8}
[data-plan-review-notes] article+article{margin-top:20px;border-top:1px solid #8885;padding-top:16px}
[data-plan-review-notes] p{white-space:pre-wrap;overflow-wrap:anywhere}
`;
