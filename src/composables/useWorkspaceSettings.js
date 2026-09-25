import { t as __t } from "../i18n/index.js";
import ProjectSourceCard from "../components/ProjectSourceCard.vue";
import { LIMITS } from "../../shared/config.mjs";
import { h } from "vue";
import { api } from "../services/api.js";

import { btn, field } from "../services/form-fields.js";

export function useWorkspaceSettings({
  S,
  openDialog,
  getMode,
  refreshList,
  loadWorkspace,
  setContent,
  render,
  toast,
  goHome,
  editable,
  spec,
  syncRoute,
  loadChats,
  renderChat,
  modal,
}) {
  function workspaceDialog() {
    openDialog(
      __t("워크스페이스 만들기"),
      [
        h("p", { class: "muted" }, [__t("새 프로젝트의 이름을 정해 주세요.")]),
        field(__t("워크스페이스 이름"), "workspaceName", "", "input", {
          required: true,
          maxlength: "120",
          placeholder: __t("예: CodeWith 개발"),
        }),
        getMode() === "personal"
          ? ""
          : [
              h("label", { class: "team-option" }, [
                h("span", {}, [
                  h("b", {}, [__t("팀 참여 요청 허용")]),
                  h("small", {}, [
                    __t("초대받은 사람이 참여를 요청할 수 있습니다."),
                  ]),
                ]),
                h(
                  "input",
                  {
                    type: "checkbox",
                    name: "team",
                    role: "switch",
                    "aria-label": __t("팀 참여 요청 허용"),
                  },
                  [],
                ),
              ]),
              h("p", { class: "muted" }, [
                __t("멤버 승인은 생성 후 멤버 · 공유에서 관리합니다."),
              ]),
            ],
      ],
      async (f) => {
        const w = await api("/workspaces", {
          method: "POST",
          body: {
            name: f.get("workspaceName").trim(),
            visibility: f.has("team") ? "team" : "private",
          },
        });
        await refreshList();
        await loadWorkspace(w.id);
      },
      { save: __t("만들기") },
    );
  }
  function joinWorkspaceDialog() {
    openDialog(
      __t("초대 코드로 참여"),
      [
        h("p", { class: "muted" }, [
          __t("워크스페이스 관리자에게 받은 초대 코드를 입력하세요."),
        ]),
        field(
          __t("초대 코드"),
          "invite",
          new URLSearchParams(location.search).get("join") || "",
          "input",
          { required: true, autocomplete: "off" },
        ),
        h("p", { id: "join-status", role: "status" }, [
          __t("참여 요청은 관리자 승인 후 목록에 표시됩니다."),
        ]),
      ],
      async (f) => {
        const r = await api("/join", {
          method: "POST",
          body: { code: f.get("invite").trim() },
        });
        if (r.joined) {
          await refreshList();
          await loadWorkspace(r.id);
          return;
        }
        setContent(
          "join-status",
          __t(
            "참여 요청을 보냈습니다. 관리자 승인 후 브라우저를 새로고침하면 목록에 표시됩니다.",
          ),
        );
        toast(__t("참여 요청을 보냈습니다."));
        return false;
      },
      { save: __t("참여 요청") },
    );
  }
  async function editWorkspaceDialog(id) {
    const w = await api("/workspaces/" + id);
    if (w.role !== "owner")
      throw new Error(__t("슈퍼관리자만 기본 설정을 변경할 수 있습니다."));
    openDialog(
      __t("워크스페이스 편집"),
      [
        field(
          __t("워크스페이스 이름"),
          "workspaceName",
          w.document.project,
          "input",
          { required: true, maxlength: "120" },
        ),
        field(
          __t("프로젝트 목적"),
          "workspacePurpose",
          w.document.projectSpec.purpose,
          "textarea",
          {
            maxlength: LIMITS.textChars,
            placeholder: __t("이 프로젝트에서 해결할 문제를 작성하세요."),
          },
        ),
      ],
      async (f) => {
        const next = await api("/workspaces/" + id + "/settings", {
          method: "POST",
          body: {
            name: f.get("workspaceName"),
            purpose: f.get("workspacePurpose"),
            base: w.head,
          },
        });
        if (S.w?.id === id) S.w = next;
        await refreshList();
        render();
        toast(__t("워크스페이스 기본 설정을 저장했습니다."));
      },
      {
        footerStart: btn(
          "delete-workspace",
          __t("워크스페이스 삭제"),
          "danger small",
          { "data-id": id },
        ),
      },
    );
  }
  async function personalSettingsDialog() {
    const current = await api("/preferences");
    const editor = openDialog(
      __t("개인 설정"),
      [
        h(
          "div",
          {
            class: "personal-settings-tabs",
            role: "tablist",
            "aria-label": __t("개인 설정 구분"),
            onKeydown: (event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const tab =
                event.key === "Home"
                  ? "skills"
                  : event.key === "End"
                    ? "project"
                    : editor.options.personalTab === "skills"
                      ? "project"
                      : "skills";
              selectTab(tab);
              event.currentTarget
                .querySelector(`#personal-tab-${tab}`)
                ?.focus();
            },
          },
          [
            btn("personal-tab-skills", __t("스킬"), "ghost", {
              id: "personal-tab-skills",
              role: "tab",
              "aria-controls": "personal-skills",
            }),
            btn("personal-tab-project", __t("프로젝트 연결"), "ghost", {
              id: "personal-tab-project",
              role: "tab",
              "aria-controls": "personal-project",
            }),
          ],
        ),
        h(
          "section",
          {
            id: "personal-skills",
            role: "tabpanel",
            "aria-labelledby": "personal-tab-skills",
          },
          [
            h(
              "p",
              { class: "muted" },
              __t(
                "모든 워크스페이스에서 내 AI 대화에 적용할 개인 공통 지침입니다. 팀원과 공유되지 않습니다.",
              ),
            ),
            field(
              __t("AI 공통 지침"),
              "instructions",
              current.instructions,
              "textarea",
              {
                rows: "10",
                maxlength: LIMITS.textChars,
                placeholder: __t(
                  "예: 한국어로 설명하고, 답을 제시하기 전에 내가 생각할 질문을 하나 해 주세요.",
                ),
              },
            ),
            h(
              "p",
              { class: "muted" },
              __t(
                "워크스페이스 공통 설정과 충돌하면 워크스페이스 기준을 우선합니다. 스킬은 그 기준 안에서 필요한 절차를 추가합니다.",
              ),
            ),
          ],
        ),
        h(
          "section",
          {
            id: "personal-project",
            role: "tabpanel",
            "aria-labelledby": "personal-tab-project",
            hidden: true,
          },
          S.w
            ? [
                h(
                  "p",
                  { class: "muted" },
                  __t(
                    "{0}에서 내가 사용할 폴더입니다. 다른 팀원의 연결에는 영향을 주지 않습니다. 연결 변경은 즉시 적용됩니다.",
                    [S.w.document.project],
                  ),
                ),
                h(ProjectSourceCard),
              ]
            : [
                h(
                  "p",
                  { class: "note" },
                  __t(
                    "워크스페이스를 연 뒤 이 탭에서 프로젝트 폴더를 연결하세요.",
                  ),
                ),
              ],
        ),
      ],
      async (f) => {
        const saved = await api("/preferences", {
          method: "POST",
          body: {
            instructions: f.get("instructions"),
            revision: current.revision,
          },
        });
        current.revision = saved.revision;
        toast(__t("개인 설정을 저장했습니다."));
      },
      { wide: true, personalSettings: true, personalTab: "skills" },
    );
    const selectTab = (tab) => {
      editor.options.personalTab = tab;
      for (const key of ["skills", "project"]) {
        editor.controls[`personal-${key}`] = { hidden: key !== tab };
        editor.controls[`personal-tab-${key}`] = {
          "aria-selected": key === tab,
          tabindex: key === tab ? 0 : -1,
        };
      }
    };
    for (const tab of ["skills", "project"])
      editor.handlers[`personal-tab-${tab}`] = () => selectTab(tab);
    selectTab("skills");
  }
  async function deleteWorkspaceDialog(id) {
    const w = await api("/workspaces/" + id);
    if (w.role !== "owner")
      throw new Error(__t("워크스페이스 소유자만 삭제할 수 있습니다."));
    openDialog(
      __t("워크스페이스 삭제"),
      [
        h("h3", {}, [w.document.project]),
        h("p", {}, [
          __t(
            "모든 멤버의 목록에서 사라지고, 명세·이력·대화에 접근할 수 없게 됩니다. 초대 코드도 사용할 수 없습니다.",
          ),
        ]),
        h("p", { class: "muted" }, [
          __t(
            "서버에는 복구용 데이터가 보관됩니다. 영구 삭제가 아니며 현재 화면에서 되돌리는 기능은 없습니다.",
          ),
        ]),
      ],
      async () => {
        await api("/workspaces/" + id, {
          method: "DELETE",
          body: { base: w.head },
        });
        await goHome({ replace: true });
        toast(__t("워크스페이스를 삭제했습니다."));
      },
      { save: __t("워크스페이스 삭제") },
    );
  }
  function deleteSpecDialog() {
    if (!editable()) return;
    const s = spec(),
      wid = S.w.id,
      base = S.w.head;
    if (!s) return;
    openDialog(
      __t("명세 삭제"),
      [
        h("div", { class: "delete-target" }, [
          h("code", {}, [s.id]),
          h("b", {}, [s.title]),
        ]),
        h("p", {}, [
          __t("이 명세와 포함된 요구사항 "),
          s.requirements.length,
          __t("개, 첨부 자료, 계획서 "),
          s.plans.versions.filter((v) => !v.deletedAt).length,
          __t("개 버전을 함께 삭제합니다."),
        ]),
        h("p", { class: "muted" }, [
          __t(
            "다른 명세는 유지됩니다. 워크스페이스 이력에서 삭제 전 커밋으로 복원할 수 있습니다. 복원은 워크스페이스 전체에 적용됩니다.",
          ),
        ]),
      ],
      async () => {
        const workspace = await api(
          "/workspaces/" + wid + "/specs/" + encodeURIComponent(s.id),
          { method: "DELETE", body: { base } },
        );
        Object.assign(S, {
          w: workspace,
          view: "requirements",
          specId: null,
          tab: "requirements",
          messages: [],
          draft: "",
        });
        syncRoute({ replace: true });
        render();
        await refreshList();
        await loadChats();
        renderChat();
        toast(__t("명세를 삭제했습니다. 워크스페이스 이력에 기록했습니다."));
      },
      { save: __t("명세 삭제") },
    );
  }
  function profileDialog() {
    openDialog(
      __t("CodeWith에 오신 것을 환영합니다"),
      [
        h("p", {}, [
          __t(
            "팀원에게 보여줄 이름을 입력하세요. 명세와 변경 이력에 이 이름이 표시됩니다.",
          ),
        ]),
        field(__t("표시 이름"), "profileName", "", "input", {
          required: true,
          maxlength: "80",
          autocomplete: "name",
          placeholder: __t("예: 김개발"),
        }),
      ],
      async (f) => {
        const result = await api("/profile", {
          method: "POST",
          body: { name: f.get("profileName") },
        });
        S.user = result.user;
        modal.close();
        render();
        if (new URLSearchParams(location.search).has("join"))
          joinWorkspaceDialog();
        return false;
      },
      { save: __t("시작하기") },
    );
  }
  return {
    workspaceDialog,
    joinWorkspaceDialog,
    editWorkspaceDialog,
    personalSettingsDialog,
    deleteWorkspaceDialog,
    deleteSpecDialog,
    profileDialog,
  };
}
