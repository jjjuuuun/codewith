import { t as __t } from "../i18n/index.js";
import { chatMessageText } from "../../shared/chat-proposal.mjs";
import { field } from "../services/form-fields.js";
import { h } from "vue";
import { api, aiAPI } from "../services/api.js";

export function createChatActions({
  openChatHistory,
  loadChatHistory,
  newChat,
  renameChat,
  deleteChat,
  previewChat,
  regenerateLast,
  AIFlow,
  aiWizard,
  beginAIAuth,
  aiDialog,
  aiOptions,
  disconnectAI,
  startOfficialLogin,
  getField,
  setField,
  setContent,
  connectAPIKey,
  openDialog,
  S,
  renderChat,
  sendChat,
  chatSpec,
  editRequirement,
  loadChats,
  render,
  toast,
}) {
  const onAiService = async (name, el) => {
    AIFlow.service = el.dataset.service;
    return aiWizard(2);
  };
  const onAiMethod = async (name, el) => {
    AIFlow.method = el.dataset.method;
    return aiWizard(3);
  };
  const onAiBack = async (name, el) => {
    return aiWizard(Number(el.dataset.step));
  };
  const onStartAiAuth = async (name, el) => {
    return beginAIAuth(el.dataset.service);
  };
  const onAiSettings = async (name, el) => {
    return aiDialog();
  };
  const onAiOptions = async (name, el) => {
    return aiOptions();
  };
  const onDisconnectAi = async (name, el) => {
    return disconnectAI(el);
  };
  const onOfficialLogin = async (name, el) => {
    return startOfficialLogin();
  };
  const onOfficialCode = async (name, el) => {
    {
      const code = getField("authCode").trim();
      el.disabled = true;
      try {
        await aiAPI("/login/code", { method: "POST", body: { code } });
        setField("authCode", "");
        setContent("claude-code-step", [
          h("p", { class: "note" }, [__t("인증을 확인하고 있습니다…")]),
        ]);
      } catch (e) {
        el.disabled = false;
        throw e;
      }
      return;
    }
  };
  const onSaveApiKey = async (name, el) => {
    return connectAPIKey();
  };
  const onContextFiles = async (name, el) => {
    return openDialog(
      __t("AI에 제공할 코드 파일"),
      [
        h("p", { class: "muted" }, [
          __t(
            "프로젝트 기준과 현재 명세는 기본 문맥입니다. 추가로 보낼 코드 파일을 선택하세요.",
          ),
        ]),
        Object.keys(S.w.document.files).map((p) => [
          h("label", { class: "check" }, [
            h(
              "input",
              {
                type: "checkbox",
                name: "context",
                value: p,
                checked: S.selectedFiles.includes(p),
              },
              [],
            ),
            " ",
            h("span", { class: "file-path" }, [p]),
          ]),
        ]) || [
          h("p", {}, [__t("코드 파일 화면에서 직접 작성하거나 가져오세요.")]),
        ],
      ],
      async (f) => {
        S.selectedFiles = f.getAll("context");
        renderChat();
      },
      { save: __t("선택 적용") },
    );
  };
  const onSendChat = async (name, el) => {
    return sendChat();
  };
  const onCancelChat = async (name, el) => {
    await aiAPI("/cancel", { method: "POST" });
    return;
  };
  const onReviewProposal = async (name, el) => {
    const id = el.dataset.id;
    {
      const m = S.messages.find((m) => m.id === id);
      if (!chatSpec() || m?.specId !== chatSpec().id)
        throw new Error(__t("해당 명세를 연 뒤 제안을 반영하세요."));
      return editRequirement(null, m.specId, m.proposal);
    }
  };
  const onAddSpecProposal = async (el) => {
    if (S.busy) return toast(__t("AI 응답이 완료된 뒤 명세를 추가하세요."));
    const wid = S.w.id;
    const workspace = await api(
      `/workspaces/${wid}/chats/${el.dataset.id}/spec`,
      {
        method: "POST",
        body: { base: S.w.head },
      },
    );
    if (S.w?.id !== wid) return;
    S.w = workspace;
    await loadChats();
    render();
    toast(__t("제안한 명세와 요구사항·완료 기준을 추가했습니다."));
  };
  const onApplyAnswer = async (name, el) => {
    const id = el.dataset.id;
    {
      const m = S.messages.find((m) => m.id === id);
      return openDialog(
        __t("코드 변경 검토"),
        [
          h("p", {}, [
            __t(
              "현재 프로젝트 파일과 제안을 비교한 뒤 반영하세요. 명세와 코드가 응답 시점 이후 바뀌었으면 반영을 거절합니다.",
            ),
          ]),
          m.files.map((f) => [
            h("h3", { class: "file-path" }, [f.path]),
            h("details", {}, [
              h("summary", {}, [__t("현재 파일")]),
              h("pre", {}, [S.w.document.files[f.path] || __t("(새 파일)")]),
            ]),
            h("label", {}, [__t("제안된 전체 파일")]),
            h("pre", {}, [f.content]),
          ]),
        ],
        async () => {
          S.w = await api(`/workspaces/${S.w.id}/chats/${id}/apply`, {
            method: "POST",
            body: { base: S.w.head },
          });
          await loadChats();
          render();
          toast(__t("코드 파일을 작성하고 커밋했습니다."));
        },
        { save: __t("파일 작성 · 커밋"), wide: true },
      );
    }
  };
  return {
    "new-chat": newChat,
    "rename-chat": (el) => renameChat(el.dataset.id),
    "delete-chat": (el) => deleteChat(el.dataset.id),
    "preview-chat": (el) => previewChat(el.dataset.id),
    "regenerate-chat": regenerateLast,
    "copy-chat": async (el) => {
      const text = chatMessageText(
        S.messages.find((message) => message.id === el.dataset.id),
      );
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast(__t("메시지를 복사했습니다."));
      } catch {
        openDialog(
          __t("메시지 복사"),
          [
            field(__t("복사할 내용"), "copyMessage", text, "textarea", {
              readonly: true,
              rows: "12",
            }),
          ],
          null,
          { wide: true },
        );
      }
    },
    "chat-history": openChatHistory,
    "load-chat-history": (el) =>
      loadChatHistory(el.dataset.spec, el.dataset.thread),
    "ai-service": (el) => onAiService("ai-service", el),
    "ai-method": (el) => onAiMethod("ai-method", el),
    "ai-back": (el) => onAiBack("ai-back", el),
    "start-ai-auth": (el) => onStartAiAuth("start-ai-auth", el),
    "ai-settings": (el) => onAiSettings("ai-settings", el),
    "ai-options": (el) => onAiOptions("ai-options", el),
    "disconnect-ai": (el) => onDisconnectAi("disconnect-ai", el),
    "official-login": (el) => onOfficialLogin("official-login", el),
    "official-code": (el) => onOfficialCode("official-code", el),
    "save-api-key": (el) => onSaveApiKey("save-api-key", el),
    "context-files": (el) => onContextFiles("context-files", el),
    "send-chat": (el) => onSendChat("send-chat", el),
    "cancel-chat": (el) => onCancelChat("cancel-chat", el),
    "review-proposal": (el) => onReviewProposal("review-proposal", el),
    "add-spec-proposal": onAddSpecProposal,
    "apply-answer": (el) => onApplyAnswer("apply-answer", el),
  };
}
