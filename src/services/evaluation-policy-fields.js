import { t as __t } from "../i18n/index.js";
import { h } from "vue";
import EvaluationCriteriaFields from "../components/forms/EvaluationCriteriaFields.vue";
import { field, selectField } from "./form-fields.js";
import {
  validateEvaluationPolicy,
  DEFAULT_EVALUATION_POLICY,
} from "../../shared/plan-evaluation-policy.mjs";
export function evaluationPolicyFields(
  value,
  inherited = DEFAULT_EVALUATION_POLICY,
  source = __t("시스템 기본값"),
  sourceDescription = __t("별도 설정 없이 이 기준을 그대로 사용합니다."),
) {
  const initial = JSON.parse(JSON.stringify(value || inherited));
  let boundEditor;
  return {
    nodes: h(
      "section",
      {
        class: "evaluation-policy-fields",
        "aria-label": __t("계획 평가 기준"),
      },
      [
        h(
          "p",
          { class: "muted" },
          __t("변경 내용은 저장 후 다음 평가부터 적용됩니다."),
        ),
        selectField(
          __t("평가 기준 적용"),
          "evaluationMode",
          [
            ["inherit", __t("{0} 사용", [source])],
            ["custom", __t("직접 설정")],
          ],
          value ? "custom" : "inherit",
        ),
        h(
          "section",
          {
            id: "evaluation-inherited",
            class: "evaluation-inheritance",
            "aria-label": __t("이어받을 평가 기준"),
          },
          [
            h("div", { class: "evaluation-inheritance-header" }, [
              h("div", { class: "evaluation-inheritance-source" }, [
                h(
                  "span",
                  { class: "evaluation-inheritance-caption" },
                  __t("적용할 기준"),
                ),
                h("strong", source),
                h("p", sourceDescription),
              ]),
              h("div", { class: "evaluation-inheritance-target" }, [
                h("span", __t("목표 점수")),
                h("strong", __t("{0}점", [inherited.targetScore])),
                h("small", __t("100점 만점")),
              ]),
            ]),
            h("div", { class: "evaluation-inheritance-list-title" }, [
              h("strong", __t("평가 항목")),
              h("span", __t("배점 합계 100점")),
            ]),
            h(
              "ul",
              { class: "evaluation-inheritance-criteria" },
              inherited.criteria.map((c) =>
                h("li", { key: c.id }, [
                  h("div", { class: "evaluation-inheritance-criterion" }, [
                    h("strong", c.label),
                    h("p", c.description),
                  ]),
                  h(
                    "span",
                    { class: "evaluation-inheritance-points" },
                    __t("{0}점", [c.points]),
                  ),
                ]),
              ),
            ),
            h(
              "p",
              { class: "evaluation-inheritance-note" },
              value
                ? __t(
                    "저장하면 직접 설정한 기준을 해제하고 위 기준을 사용합니다. 이후 원본 기준이 바뀌면 함께 적용됩니다.",
                  )
                : __t(
                    "원본 기준이 바뀌면 함께 적용됩니다. 이곳에서 다르게 적용하려면 ‘직접 설정’을 선택하세요.",
                  ),
            ),
          ],
        ),
        h("div", { id: "evaluation-custom" }, [
          field(
            __t("목표 점수"),
            "evaluationTarget",
            initial.targetScore,
            "input",
            {
              type: "number",
              min: 1,
              max: 100,
              step: 1,
              required: true,
            },
          ),
          h(EvaluationCriteriaFields, {
            name: "evaluationCriteria",
            items: initial.criteria,
            formRows: true,
          }),
        ]),
      ],
    ),
    read(f) {
      if (f.get("evaluationMode") !== "custom") return null;
      return validateEvaluationPolicy({
        targetScore: Number(f.get("evaluationTarget")),
        criteria: boundEditor.rows.evaluationCriteria.map((item) => ({
          ...item,
          label: item.label.trim(),
          description: item.description.trim(),
          points: Number(item.points),
        })),
      });
    },
    bind(editor) {
      boundEditor = editor;
      const update = () => {
        const inheritedMode = editor.values.evaluationMode !== "custom";
        editor.controls["evaluation-inherited"] = { hidden: !inheritedMode };
        editor.controls["evaluation-custom"] = { hidden: inheritedMode };
        editor.controls["f-evaluationTarget"] = { disabled: inheritedMode };
      };
      editor.handlers["f-evaluationMode"] = update;
      update();
    },
  };
}
