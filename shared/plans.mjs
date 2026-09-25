import { PLAN_DOCUMENT_STYLE } from "./plan-document-style.mjs";
import { LIMITS, PLAN_POLICY } from "./config.mjs";
import { parseResponseJSON } from "./response-json.mjs";
import {
  validatePlanEvaluation,
  validatePlanExecution,
} from "./plan-workflow.mjs";
// Shared plan contract: HTML is data, never executable application code.
export const PLAN_SKILL_ID = "codewith-html-plan";
export const defaultPlanSkill = { id: PLAN_SKILL_ID };
export const defaultPlanUISkill = { id: "codewith-plan-ui" };
const safetyPrefix = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src about:; base-uri 'none'; form-action 'none'">`;
export function securePlanHTML(html) {
  validatePlanHTML(html);
  return html.startsWith(safetyPrefix)
    ? html
    : safetyPrefix + html.replace(/^\s*<!doctype[^>]*>/i, "");
}
export function validatePlanHTML(html) {
  if (
    typeof html !== "string" ||
    html.trim().length < 30 ||
    !/<[a-z][^>]*>/i.test(html)
  )
    throw Object.assign(
      new Error("계획서는 HTML 태그를 포함한 30자 이상의 문서여야 합니다."),
      { status: 400 },
    );
  if (html.length > LIMITS.planHtmlChars)
    throw Object.assign(
      new Error(
        `화면 표시용 계획 HTML이 ${html.length.toLocaleString("en-US")}자로 저장 한도 ${LIMITS.planHtmlChars.toLocaleString("en-US")}자를 초과했습니다. 수신한 원문 크기와 HTML 변환 후 크기는 다를 수 있습니다.`,
      ),
      { status: 413, code: "plan_document_size" },
    );
  return html;
}
export function validatePlans(spec) {
  spec.plans ??= { versions: [], finalVersionId: null };
  const p = spec.plans,
    fail = () => {
      throw Object.assign(new Error("계획 버전 데이터가 올바르지 않습니다."), {
        status: 400,
      });
    };
  if (
    !p ||
    !Array.isArray(p.versions) ||
    p.versions.filter((v) => !v?.deletedAt).length > PLAN_POLICY.versionsMax ||
    p.versions.length > 500
  )
    fail();
  const ids = new Set();
  for (const v of p.versions) {
    if (!v || !/^plan_[a-z0-9]{24}$/.test(v.id) || ids.has(v.id)) fail();
    ids.add(v.id);
    if (
      v.deletedAt !== undefined &&
      (!Number.isFinite(Date.parse(v.deletedAt)) ||
        typeof v.deletedBy?.id !== "string" ||
        typeof v.deletedBy?.name !== "string")
    )
      fail();
    if (v.codeSource) {
      const c = v.codeSource;
      if (
        !/^[a-f0-9]{64}$/.test(c.digest) ||
        !Number.isFinite(Date.parse(c.scannedAt)) ||
        !["server", "browser", "upload"].includes(c.kind) ||
        !c.manifest ||
        typeof c.manifest !== "object" ||
        Array.isArray(c.manifest) ||
        Object.keys(c.manifest).length > 500 ||
        Object.entries(c.manifest).some(
          ([p, h]) =>
            p.length > 500 ||
            !p ||
            p.startsWith("/") ||
            p.split("/").includes("..") ||
            !/^[a-f0-9]{64}$/.test(h),
        ) ||
        !Number.isInteger(c.totalFiles) ||
        c.totalFiles < 0 ||
        !Number.isInteger(c.omittedCount) ||
        c.omittedCount < 0
      )
        fail();
    }
    if (
      v.stepApprovals !== undefined &&
      (!v.stepApprovals ||
        typeof v.stepApprovals !== "object" ||
        Array.isArray(v.stepApprovals) ||
        Object.entries(v.stepApprovals).some(
          ([key, item]) =>
            !/^step-\d{1,4}$/.test(key) ||
            typeof item?.by?.id !== "string" ||
            typeof item?.by?.name !== "string" ||
            !Number.isFinite(Date.parse(item?.at)),
        ))
    )
      fail();
    if (v.evaluation != null)
      v.evaluation = validatePlanEvaluation(v.evaluation);
    if (v.execution != null) v.execution = validatePlanExecution(v.execution);
    v.html = securePlanHTML(v.html);
    if (
      typeof v.title !== "string" ||
      !v.title.trim() ||
      v.title.length > 160 ||
      !/^([a-f0-9]{64})$/.test(v.basis) ||
      typeof v.baseHead !== "string" ||
      !Number.isInteger(v.specVersion) ||
      v.specVersion < 1 ||
      !Number.isFinite(Date.parse(v.createdAt)) ||
      !v.author ||
      typeof v.author.id !== "string" ||
      typeof v.author.name !== "string" ||
      !["ai", "manual"].includes(v.source)
    )
      fail();
    if (v.parentId !== null && !ids.has(v.parentId)) fail();
  }
  if (
    p.finalVersionId !== null &&
    (!ids.has(p.finalVersionId) ||
      p.versions.find((v) => v.id === p.finalVersionId)?.deletedAt)
  )
    fail();
  if (
    p.approvals !== undefined &&
    (!Array.isArray(p.approvals) ||
      p.approvals.length > PLAN_POLICY.approvalsMax ||
      p.approvals.some(
        (a) =>
          !a ||
          (a.versionId !== null && !ids.has(a.versionId)) ||
          !Number.isFinite(Date.parse(a.at)) ||
          typeof a.by?.id !== "string" ||
          typeof a.by?.name !== "string",
      ))
  )
    fail();
  return p;
}
export function planBasisData(document, spec) {
  return {
    project: document.project,
    projectSpec: document.projectSpec,
    title: spec.title,
    ...(spec.evaluationPolicy
      ? { evaluationPolicy: spec.evaluationPolicy }
      : {}),
    requirements: spec.requirements.map(
      ({ id, title, body, criteria, resources, evaluationPolicy }) => ({
        id,
        title,
        body,
        criteria,
        resources,
        ...(evaluationPolicy ? { evaluationPolicy } : {}),
      }),
    ),
    questions: spec.questions,
    files: document.files,
  };
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const planRequirementLabel = (id, title) => `${id} (${title})`;
export const PLAN_FIELDS = [
  "implementation",
  "before",
  "after",
  "ui",
  "mockup",
  "database",
  "verification",
];
export function renderPlanHTML(
  spec,
  files,
  render = (text) => "<p>" + escape(text).replace(/\n/g, "<br>") + "</p>",
) {
  const expected = spec.requirements.map((r) => r.id + ".html");
  if (
    !Array.isArray(files) ||
    files.length !== expected.length ||
    new Set(files.map((f) => f?.path)).size !== expected.length ||
    files.some((f) => !expected.includes(f?.path))
  )
    throw Object.assign(
      new Error(
        "AI 계획서에 요구사항별 본문이 누락되었습니다. 다시 요청하세요.",
      ),
      { status: 422 },
    );
  let sourceChars = 0;
  const sections = spec.requirements
    .map((r, i) => {
      let data;
      try {
        data = parseResponseJSON(
          files.find((f) => f.path === r.id + ".html").content,
        );
      } catch {
        throw Object.assign(
          new Error(
            `계획서 본문의 JSON 문법이 올바르지 않습니다 (${r.id}.html). 코드의 따옴표·역슬래시·줄바꿈 표현을 확인해 다시 작성해야 합니다.`,
          ),
          { status: 422 },
        );
      }
      const invalidSections = PLAN_FIELDS.filter(
        (k) =>
          !data ||
          typeof data[k] !== "string" ||
          data[k].length > LIMITS.planSectionChars ||
          (k !== "mockup" && !data[k].trim()),
      );
      if (invalidSections.length)
        throw Object.assign(
          new Error(
            `계획서의 필수 섹션이 누락되었거나 형식이 올바르지 않습니다 (${r.id}.html). 확인할 항목: ${invalidSections.join(", ")}.`,
          ),
          { status: 422 },
        );
      sourceChars += PLAN_FIELDS.reduce(
        (total, key) => total + data[key].length,
        0,
      );
      if (sourceChars > LIMITS.planSourceChars)
        throw Object.assign(
          new Error(
            `계획 원문이 ${sourceChars.toLocaleString("en-US")}자로 전체 원문 한도 ${LIMITS.planSourceChars.toLocaleString("en-US")}자를 초과했습니다. 중복 설명을 줄여 주세요.`,
          ),
          { status: 422 },
        );
      for (const key of ["before", "after", "database", "verification"]) {
        for (const match of data[key].matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
          if (
            /^\s*(?:(?:\/\/|#|--|\/\*|<!--)\s*)?(?:\.\.\.|…|(?:나머지|중간|이하|코드)\s*(?:코드\s*)?생략|omitted for brevity)(?:\s*(?:\*\/|-->))?\s*$/im.test(
              match[1],
            )
          )
            throw Object.assign(
              new Error(
                `계획 코드에 생략 표시가 있습니다 (${r.id}.html · ${key}). 전체 적용 코드를 작성한 뒤 다시 시도하세요.`,
              ),
              { status: 422 },
            );
        }
      }
      const block = (number, title, body) =>
        `<section class="plan-card"><h2><span>${number}</span>${title}</h2>${body}</section>`;
      return `<input class="tab-state" type="radio" name="requirement" id="req-${i}" ${i === 0 ? "checked" : ""}><label role="tab" for="req-${i}">${escape(planRequirementLabel(r.id, r.title))}</label><article class="plan-section"><header class="plan-title"><p class="requirement-id">${escape(r.id)}</p><h1>${escape(r.title)}</h1></header>${block("01", "구현 방법", render(data.implementation))}${block("02", "BEFORE / AFTER", `<div class="code-comparison"><div class="before"><h3>BEFORE</h3>${render(data.before)}</div><div class="after"><h3>AFTER</h3>${render(data.after)}</div></div>`)}${block("03", "UI 목업", render(data.ui) + (data.mockup.trim() ? `<iframe class="ui-mockup" sandbox="" title="${escape(r.id)} UI 목업" srcdoc="${escape(securePlanHTML(data.mockup))}"></iframe>` : ""))}${block("04", "DB 변경", render(data.database))}${block("05", "검증", render(data.verification))}</article>`;
    })
    .join("");
  return validatePlanHTML(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(spec.title)} · 계획</title><style>*{box-sizing:border-box}body{margin:0;color:#303044;background:#fafafb;font:14px/1.8 system-ui,sans-serif}main{display:flex;flex-wrap:wrap;gap:8px;padding:24px;max-width:1280px;margin:auto}.tab-state{position:absolute;opacity:0;width:1px;height:1px}.tab-state+label{order:0;cursor:pointer;border:1px solid #dadae5;padding:9px 14px;border-radius:10px;background:white;font-size:13px}.tab-state:checked+label{background:#33325c;color:white}.tab-state:focus-visible+label{outline:3px solid #8d8bbc}.plan-section{order:1;display:none;width:100%;min-width:0}.tab-state:checked+label+.plan-section{display:block}.plan-title{padding:24px 4px 10px}.plan-title h1{font-size:26px;line-height:1.4;margin:8px 0 18px}.requirement-id{color:#6d6c81;font:12px ui-monospace,monospace;margin:0}.plan-card{background:white;border:1px solid #dadae5;border-radius:14px;padding:24px;margin-bottom:16px;overflow-wrap:anywhere}.plan-card>h2{font-size:18px;display:flex;align-items:center;gap:10px;margin:0 0 20px}.plan-card>h2>span{font-size:11px;background:#ececf3;border-radius:8px;padding:4px 8px;color:#555473}.plan-card h3{font-size:15px}.code-comparison{display:grid;grid-template-columns:1fr 1fr;gap:14px}.code-comparison>div{border:1px solid #dadae5;border-radius:10px;padding:16px;min-width:0}.code-comparison h3{font-size:11px;letter-spacing:1px;color:#636275}.after{background:#f6f6f9}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#ececf3;padding:16px;border-radius:10px;overflow:auto}code{font-family:ui-monospace,monospace;font-size:12px}.code-block header{font-size:11px;color:#6d6c81}.code-block button{display:none}.hljs-keyword,.hljs-selector-tag,.hljs-literal{color:var(--syntax-keyword,#7c3aad)}.hljs-string,.hljs-regexp,.hljs-addition{color:var(--syntax-string,#166534)}.hljs-number,.hljs-attr,.hljs-type{color:var(--syntax-number,#9a4d00)}.hljs-title,.hljs-built_in,.hljs-name{color:var(--syntax-name,#1554a0)}.hljs-comment,.hljs-quote{color:var(--syntax-comment,#687077)}.hljs-deletion{color:var(--syntax-delete,#b42318)}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}td,th{border:1px solid #dadae5;padding:9px;text-align:left}img{max-width:100%}blockquote{border-left:3px solid #9190ae;margin:16px 0;padding:10px 18px;background:#f2f2f6}.ui-mockup{display:block;width:100%;height:380px;border:1px solid #dadae5;border-radius:10px;margin-top:16px;background:#fff}@media(max-width:720px){main{padding:12px}.plan-card{padding:18px}.code-comparison{grid-template-columns:1fr}}${PLAN_DOCUMENT_STYLE}</style></head><body><main data-codewith-plan-ui="1">${sections}</main></body></html>`,
  );
}

// Manual edits clear scores, but the next AI revision still needs earlier findings.
export function priorPlanEvaluation(spec, version) {
  const visited = new Set();
  while (version && !visited.has(version.id)) {
    visited.add(version.id);
    if (!version.deletedAt && version.evaluation) return version.evaluation;
    version = spec.plans.versions.find((item) => item.id === version.parentId);
  }
  return null;
}
