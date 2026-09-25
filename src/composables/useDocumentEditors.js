import { t as __t } from "../i18n/index.js";
import {
  field,
  repeatRows,
  selectField,
  btn,
} from "../services/form-fields.js";
import { uid } from "../services/format.js";
import { h } from "vue";
import { t } from "../services/i18n.js";

export function useDocumentEditors({
  S,
  spec,
  openDialog,
  mutate,
  syncRoute,
  loadChats,
  render,
  openInline,
  readRows,
  editable,
}) {
  function editSpec(isNew = false) {
    const s = isNew ? { id: uid("SPEC"), title: "", subtitle: "" } : spec();
    openDialog(
      isNew ? __t("개발 단위 만들기") : __t("명세 정보 편집"),
      [
        field(__t("명세 식별번호"), "id", s.id, "input", {
          required: true,
          pattern: "(?:[a-zA-Z0-9_]|-)+",
          maxlength: "80",
        }),
        field(__t("명세 이름"), "title", s.title, "input", {
          required: true,
          maxlength: "160",
        }),
      ],
      async (f) => {
        const id = f.get("id").trim();
        await mutate(
          (d) => {
            if (d.specs.some((x) => x.id === id && (isNew || x.id !== s.id)))
              throw new Error(__t("이미 사용 중인 명세 식별번호입니다."));
            if (isNew)
              d.specs.push({
                id,
                title: f.get("title"),
                subtitle: isNew ? "" : s.subtitle,
                status: "pending",
                version: 1,
                decisions: "",
                codeScope: "",
                requirements: [],
                tasks: [],
                questions: [],
                evidence: [],
              });
            else
              Object.assign(
                d.specs.find((x) => x.id === s.id),
                {
                  id,
                  title: f.get("title"),
                  subtitle: isNew ? "" : s.subtitle,
                },
              );
            S.specId = id;
            S.view = "spec";
          },
          isNew ? __t("개발 단위 추가") : __t("명세 정보 수정"),
        );
        syncRoute({ replace: !isNew });
        await loadChats();
        render();
      },
    );
  }
  function editRequirement(rid, sid = S.specId, proposal = null) {
    const s = S.w.document.specs.find((s) => s.id === sid),
      r = s.requirements.find((r) => r.id === rid) || {
        id: uid("REQ"),
        title: proposal?.title || "",
        body: proposal?.body || "",
        status: "pending",
        criteria: (proposal?.criteria || [""]).map((text) => ({
          id: uid("AC"),
          text,
        })),
        resources: [],
      };
    openDialog(
      rid ? __t("요구사항 편집") : __t("요구사항 작성"),
      [
        h("div", { class: "note" }, [
          __t(
            "식별번호는 직접 정할 수 있습니다. 영문·숫자·하이픈·밑줄을 사용하세요. 변경하면 연결된 작업과 검증의 참조도 함께 바뀝니다.",
          ),
        ]),
        field(__t("요구사항 식별번호"), "id", r.id, "input", {
          required: true,
          pattern: "(?:[a-zA-Z0-9_]|-)+",
          maxlength: "80",
        }),
        field(__t("제목"), "title", r.title, "input", {
          required: true,
          maxlength: "300",
        }),
        field(
          __t("동작 계약 · 어떤 조건에서 무엇을 해야 하는가"),
          "body",
          r.body,
          "textarea",
          { required: true },
        ),
        h("label", {}, [__t("완료 기준 · 독립적으로 확인할 수 있는 항목")]),
        repeatRows("criteria", r.criteria, true),
        h("p", { class: "muted" }, [
          __t(
            "저장한 뒤 요구사항 카드의 자료 관리에서 목업·표·그래프를 추가할 수 있습니다.",
          ),
        ]),
      ],
      async (f) => {
        await mutate(
          (d) => {
            const target = d.specs.find((x) => x.id === sid),
              newId = f.get("id").trim(),
              next = {
                ...r,
                id: newId,
                title: f.get("title"),
                body: f.get("body"),
                criteria: readRows("criteria"),
              };
            if (rid) {
              target.requirements[
                target.requirements.findIndex((x) => x.id === rid)
              ] = next;
              if (rid !== newId) {
                target.tasks.forEach((x) => {
                  if (x.req === rid) x.req = newId;
                });
                target.evidence.forEach((x) => {
                  if (x.req === rid) x.req = newId;
                });
              }
            } else target.requirements.push(next);
          },
          rid ? __t("요구사항 수정") : __t("요구사항 추가"),
        );
      },
      { requirementId: rid || "", requirementSpec: sid },
    );
  }
  function editItem(kind, itemId) {
    const s = spec(),
      key = { question: "questions", task: "tasks", evidence: "evidence" }[
        kind
      ],
      item = s[key].find((x) => x.id === itemId);
    let html = field(
      __t("식별번호"),
      "id",
      item?.id || uid(kind.toUpperCase()),
      "input",
      { required: true, pattern: "(?:[a-zA-Z0-9_]|-)+" },
    );
    if (kind === "question")
      html = [
        html,
        [
          [
            field(__t("결정할 질문"), "text", item?.text || "", "textarea", {
              required: true,
            }),
            field(__t("결정 · 답변"), "answer", item?.answer || "", "textarea"),
          ],
          [
            h("label", { class: "check" }, [
              h(
                "input",
                {
                  name: "resolved",
                  type: "checkbox",
                  checked: item?.resolved,
                },
                [],
              ),
              __t(" 해결됨"),
            ]),
          ],
        ],
      ];
    if (kind === "task")
      html = [
        html,
        [
          field(__t("계획한 구현 단계"), "text", item?.text || "", "textarea", {
            required: true,
          }),
          selectField(
            __t("연결 요구사항"),
            "req",
            [
              ["", __t("연결 없음")],
              ...s.requirements.map((r) => [r.id, r.id + " · " + r.title]),
            ],
            item?.req || "",
          ),
        ],
      ];
    if (kind === "evidence")
      html = [
        html,
        [
          [
            [
              [
                [
                  field(__t("검증 이름"), "title", item?.title || "", "input", {
                    required: true,
                  }),
                  selectField(
                    __t("검증 대상 요구사항"),
                    "req",
                    [
                      ["", __t("전체 명세")],
                      ...s.requirements.map((r) => [
                        r.id,
                        r.id + " · " + r.title,
                      ]),
                    ],
                    item?.req || "",
                  ),
                ],
                selectField(
                  __t("실제 결과"),
                  "result",
                  [
                    ["pending", __t("미검증")],
                    ["pass", __t("통과")],
                    ["fail", __t("실패")],
                  ],
                  item?.result || "pending",
                ),
              ],
              field(
                __t("실행 환경 · 결과 · 확인 근거"),
                "detail",
                item?.detail || "",
                "textarea",
                { required: true },
              ),
            ],
            field(__t("실행한 명령 · 테스트 위치"), "code", item?.code || ""),
          ],
          field(
            __t("검증한 명세 버전"),
            "specVersion",
            item?.specVersion || s.version,
            "input",
            { type: "number", min: "1", required: true },
          ),
        ],
      ];
    openInline(
      {
        question: __t("열린 질문"),
        task: __t("구현 순서"),
        evidence: __t("검증 기록"),
      }[kind],
      html,
      async (f) => {
        const next = Object.fromEntries(f);
        if (kind === "question") next.resolved = f.has("resolved");
        if (kind === "task") next.done = item?.done || false;
        if (kind === "evidence") {
          next.specVersion = Number(next.specVersion);
          next.at = new Date().toISOString();
        }
        await mutate(
          (d, s) => {
            if (item) s[key][s[key].findIndex((x) => x.id === itemId)] = next;
            else s[key].push(next);
          },
          t(
            kind === "question"
              ? __t("요구사항 질문")
              : kind === "task"
                ? "tasks"
                : "verification",
          ) + __t(" 기록"),
        );
      },
    );
  }
  function fileDialog(p = "") {
    openDialog(
      p || __t("코드 파일 작성"),
      [
        field(__t("프로젝트 상대 경로"), "path", p, "input", {
          required: true,
          placeholder: "src/main/java/example/Main.java",
        }),
        field(
          __t("파일 내용"),
          "content",
          S.w.document.files[p] || "",
          "textarea",
          {
            class: "file-editor",
            spellcheck: "false",
          },
        ),
      ],
      editable()
        ? async (f) => {
            await mutate(
              (d) => {
                const next = f.get("path");
                if (next !== p && Object.hasOwn(d.files, next))
                  throw new Error(__t("같은 경로의 파일이 이미 있습니다."));
                if (p && p !== next) delete d.files[p];
                d.files[next] = f.get("content");
              },
              p ? __t("코드 파일 수정") : __t("코드 파일 추가"),
            );
          }
        : null,
      {
        wide: true,
        footerStart: p
          ? btn("delete-file", __t("이 파일 삭제"), "danger small", {
              "data-path": p,
              ...((!editable() ? { disabled: true } : {}) || {}),
            })
          : "",
      },
    );
  }

  return { editSpec, editRequirement, editItem, fileDialog };
}
