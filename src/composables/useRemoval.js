import { t as __t } from "../i18n/index.js";
import { h } from "vue";

export function useRemoval({ S, openDialog, mutate }) {
  function confirmRemoval(kind, id, sid = S.specId) {
    const labels = {
      requirement: __t("요구사항"),
      task: __t("구현 단계"),
      question: __t("열린 질문"),
      plan: __t("계획"),
    };
    const target = S.w.document.specs
      .find((s) => s.id === sid)
      ?.requirements.find((r) => r.id === id);
    openDialog(
      labels[kind] + __t(" 삭제"),
      [
        kind === "requirement" && target
          ? [
              h("div", { class: "delete-target" }, [
                h("code", {}, [target.id]),
                h("b", {}, [target.title]),
              ]),
            ]
          : "",
        h("p", {}, [
          __t("선택한 "),
          labels[kind],
          __t(" 항목을 삭제합니다. 저장된 변경 이력에서 복원할 수 있습니다."),
        ]),
        kind === "requirement"
          ? [
              h("p", { class: "muted" }, [
                __t(
                  "연결된 구현 단계와 검증 기록은 보존하고, 삭제된 요구사항에 대한 연결만 해제합니다.",
                ),
              ]),
            ]
          : "",
      ],
      async () =>
        mutate(
          (d) => {
            const s = d.specs.find((x) => x.id === sid);
            if (kind === "plan") {
              s.decisions = "";
              s.codeScope = "";
            } else if (kind === "requirement") {
              s.requirements = s.requirements.filter((x) => x.id !== id);
              for (const x of [...s.tasks, ...s.evidence])
                if (x.req === id) x.req = "";
            } else {
              const key = kind === "task" ? "tasks" : "questions";
              s[key] = s[key].filter((x) => x.id !== id);
            }
          },
          labels[kind] + __t(" 삭제"),
        ),
      { save: __t("삭제 확인") },
    );
  }
  return { confirmRemoval };
}
