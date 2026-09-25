import { t as __t } from "../i18n/index.js";
import { LIMITS } from "../../shared/config.mjs";
import { h } from "vue";
import { parseSkillMarkdown } from "../../shared/skill-markdown.mjs";

import { btn, field, selectField } from "../services/form-fields.js";

export function useInstructions({
  S,
  openDialog,
  mutate,
  control,
  getField,
  onField,
  setField,
  setError,
}) {
  function editInstruction(kind, id) {
    const old = (S.w.document.projectSpec[kind] || []).find((x) => x.id === id),
      x = old || {
        id: "",
        name: "",
        description: "",
        content: "",
        trigger: "manual",
        keywords: [],
        enabled: true,
      };
    openDialog(
      __t("워크스페이스 스킬"),
      [
        field(__t("호출 이름 · $이름"), "id", x.id, "input", {
          required: true,
          pattern: "(?:[a-zA-Z0-9_]|-)+",
          placeholder: "java-review",
          maxlength: "80",
        }),
        field(__t("이름"), "name", x.name, "input", { required: true }),
        field(__t("언제 사용하는가"), "description", x.description),
        h("div", { class: "form-grid" }, [
          selectField(
            __t("선택 방식"),
            "trigger",
            [
              ["always", __t("항상 적용")],
              ["auto", __t("키워드에 따라 자동 선택")],
              ["manual", __t("직접 명령으로 호출")],
            ],
            x.trigger,
          ),
        ]),
        h("div", { id: "skill-keywords" }, [
          field(
            __t("자동 선택 키워드 · 쉼표로 구분"),
            "keywords",
            x.keywords.join(", "),
          ),
        ]),
        field(__t("AI가 따라야 할 지침"), "content", x.content, "textarea", {
          required: true,
          rows: "9",
          placeholder: __t(
            "검토 순서, 확인할 조건, 응답 형식 등을 작성하세요.",
          ),
        }),
        !old
          ? h("section", { class: "form-settings-section" }, [
              h("h3", {}, [__t("기존 지침 파일 가져오기")]),
              h("label", {}, [
                __t("AGENTS.md · CLAUDE.md · SKILL.md 또는 텍스트"),
              ]),
              h(
                "input",
                {
                  id: "instruction-import",
                  type: "file",
                  accept: ".md,.txt,text/plain",
                },
                [],
              ),
              h("small", {}, [
                __t(
                  "선택한 파일의 지침 내용을 가져옵니다. 스크립트나 외부 도구를 실행하지 않습니다.",
                ),
              ]),
            ])
          : "",
      ],
      async (f) =>
        mutate(
          (d) => {
            d.projectSpec[kind] ??= [];
            const next = {
              id: f.get("id").trim(),
              name: f.get("name"),
              description: f.get("description"),
              content: f.get("content"),
              trigger: f.get("trigger"),
              keywords: f
                .get("keywords")
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              enabled: f.has("enabled"),
            };
            if (old)
              d.projectSpec[kind][
                d.projectSpec[kind].findIndex((x) => x.id === id)
              ] = next;
            else d.projectSpec[kind].push(next);
          },
          __t("스킬") + __t(" 저장"),
        ),
      {
        wide: true,
        titleActions: [
          h("input", {
            type: "checkbox",
            role: "switch",
            name: "enabled",
            checked: x.enabled,
            "aria-label": __t("스킬 활성화"),
            title: __t("스킬 활성화"),
          }),
        ],
        footerStart: old
          ? btn("instruction-delete", __t("삭제"), "danger small", {
              "data-kind": kind,
              "data-id": id,
            })
          : "",
      },
    );
    const updateKeywords = () => {
      control("skill-keywords", { hidden: getField("trigger") !== "auto" });
    };
    onField("f-trigger", updateKeywords);
    updateKeywords();
    if (!old)
      onField("instruction-import", async (e) => {
        const f = e.target.files[0];
        if (f) {
          if (f.size > LIMITS.textChars) {
            setError(__t("20 KB 이하의 지침 파일을 선택하세요."));
            return;
          }
          const imported = parseSkillMarkdown(await f.text());
          setField("content", imported.content);
          if (imported.id) {
            for (const key of [
              "id",
              "name",
              "description",
              "trigger",
              "enabled",
            ])
              setField(key, imported[key]);
            setField("keywords", imported.keywords.join(", "));
            updateKeywords();
          }
        }
      });
  }
  return { editInstruction };
}
