import { locale, t as __t } from "../i18n/index.js";
import { UI_CONFIG } from "../config/ui.js";
import { api } from "./api.js";
import { resourceHTML } from "./resource-html.js";
import { renderMarkdown } from "./markdown.js";
import { date, escapeHTML as esc } from "./format.js";
import { t } from "./i18n.js";
export function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), UI_CONFIG.downloadRevokeMs);
}
export function template() {
  return {
    format: "codewith.exchange",
    version: 2,
    document: {
      schema: "codewith.spec.v2",
      project: __t("참가 등록 프로젝트"),
      projectSpec: {
        instructions: "",
        skills: [],
        purpose: __t("중복 없이 행사 참가를 등록한다."),
        principles: [__t("요구사항별 검증 근거를 남긴다.")],
        constraints: [
          "Java 21 · IntelliJ IDEA",
          __t("이메일은 개인정보로 취급한다."),
        ],
      },
      specs: [
        {
          id: "SPEC-REGISTRATION",
          title: __t("참가 등록"),
          subtitle: __t("동일 이메일의 중복 등록을 막는다."),
          version: 1,
          status: "pending",
          decisions: __t("이메일 비교 정책은 열린 질문에서 먼저 결정한다."),
          codeScope: __t("RegistrationService와 참가 저장소"),
          requirements: [
            {
              id: "REG-001",
              title: __t("중복 등록 방지"),
              body: __t(
                "이미 등록된 이메일로 참가를 요청하면 기존 등록은 유지하고 중복 오류를 반환해야 한다.",
              ),
              status: "pending",
              criteria: [
                {
                  id: "REG-001-AC1",
                  text: __t("처음 요청한 이메일은 등록된다."),
                },
                {
                  id: "REG-001-AC2",
                  text: __t(
                    "같은 이메일로 두 번 요청하면 저장된 참가자는 한 명이다.",
                  ),
                },
              ],
              resources: [
                {
                  id: "REF-01",
                  type: "table",
                  title: __t("입력과 기대 결과"),
                  headers: [__t("입력"), __t("결과")],
                  rows: [
                    [__t("신규 이메일"), __t("등록 성공")],
                    [__t("중복 이메일"), __t("중복 오류")],
                  ],
                },
              ],
            },
          ],
          tasks: [
            {
              id: "TASK-001",
              text: __t("중복 확인과 등록을 하나의 원자적 작업으로 구현한다."),
              req: "REG-001",
              done: false,
            },
          ],
          questions: [
            {
              id: "Q-001",
              text: __t("이메일 대소문자와 공백을 어떻게 처리할 것인가?"),
              answer: "",
              resolved: false,
            },
          ],
          evidence: [],
        },
      ],
      files: {
        "src/main/java/example/RegistrationService.java": __t(
          "package example;\n\npublic class RegistrationService {\n    // 합의한 명세대로 직접 구현하세요.\n}\n",
        ),
      },
    },
  };
}
export async function exportHTML(workspaceId) {
  const payload = await api("/workspaces/" + workspaceId + "/export"),
    d = payload.document,
    style = await (await fetch("/style.css")).text();
  const logo = await window.CodeWithBrand.iconDataURL();
  const source = JSON.stringify(payload).replace(/</g, "\\u003c");
  const body = __t(
    '<div class="content" style="max-width:1050px"><p class="eyebrow">CodeWith · 워크스페이스 문서</p><h1>{0}</h1><p class="muted">{1} · 다운로드 시점의 워크스페이스를 담은 읽기용 HTML 문서입니다.</p><div class="card"><h2>워크스페이스 공통 설정</h2><div class="markdown">{2}</div><div class="markdown">{3}</div><h3>원칙</h3><ul>{4}</ul><h3>제약</h3><ul>{5}</ul></div><h2>스킬</h2>{6}{7}<h2>프로젝트 코드</h2>{8}</div>',
    [
      esc(d.project),
      date(payload.exportedAt),
      renderMarkdown(d.projectSpec.instructions || ""),
      renderMarkdown(d.projectSpec.purpose),
      d.projectSpec.principles.map((x) => `<li>${esc(x)}</li>`).join(""),
      d.projectSpec.constraints.map((x) => `<li>${esc(x)}</li>`).join(""),
      (d.projectSpec.skills || [])
        .map(
          (x) =>
            `<article class="card"><h3>${esc(x.name)} · /${esc(x.id)}</h3><p>${esc(x.description)} · ${x.enabled ? { always: "항상 적용", auto: "자동 선택", manual: "직접 호출" }[x.trigger] : "꺼짐"}</p><div class="markdown">${renderMarkdown(x.content)}</div></article>`,
        )
        .join(""),
      d.specs
        .map(
          (s) =>
            `<section><h2>${esc(s.id)} · ${esc(s.title)}</h2><p>${t(s.status)} · v${s.version} · ${esc(s.subtitle)}</p>${s.requirements.map((r) => `<article class="card"><p class="eyebrow">${esc(r.id)}</p><h3>${esc(r.title)}</h3><div class="markdown">${renderMarkdown(r.body)}</div><ul class="criteria">${r.criteria.map((c) => `<li><span><code>${esc(c.id)}</code> ${esc(c.text)}</span></li>`).join("")}</ul>${(r.resources || []).map((a) => `<h3 style="margin-top:25px">${esc(a.title)}</h3>${resourceHTML(a)}`).join("")}<p class="meta">작성 ${esc(r.createdBy?.name || "—")}</p></article>`).join("")}<div class="card"><h3>설계 결정</h3><div class="markdown">${renderMarkdown(s.decisions)}</div><h3>구현 범위</h3><div class="markdown">${renderMarkdown(s.codeScope)}</div><h3>구현 순서</h3><ul>${s.tasks.map((x) => `<li>${x.done ? "✓" : "□"} ${esc(x.id)} · ${esc(x.text)} (${esc(x.req)})</li>`).join("")}</ul><h3>열린 질문</h3>${s.questions.map((q) => `<p>${q.resolved ? "✓" : "?"} ${esc(q.text)}<br>${esc(q.answer)}</p>`).join("")}<h3>검증 기록</h3>${s.evidence.map((e) => `<p>${esc(e.title)} · ${esc(e.result)} · v${e.specVersion}<br>${esc(e.detail)}<br>${esc(e.code)}</p>`).join("")}</div></section>`,
        )
        .join(""),
      Object.entries(d.files)
        .map(
          ([p, c]) =>
            `<details class="card"><summary>${esc(p)}</summary><pre>${esc(c)}</pre></details>`,
        )
        .join(""),
    ],
  );
  download(
    "codewith-workspace.html",
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><link rel="icon" type="image/svg+xml" href="${logo}"><title>${esc(d.project)} · CodeWith</title><style>${style}</style></head><body>${body}<script type="application/json" id="codewith-data">${source}</script></body></html>`,
    "text/html",
  );
}
