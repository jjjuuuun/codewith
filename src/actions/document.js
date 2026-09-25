import { t as __t } from "../i18n/index.js";
import { resolveEvaluationPolicy } from "../../shared/plan-evaluation-policy.mjs";
import { evaluationPolicyFields } from "../services/evaluation-policy-fields.js";
import { h } from "vue";
import { api } from "../services/api.js";
import { LIMITS } from "../../shared/config.mjs";

import { field, repeatRows } from "../services/form-fields.js";

export function createDocumentActions({
  personalSettingsDialog,
  editWorkspaceDialog,
  S,
  confirmRemoval,
  editInstruction,
  mutate,
  modal,
  workspaceDialog,
  joinWorkspaceDialog,
  deleteWorkspaceDialog,
  editSpec,
  deleteSpecDialog,
  editRequirement,
  openDialog,
  readRows,
  openInline,
  spec,
  editItem,
  fileDialog,
  resourceDialog,
  editResource,
}) {
  const onPersonalSettings = async (name, el) => {
    return personalSettingsDialog();
  };
  const onEditWorkspace = async (name, el) => {
    const id = el.dataset.id;
    return editWorkspaceDialog(id || S.w.id);
  };
  const onCompleteRequirement = (el) => {
    const workspace = S.w;
    const currentSpec = workspace.document.specs.find(
      (item) => item.id === el.dataset.spec,
    );
    const requirement = currentSpec?.requirements.find(
      (item) => item.id === el.dataset.id,
    );
    if (!requirement || !currentSpec.plans.finalVersionId)
      throw new Error(__t("최종 계획을 먼저 승인하세요."));
    const request = {
      base: workspace.head,
      eventId:
        crypto.randomUUID?.() ||
        `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      requirementVersion: requirement.version,
      planVersionId: currentSpec.plans.finalVersionId,
    };
    return openDialog(
      __t("구현 완료 기록"),
      [
        h(
          "p",
          { class: "muted" },
          __t(
            "직접 구현하고 검증한 결과를 기록합니다. 이 기록은 서버의 자동 테스트 통과를 의미하지 않습니다.",
          ),
        ),
        field(__t("검증 요약"), "completionSummary", "", "textarea", {
          required: true,
          maxlength: LIMITS.summaryChars,
        }),
        field(__t("코드 리비전 (선택)"), "completionRevision", "", "input", {
          maxlength: 200,
        }),
      ],
      async (form) => {
        const result = await api(
          `/workspaces/${workspace.id}/requirements/${encodeURIComponent(requirement.id)}/complete`,
          {
            method: "POST",
            body: {
              ...request,
              summary: form.get("completionSummary").trim(),
              codeRevision: form.get("completionRevision").trim(),
            },
          },
        );
        if (S.w?.id === workspace.id) S.w = result.workspace;
      },
    );
  };
  const onRemoveRequirement = async (name, el) => {
    const id = el.dataset.id,
      sid = el.dataset.spec;
    return confirmRemoval("requirement", id, sid);
  };
  const onRemoveTask = async (name, el) => {
    const id = el.dataset.id;
    return confirmRemoval("task", id);
  };
  const onRemoveQuestion = async (name, el) => {
    const id = el.dataset.id;
    return confirmRemoval("question", id);
  };
  const onRemovePlan = async (name, el) => {
    return confirmRemoval("plan");
  };
  const onInstructionNew = async (name, el) => {
    return editInstruction(el.dataset.kind);
  };
  const onInstructionEdit = async (name, el) => {
    const id = el.dataset.id;
    return editInstruction(el.dataset.kind, id);
  };
  const onInstructionDelete = async (name, el) => {
    const id = el.dataset.id;
    await mutate((d) => {
      d.projectSpec[el.dataset.kind] = d.projectSpec[el.dataset.kind].filter(
        (x) => x.id !== id,
      );
    }, __t("스킬 삭제"));
    return modal.close();
  };
  const onNewWorkspace = async (name, el) => {
    return workspaceDialog();
  };
  const onJoinDialog = async (name, el) => {
    return joinWorkspaceDialog();
  };
  const onDeleteWorkspace = async (name, el) => {
    const id = el.dataset.id;
    return deleteWorkspaceDialog(id || S.w.id);
  };
  const onNewSpec = async (name, el) => {
    return editSpec(true);
  };
  const onEditSpec = async (name, el) => {
    return editSpec();
  };
  const onDeleteSpec = async (name, el) => {
    return deleteSpecDialog();
  };
  const onNewRequirement = async (name, el) => {
    return editRequirement();
  };
  const onEditRequirement = async (name, el) => {
    const id = el.dataset.id,
      sid = el.dataset.spec;
    return editRequirement(id, sid);
  };
  const onEditProject = async (name, el) => {
    {
      const p = S.w.document.projectSpec;
      return openDialog(
        __t("워크스페이스 공통 설정"),
        [
          h("p", { class: "muted" }, [
            __t(
              "모든 명세에서 공유하는 지침입니다. 개인 공통 설정과 충돌하면 이 워크스페이스의 기준을 우선합니다.",
            ),
          ]),
          field(
            __t("AI 공통 지침"),
            "instructions",
            p.instructions || "",
            "textarea",
            {
              rows: "8",
              maxlength: "20000",
              placeholder: __t(
                "예: 구현을 제안하기 전에 예외 상황과 테스트 방법을 확인한다.",
              ),
            },
          ),
          field(__t("목적 · 해결할 문제"), "purpose", p.purpose, "textarea"),
          h("label", {}, [__t("설계 · 개발 원칙")]),
          repeatRows("principles", p.principles),
          h("label", {}, [__t("공통 제약")]),
          repeatRows("constraints", p.constraints),
        ],
        async (f) =>
          mutate((d) => {
            d.projectSpec = {
              ...d.projectSpec,
              instructions: f.get("instructions"),
              purpose: f.get("purpose"),
              principles: readRows("principles"),
              constraints: readRows("constraints"),
            };
          }, __t("워크스페이스 공통 설정 수정")),
        { wide: true },
      );
    }
  };
  const editEvaluationPolicy = (local = false) => {
    const current = local ? spec() : S.w.document.projectSpec;
    const sid = local ? current.id : null;
    const inherited = resolveEvaluationPolicy(
      local ? S.w.document.projectSpec : {},
    );
    const policy = evaluationPolicyFields(
      current.evaluationPolicy,
      inherited.policy,
      local ? __t("워크스페이스 설정") : __t("시스템 기본값"),
      local && inherited.source === "system"
        ? __t(
            "워크스페이스에 별도 설정이 없어 시스템 기본값을 이어받고 있습니다.",
          )
        : local
          ? __t("워크스페이스에 설정한 평가 기준을 이어받습니다.")
          : __t("워크스페이스의 평가 기준으로 시스템 기본값을 사용합니다."),
    );
    const editor = openDialog(
      local
        ? __t("명세 평가 기준 · ") + current.title
        : __t("워크스페이스 평가 기준"),
      [
        h(
          "p",
          { class: "muted" },
          local
            ? __t(
                "이 명세의 계획 전체를 평가하는 기준입니다. 별도 설정이 없으면 워크스페이스 기준을 사용합니다.",
              )
            : __t(
                "별도 평가 기준이 없는 모든 명세에 적용합니다. 설정하지 않으면 시스템 기본값을 사용합니다.",
              ),
        ),
        policy.nodes,
      ],
      async (f) =>
        mutate(
          (d) => {
            const target = local
              ? d.specs.find((s) => s.id === sid)
              : d.projectSpec;
            if (!target) throw new Error(__t("명세를 찾을 수 없습니다."));
            target.evaluationPolicy = policy.read(f);
          },
          local
            ? __t("명세 평가 기준 수정")
            : __t("워크스페이스 평가 기준 수정"),
        ),
      { wide: true },
    );
    policy.bind(editor);
    return editor;
  };
  const onEditDesign = async (name, el) => {
    return openInline(
      __t("계획"),
      [
        field(
          __t("설계 결정 · 근거 · 고려한 대안"),
          "decisions",
          spec().decisions,
          "textarea",
        ),
        field(
          __t("구현 범위 · 모듈 · 인터페이스"),
          "codeScope",
          spec().codeScope,
          "textarea",
        ),
      ],
      async (f) =>
        mutate((d, s) => {
          s.decisions = f.get("decisions");
          s.codeScope = f.get("codeScope");
        }, __t("명세 설계 수정")),
    );
  };
  const onNewQuestion = async (name, el) => {
    return editItem("question");
  };
  const onEditQuestion = async (name, el) => {
    const id = el.dataset.id;
    return editItem("question", id);
  };
  const onNewTask = async (name, el) => {
    return editItem("task");
  };
  const onEditTask = async (name, el) => {
    const id = el.dataset.id;
    return editItem("task", id);
  };
  const onNewEvidence = async (name, el) => {
    return editItem("evidence");
  };
  const onEditEvidence = async (name, el) => {
    const id = el.dataset.id;
    return editItem("evidence", id);
  };
  const onNewFile = async (name, el) => {
    return fileDialog();
  };
  const onEditFile = async (name, el) => {
    return fileDialog(el.dataset.path);
  };
  const onDeleteFile = async (name, el) => {
    return openDialog(
      __t("파일 삭제"),
      [
        h("p", {}, [
          el.dataset.path,
          __t("를 프로젝트에서 삭제합니다. 변경 이력으로 복원할 수 있습니다."),
        ]),
      ],
      async () =>
        mutate((d) => delete d.files[el.dataset.path], __t("코드 파일 삭제")),
      { save: __t("삭제") },
    );
  };
  const onResources = async (name, el) => {
    const id = el.dataset.id,
      sid = el.dataset.spec;
    return resourceDialog(id, sid);
  };
  const onResourceNew = async (name, el) => {
    const id = el.dataset.id,
      sid = el.dataset.spec;
    return editResource(id, sid, el.dataset.type);
  };
  const onResourceEdit = async (name, el) => {
    const id = el.dataset.id,
      sid = el.dataset.spec;
    return editResource(id, sid, null, el.dataset.resource);
  };
  const onResourceDelete = async (name, el) => {
    const id = el.dataset.id,
      sid = el.dataset.spec;
    await mutate((d) => {
      const r = d.specs
        .find((s) => s.id === sid)
        .requirements.find((r) => r.id === id);
      r.resources = r.resources.filter((a) => a.id !== el.dataset.resource);
    }, __t("참고 자료 삭제"));
    return resourceDialog(id, sid);
  };
  return {
    "complete-requirement": onCompleteRequirement,
    "edit-workspace-evaluation": () => editEvaluationPolicy(),
    "edit-spec-evaluation": () => editEvaluationPolicy(true),
    "personal-settings": (el) => onPersonalSettings("personal-settings", el),
    "edit-workspace": (el) => onEditWorkspace("edit-workspace", el),
    "remove-requirement": (el) => onRemoveRequirement("remove-requirement", el),
    "remove-task": (el) => onRemoveTask("remove-task", el),
    "remove-question": (el) => onRemoveQuestion("remove-question", el),
    "remove-plan": (el) => onRemovePlan("remove-plan", el),
    "instruction-new": (el) => onInstructionNew("instruction-new", el),
    "instruction-edit": (el) => onInstructionEdit("instruction-edit", el),
    "instruction-delete": (el) => onInstructionDelete("instruction-delete", el),
    "new-workspace": (el) => onNewWorkspace("new-workspace", el),
    "join-dialog": (el) => onJoinDialog("join-dialog", el),
    "delete-workspace": (el) => onDeleteWorkspace("delete-workspace", el),
    "new-spec": (el) => onNewSpec("new-spec", el),
    "edit-spec": (el) => onEditSpec("edit-spec", el),
    "delete-spec": (el) => onDeleteSpec("delete-spec", el),
    "new-requirement": (el) => onNewRequirement("new-requirement", el),
    "edit-requirement": (el) => onEditRequirement("edit-requirement", el),
    "edit-project": (el) => onEditProject("edit-project", el),
    "edit-design": (el) => onEditDesign("edit-design", el),
    "new-question": (el) => onNewQuestion("new-question", el),
    "edit-question": (el) => onEditQuestion("edit-question", el),
    "new-task": (el) => onNewTask("new-task", el),
    "edit-task": (el) => onEditTask("edit-task", el),
    "new-evidence": (el) => onNewEvidence("new-evidence", el),
    "edit-evidence": (el) => onEditEvidence("edit-evidence", el),
    "new-file": (el) => onNewFile("new-file", el),
    "edit-file": (el) => onEditFile("edit-file", el),
    "delete-file": (el) => onDeleteFile("delete-file", el),
    resources: (el) => onResources("resources", el),
    "resource-new": (el) => onResourceNew("resource-new", el),
    "resource-edit": (el) => onResourceEdit("resource-edit", el),
    "resource-delete": (el) => onResourceDelete("resource-delete", el),
  };
}
