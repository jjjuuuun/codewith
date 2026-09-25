import { validateEvaluationPolicy } from "./plan-evaluation-policy.mjs";
import { LIMITS } from "./config.mjs";
import { requirementContract, specStatus } from "./completion.mjs";
import { validatePlans } from "./plans.mjs";
export const SCHEMA = "codewith.spec.v2";
export const copy = (x) => JSON.parse(JSON.stringify(x));
export function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
const check = (ok, msg) => {
  if (!ok) throw problem(msg);
};
const string = (v, max = LIMITS.textChars) =>
  typeof v === "string" && v.length <= max;
export function validateDocument(input, { checkLifecycle = true } = {}) {
  const d = copy(input);
  check(
    d && d.schema === SCHEMA,
    "지원하지 않는 문서 형식입니다. CodeWith JSON v2를 선택하세요.",
  );
  check(
    string(d.project, 120) && d.project.trim(),
    "작업 공간 이름이 필요합니다.",
  );
  check(
    Array.isArray(d.specs) && d.specs.length <= 100,
    "명세는 최대 100개여야 합니다.",
  );
  const specIds = new Set(),
    requirementIds = new Set(),
    planIds = new Set(),
    recordIds = new Set();
  for (const s of d.specs) {
    check(
      s &&
        string(s.id, 80) &&
        /^[a-zA-Z0-9_-]+$/.test(s.id) &&
        !specIds.has(s.id),
      "잘못되거나 중복된 명세 ID입니다.",
    );
    specIds.add(s.id);
    check(string(s.title, 160) && s.title.trim(), "명세 제목을 입력하세요.");
    check(
      Number.isInteger(s.version) && s.version >= 1,
      "명세 버전이 올바르지 않습니다.",
    );
    check(
      s.status === undefined ||
        [
          "pending",
          "completed",
          "draft",
          "review",
          "accepted",
          "implementing",
          "verified",
        ].includes(s.status),
      "명세 상태가 올바르지 않습니다.",
    );
    validateEvaluationPolicy(s.evaluationPolicy);
    validatePlans(s);
    for (const v of s.plans.versions) {
      check(
        !planIds.has(v.id),
        "계획 버전 식별번호는 워크스페이스 내에서 중복될 수 없습니다.",
      );
      planIds.add(v.id);
    }
    s.subtitle ??= "";
    for (const k of ["subtitle", "decisions", "codeScope"])
      check(string(s[k]), `${k}의 형식이 올바르지 않습니다.`);
    for (const k of ["requirements", "tasks", "questions", "evidence"])
      check(
        Array.isArray(s[k]) && s[k].length <= 500,
        `${k} 목록이 올바르지 않습니다.`,
      );
    const ids = new Set();
    const unique = (id) => {
      check(
        string(id, 80) && /^[a-zA-Z0-9_-]+$/.test(id) && !ids.has(id),
        "항목 ID가 중복되거나 잘못되었습니다.",
      );
      ids.add(id);
    };
    for (const r of s.requirements) {
      validateEvaluationPolicy(r.evaluationPolicy);
      if (r.recordId !== undefined) {
        check(
          string(r.recordId, 100) &&
            /^requirement_[a-z0-9]{24}$/.test(r.recordId) &&
            !recordIds.has(r.recordId),
          "요구사항 내부 식별자가 잘못되거나 중복되었습니다.",
        );
        recordIds.add(r.recordId);
      }
      unique(r.id);
      check(
        !requirementIds.has(r.id),
        "요구사항 식별번호는 프로젝트 전체에서 중복될 수 없습니다.",
      );
      requirementIds.add(r.id);
      check(
        string(r.title, 300) &&
          r.title.trim() &&
          string(r.body) &&
          r.body.trim(),
        "요구사항 제목과 본문을 입력하세요.",
      );
      check(
        r.status === undefined ||
          ["pending", "completed", "draft", "accepted"].includes(r.status),
        "요구사항 상태가 올바르지 않습니다.",
      );
      if (r.status !== "completed")
        r.status =
          s.status === "verified" &&
          s.evidence.some(
            (e) =>
              e.req === r.id &&
              e.result === "pass" &&
              e.specVersion === s.version,
          )
            ? "completed"
            : "pending";
      r.version ??= 1;
      check(
        Number.isInteger(r.version) && r.version >= 1,
        "요구사항 버전이 올바르지 않습니다.",
      );
      r.completion ??= null;
      if (r.completion !== null) {
        const c = r.completion;
        check(
          c &&
            string(c.eventId, 100) &&
            string(c.planVersionId, 100) &&
            Number.isInteger(c.requirementVersion) &&
            c.requirementVersion >= 1 &&
            string(c.at, 80) &&
            Number.isFinite(Date.parse(c.at)) &&
            c.by &&
            string(c.by.id, 100) &&
            string(c.by.name, 100) &&
            string(c.summary, LIMITS.summaryChars) &&
            string(c.codeRevision, 200),
          "완료 알림 기록이 올바르지 않습니다.",
        );
      }
      check(
        Array.isArray(r.criteria) && r.criteria.length <= 100,
        "완료 기준 목록이 올바르지 않습니다.",
      );
      for (const c of r.criteria) {
        unique(c.id);
        check(
          string(c.text, LIMITS.summaryChars) && c.text.trim(),
          "완료 기준은 빈 항목 없이 작성하세요.",
        );
      }
    }
    for (const r of s.requirements) {
      r.resources ??= [];
      check(
        Array.isArray(r.resources) && r.resources.length <= 30,
        "요구사항 자료는 최대 30개입니다.",
      );
      for (const a of r.resources) {
        unique(a.id);
        validateResource(a);
      }
    }
    const reqIds = new Set(s.requirements.map((r) => r.id));
    for (const q of s.questions) {
      unique(q.id);
      check(
        string(q.text, LIMITS.shortTextChars) &&
          q.text.trim() &&
          string(q.answer, LIMITS.summaryChars) &&
          typeof q.resolved === "boolean",
        "질문 형식이 올바르지 않습니다.",
      );
    }
    for (const t of s.tasks) {
      unique(t.id);
      check(
        string(t.text, LIMITS.shortTextChars) &&
          t.text.trim() &&
          string(t.req, 80) &&
          typeof t.done === "boolean",
        "작업 형식이 올바르지 않습니다.",
      );
    }
    for (const t of s.tasks)
      check(
        !t.req || reqIds.has(t.req),
        "작업이 참조하는 요구사항이 없습니다.",
      );
    for (const e of s.evidence) {
      unique(e.id);
      check(
        string(e.title, 300) &&
          string(e.detail) &&
          string(e.code, LIMITS.labelChars) &&
          string(e.req, 80) &&
          string(e.at, 80) &&
          Number.isInteger(e.specVersion) &&
          ["pending", "pass", "fail"].includes(e.result),
        "검증 기록이 올바르지 않습니다.",
      );
    }
    for (const e of s.evidence)
      check(
        !e.req || reqIds.has(e.req),
        "검증이 참조하는 요구사항이 없습니다.",
      );
    s.status = specStatus(s);
    delete s.notes;
    delete s.history;
    for (const k of ["summary", "before", "after", "scope", "outOfScope"])
      delete s[k];
  }
  if (!d.files) d.files = {};
  check(
    typeof d.files === "object" &&
      !Array.isArray(d.files) &&
      Object.keys(d.files).length <= 150,
    "코드 파일 목록이 올바르지 않습니다.",
  );
  for (const [p, t] of Object.entries(d.files)) {
    validateFilePath(p);
    check(
      string(t, LIMITS.codeFileChars),
      "코드 파일은 200KB 이하의 텍스트여야 합니다.",
    );
  }
  check(
    JSON.stringify(d).length <= LIMITS.documentChars,
    "작업 공간 문서는 10MB 이하여야 합니다.",
  );
  const projectSpec = d.projectSpec || {
    purpose: "",
    principles: [],
    constraints: [],
  };
  check(string(projectSpec.purpose), "프로젝트 목적 형식이 올바르지 않습니다.");
  for (const k of ["principles", "constraints"])
    check(
      Array.isArray(projectSpec[k]) &&
        projectSpec[k].length <= 100 &&
        projectSpec[k].every((x) => string(x, LIMITS.shortTextChars)),
      "프로젝트 기준 형식이 올바르지 않습니다.",
    );
  validateEvaluationPolicy(projectSpec.evaluationPolicy);
  validateInstructions(projectSpec);
  return {
    schema: SCHEMA,
    project: d.project,
    projectSpec,
    specs: d.specs,
    files: d.files,
  };
}
export function validateFilePath(p) {
  check(
    typeof p === "string" &&
      p.length < 240 &&
      !p.includes("\\") &&
      !p.includes("\0") &&
      !p.startsWith("/") &&
      !p.includes(":") &&
      p
        .split("/")
        .every(
          (x) =>
            x &&
            x !== "." &&
            x !== ".." &&
            !["__proto__", "prototype", "constructor"].includes(x) &&
            !x.startsWith("."),
        ),
    "파일 경로는 프로젝트 내부의 일반 상대 경로여야 합니다. 숨김 파일과 상위 경로는 허용하지 않습니다.",
  );
  return p;
}
export function blankSpec(id, title) {
  return {
    id,
    title,
    subtitle: "",
    version: 1,
    status: "pending",
    decisions: "",
    codeScope: "",
    requirements: [],
    tasks: [],
    questions: [],
    evidence: [],
  };
}
export function semantic(s) {
  return JSON.stringify({
    id: s.id,
    title: s.title,
    ...(s.evaluationPolicy ? { evaluationPolicy: s.evaluationPolicy } : {}),
    subtitle: s.subtitle,
    decisions: s.decisions,
    codeScope: s.codeScope,
    requirements: s.requirements.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      criteria: r.criteria,
      ...(r.evaluationPolicy ? { evaluationPolicy: r.evaluationPolicy } : {}),
      resources: r.resources || [],
    })),
    questions: s.questions,
    tasks: s.tasks.map(({ done, ...t }) => t),
  });
}
export function validateResource(a) {
  check(a && string(a.title, 200) && a.title.trim(), "자료 이름이 필요합니다.");
  check(
    ["image", "table", "chart", "flow", "note"].includes(a.type),
    "지원하지 않는 자료 형식입니다.",
  );
  if (a.type === "image") {
    check(
      string(a.data, LIMITS.imageDataChars) &&
        /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          a.data,
        ),
      "이미지는 1 MB 이하의 PNG/JPEG/WebP/GIF여야 합니다.",
    );
  }
  if (a.type === "table") {
    check(
      Array.isArray(a.headers) &&
        a.headers.length > 0 &&
        a.headers.length <= 20 &&
        a.headers.every((x) => string(x, 300)) &&
        Array.isArray(a.rows) &&
        a.rows.length <= 100 &&
        a.rows.every(
          (r) =>
            Array.isArray(r) &&
            r.length === a.headers.length &&
            r.every((x) => string(x, LIMITS.shortTextChars)),
        ),
      "표는 동일한 열 수로 작성하세요. 최대 20열, 100행입니다.",
    );
  }
  if (a.type === "chart")
    check(
      Array.isArray(a.values) &&
        a.values.length > 0 &&
        a.values.length <= 50 &&
        a.values.every(
          (x) =>
            string(x.label, 200) &&
            x.label.trim() &&
            Number.isFinite(x.value) &&
            x.value >= 0,
        ),
      "그래프는 이름과 0 이상의 숫자로 작성하세요.",
    );
  if (a.type === "flow")
    check(
      Array.isArray(a.steps) &&
        a.steps.length > 0 &&
        a.steps.length <= 50 &&
        a.steps.every((x) => string(x, LIMITS.labelChars) && x.trim()),
      "흐름도에는 1~50개의 단계를 입력하세요.",
    );
  if (a.type === "note")
    check(string(a.text) && a.text.trim(), "자료 설명을 입력하세요.");
  return a;
}
export function changes(a, b, path = "") {
  const out = [];
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) ||
    Array.isArray(b)
  ) {
    out.push({ path: path || "/", before: a ?? null, after: b ?? null });
    return out;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (["updatedAt", "updatedBy", "createdBy"].includes(key)) continue;
    out.push(...changes(a[key], b[key], path + "/" + key));
  }
  return out;
}
export function exportDocument(workspace) {
  return {
    format: "codewith.exchange",
    version: 2,
    exportedAt: new Date().toISOString(),
    document: copy(workspace.document),
  };
}
export function importDocument(payload) {
  if (payload?.format === "codewith.exchange" && payload.version === 2)
    return validateDocument(payload.document);
  if (payload?.schema === "codewith.workspace.v1") {
    return validateDocument({
      schema: SCHEMA,
      project: payload.project,
      specs: payload.specs.map((s) => ({
        ...s,
        status: s.status === "accepted" ? "review" : s.status,
      })),
      files: {},
    });
  }
  return validateDocument(payload);
}
export const outputSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    specProposal: {
      type: ["object", "null"],
      properties: {
        title: { type: "string" },
        requirements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
              criteria: { type: "array", items: { type: "string" } },
            },
            required: ["title", "body", "criteria"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "requirements"],
      additionalProperties: false,
    },
    proposal: {
      type: ["object", "null"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        criteria: { type: "array", items: { type: "string" } },
      },
      required: ["title", "body", "criteria"],
      additionalProperties: false,
    },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["message", "proposal", "specProposal", "files"],
  additionalProperties: false,
};

export function validateInstructions(p) {
  p.instructions ??= "";
  check(string(p.instructions), "공통 지침은 20,000자 이하로 작성하세요.");
  const ids = new Set();
  for (const key of ["rules", "skills"]) {
    p[key] ??= [];
    check(
      Array.isArray(p[key]) && p[key].length <= 100,
      "스킬은 최대 100개입니다.",
    );
    for (const x of p[key]) {
      check(
        x &&
          string(x.id, 80) &&
          /^[a-zA-Z0-9_-]+$/.test(x.id) &&
          !ids.has(x.id),
        "스킬 식별번호는 중복 없이 영문·숫자·하이픈·밑줄로 작성하세요.",
      );
      ids.add(x.id);
      check(
        string(x.name, 160) &&
          x.name.trim() &&
          string(x.description, LIMITS.labelChars) &&
          string(x.content) &&
          x.content.trim(),
        "스킬 이름과 지침 내용을 작성하세요.",
      );
      check(
        ["always", "auto", "manual"].includes(x.trigger) &&
          typeof x.enabled === "boolean",
        "스킬 선택 설정이 올바르지 않습니다.",
      );
      check(
        Array.isArray(x.keywords) &&
          x.keywords.length <= 30 &&
          x.keywords.every((k) => string(k, 100) && k.trim()),
        "자동 선택 키워드가 올바르지 않습니다.",
      );
      if (x.trigger === "auto")
        check(
          x.keywords.length > 0,
          "자동 선택에는 키워드가 하나 이상 필요합니다.",
        );
      delete x.scope;
    }
  }
  // Legacy rules become skills, preserving their content and selection behavior.
  p.skills = [...p.rules, ...p.skills];
  check(p.skills.length <= 100, "스킬은 최대 100개입니다.");
  delete p.rules;
  return p;
}
