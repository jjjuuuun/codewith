import { t as __t } from "../i18n/index.js";
import { UI_CONFIG } from "../config/ui.js";
import { LIMITS } from "../../shared/config.mjs";
import { planChatIntent } from "../../shared/chat-context.mjs";
import { consumeAI } from "../services/ai-events.js";
import { useChatDrafts } from "./useChatDrafts.js";
import { useChatAttachments } from "./useChatAttachments.js";
import { streamedChatMessage } from "../../shared/chat-stream.mjs";
import { h, watch } from "vue";
import HelpTip from "../components/HelpTip.vue";
import { aiAPI, aiFetch } from "../services/api.js";
import { uid } from "../services/format.js";

import { field, selectField } from "../services/form-fields.js";
import { useChatThreads } from "./useChatThreads.js";

export function useChat({
  plans,
  S,
  chatSpec,
  renderChat,
  render,
  toast,
  openDialog,
  projectSourceUI,
  modal,
  syncRoute,
}) {
  let chatLoadGeneration = 0;
  // Queue IDs stay in the browser; getRandomValues also works over LAN HTTP.
  const nextQueueId = () => uid("queue");
  const attachmentUI = useChatAttachments(S, toast);
  const threads = useChatThreads({
    S,
    chatSpec,
    openDialog,
    modal,
    syncRoute,
    loadChats: (...args) => loadChats(...args),
    render,
    toast,
  });
  useChatDrafts(S);
  let recovering = false;
  S.toolApprovals = [];
  function toolEvent(event) {
    if (
      event.type === "tool-approval" &&
      !S.toolApprovals.some((item) => item.id === event.id)
    )
      S.toolApprovals.push(event);
    if (event.type === "tool-approval-resolved")
      S.toolApprovals = S.toolApprovals.filter((item) => item.id !== event.id);
  }
  async function loadChats(requested) {
    const generation = ++chatLoadGeneration,
      wid = S.w?.id,
      sid = chatSpec()?.id || null;
    S.chatLoading = true;
    try {
      const { messages, thread } = await serverChats(wid, sid, requested);
      if (
        generation === chatLoadGeneration &&
        S.w?.id === wid &&
        (chatSpec()?.id || null) === sid
      ) {
        S.messages = messages;
        S.chatThread = thread;
        if (!S.busy && !recovering) {
          const { job } = await aiAPI(
            `/jobs?workspace=${wid}&spec=${sid || ""}&kind=chat`,
          );
          if (job?.state === "running" && job.threadId === thread?.id)
            void recover(job);
          else if (S.chatMode === "plan") void plans.recover?.();
        }
      }
    } finally {
      if (generation === chatLoadGeneration) S.chatLoading = false;
    }
  }
  async function serverSettings() {
    return (await aiAPI("/settings")).settings;
  }
  const serverChats = (...args) => threads.fetchChats(...args);
  async function refreshModels() {
    const r = await aiAPI("/models");
    S.models = r.models;
    S.connected = true;
    if (!S.models.some((m) => (m.model || m.id) === S.settings.model)) {
      S.settings.model =
        (S.models.find((m) => m.isDefault) || S.models[0])?.model ||
        S.models[0]?.id ||
        "";
      S.settings.effort = "auto";
      await persistSettings();
    }
    renderChat();
  }
  async function persistSettings() {
    S.settings = (
      await aiAPI("/settings", { method: "POST", body: S.settings })
    ).settings;
  }
  function aiOptions() {
    const m = S.models.find((m) => (m.model || m.id) === S.settings.model);
    openDialog(
      __t("AI 응답 설정"),
      [
        selectField(
          [
            __t("외부 문서 검색"),
            h(HelpTip, {
              label: __t("외부 문서 검색 설명"),
              text: __t(
                "채팅과 계획 작성·검토에서 최신 정보나 외부 링크 확인이 필요하면 공개 웹을 검색합니다. 비공개·로그인 문서는 읽을 수 없으며 모델·계정의 지원 범위에 따라 달라집니다. 검색에는 공급자 사용량이 발생할 수 있습니다. Claude API는 문서 조사 후 답변을 작성하므로 추가 모델 요청이 발생합니다.",
              ),
            }),
          ],
          "webSearch",
          [
            ["auto", __t("자동 · 필요할 때 검색")],
            ["off", __t("끄기 · 전달한 내용만 사용")],
          ],
          S.settings.webSearch || "auto",
        ),
        selectField(
          __t("설명 깊이"),
          "style",
          [
            ["brief", __t("간결하게")],
            ["balanced", __t("균형 있게")],
            ["detailed", __t("자세하게")],
          ],
          S.settings.style,
        ),
        selectField(
          __t("추론 요약"),
          "summary",
          [
            ["auto", __t("기본값")],
            ["concise", __t("간결한 요약")],
            ["detailed", __t("상세 요약")],
          ],
          S.settings.summary,
        ),
        selectField(
          __t("서비스 등급"),
          "serviceTier",
          [
            ["auto", __t("기본값")],
            ...(m?.serviceTiers || []).map((t) => [t.id, t.name]),
          ],
          S.settings.serviceTier,
        ),
        ["openai", "claude"].includes(S.settings.provider)
          ? [
              field(
                __t("최대 출력 토큰 · 비우면 공급자 기본값"),
                "maxTokens",
                S.settings.maxTokens || "",
                "input",
                {
                  type: "number",
                  min: LIMITS.aiMinTokens,
                  max: LIMITS.aiMaxTokens,
                },
              ),
              field(
                __t("Temperature · 비우면 공급자 기본값"),
                "temperature",
                S.settings.temperature ?? "",
                "input",
                { type: "number", min: "0", max: "2", step: "0.1" },
              ),
            ]
          : [
              h("p", { class: "note" }, [
                __t(
                  "Codex는 모델 목록이 제공하는 추론 강도와 서비스 등급을 표시합니다. 출력 토큰 제한과 Temperature는 Codex App Server에서 별도로 설정하지 않습니다.",
                ),
              ]),
            ],
        h("p", { class: "muted" }, [
          __t(
            "모델마다 지원하는 기능이 다릅니다. 공급자가 거절한 조합은 오류를 그대로 표시하며 변경을 반영하지 않습니다.",
          ),
        ]),
      ],
      async (f) => {
        Object.assign(S.settings, Object.fromEntries(f));
        await persistSettings();
        renderChat();
      },
    );
  }
  const sameScope = (item) =>
    item.userId === S.user?.id &&
    item.workspaceId === S.w?.id &&
    item.specId === (chatSpec()?.id || null) &&
    item.threadId === (S.chatThread?.id || null);
  function cancelQueued(id) {
    S.chatQueue = S.chatQueue.filter((item) => item.id !== id);
  }
  function resumeQueue() {
    S.chatQueuePaused = false;
    void processQueue();
  }
  function sendChat() {
    if (plans.acceptingAnswer()) {
      void plans.answerCurrentQuestion();
      return;
    }
    if (S.chatMode === "plan" && !chatSpec())
      return toast(__t("계획을 작성할 명세를 선택하세요."));
    const draftKey = S.chatMode === "plan" ? "planDraft" : "draft";
    const message = S[draftKey].trim();
    if (
      (!message && !S.chatAttachments?.length) ||
      S.chatLoading ||
      S.chatUploading ||
      !S.w
    )
      return;
    if (!S.settings.model)
      return toast(__t("AI를 연결하고 모델을 선택하세요."));
    if (!S.busy && !S.chatQueue.some(sameScope)) S.chatQueuePaused = false;
    S.chatQueue.push({
      id: nextQueueId(),
      kind:
        S.chatMode === "plan" && planChatIntent(message) === "change"
          ? "plan"
          : "chat",
      intent: S.chatMode === "plan" ? "plan-discuss" : "chat",
      draftHtml:
        S.chatMode === "plan"
          ? plans.reviewDraftFor(chatSpec())?.html
          : undefined,
      attachments: (S.chatAttachments || []).map((a) => a.id),
      text: message || __t("첨부 자료를 분석해 주세요."),
      userId: S.user?.id,
      workspaceId: S.w.id,
      specId: chatSpec()?.id || null,
      threadId: S.chatThread?.id || null,
    });
    S[draftKey] = "";
    S.chatAttachments = [];
    S.chatSendVersion++;
    void processQueue();
  }
  watch(
    () => [S.busy, S.chatLoading, S.w?.id, chatSpec()?.id, S.chatThread?.id],
    () => {
      void processQueue();
    },
  );
  watch(
    () => S.user?.id,
    () => {
      // Restored by useChatDrafts for the new account.
      S.chatThread = null;
    },
  );
  watch(
    () => [S.chatMode, S.w?.id, chatSpec()?.id],
    () => {
      if (S.chatMode === "plan" && !S.busy) void plans.recover?.();
    },
  );
  async function processQueue() {
    if (S.busy || S.chatLoading || S.chatQueuePaused) return;
    const index = S.chatQueue.findIndex(
      (item) =>
        sameScope(item) &&
        !(item.kind === "plan" && plans.execution.value?.phase === "questions"),
    );
    if (index < 0) return;
    const [item] = S.chatQueue.splice(index, 1);
    const message = item.text;
    if (item.kind === "plan") {
      try {
        await plans.requestFromChat(message, item.specId, item.attachments);
      } catch (error) {
        S.chatQueuePaused = true;
        toast(error.message);
      } finally {
        void processQueue();
      }
      return;
    }
    S.busy = true;
    let responseReceived = false;
    let accepted = false;
    try {
      await projectSourceUI.beforeAI();
      if (!sameScope(item))
        throw new Error(__t("대화 위치가 바뀌어 전송을 보류했습니다."));
      if (!item.regenerateOf)
        S.messages.push({
          role: "user",
          text: message,
          at: new Date().toISOString(),
        });
      renderChat();
      const r = await aiFetch("/chat", {
        method: "POST",
        body: {
          base: S.w.head,
          workspaceId: item.workspaceId,
          specId: item.specId,
          threadId: item.threadId,
          regenerateOf: item.regenerateOf,
          attachments: item.attachments,
          intent: item.intent,
          draftHtml: item.draftHtml,
          message,
          selectedFiles: [],
        },
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error);
      }
      accepted = true;
      S.chatPreview = "";
      S.chatProgress = __t("AI에 요청을 보냈습니다…");
      let streamed = "",
        responseFormat = "structured";
      await consumeAI(
        r,
        async (e) => {
          toolEvent(e);
          if (e.type === "start") {
            responseFormat = e.responseFormat || "structured";
            if (e.threadId && sameScope(item)) {
              for (const queued of S.chatQueue)
                if (sameScope(queued)) queued.threadId = e.threadId;
              item.threadId = e.threadId;
              const pendingDraft = S.draft,
                pendingPlanDraft = S.planDraft,
                pendingAttachments = S.chatAttachments;
              S.chatThread = {
                id: e.threadId,
                workspaceId: item.workspaceId,
                specId: item.specId,
                title: S.chatThread?.title || message.slice(0, 80),
              };
              S.draft = pendingDraft;
              S.planDraft = pendingPlanDraft;
              S.chatAttachments = pendingAttachments;
              threads.remember(S.chatThread);
            }
          }
          if (e.type === "run") S.job = e.job;
          if (e.type === "delta") {
            streamed += e.text;
            const preview =
              responseFormat === "text"
                ? streamed
                : streamedChatMessage(streamed);
            if (Array.from(preview).length >= UI_CONFIG.streamPreviewMinChars)
              S.chatPreview = preview;
            S.chatProgress = S.chatPreview
              ? __t("응답 작성 중…")
              : __t("응답 작성 중 · {0}자", [Array.from(preview).length]);
          }
          if (e.type === "status") S.chatProgress = e.message;
          if (e.type === "error") throw Error(e.message);
          if (e.type === "answer") responseReceived = true;
        },
        {
          replay: () => {
            streamed = "";
            S.chatPreview = "";
            S.chatProgress = __t("작업에 다시 연결하고 있습니다…");
          },
        },
      );
      if (!responseReceived)
        throw new Error(__t("응답이 완료 전에 종료되었습니다."));
    } catch (e) {
      S.chatQueuePaused = true;
      if (!accepted) S.chatQueue.unshift(item);
      toast(e.message);
    } finally {
      S.chatProgress = "";
      S.job = null;
      S.toolApprovals = [];
      try {
        await loadChats();
      } catch (e) {
        S.chatQueuePaused = true;
        toast(e.message);
      } finally {
        S.chatPreview = "";
        S.busy = false;
        render();
      }
    }
  }
  async function recover(job) {
    if (recovering) return;
    recovering = true;
    S.busy = true;
    S.job = job.id;
    let raw = "",
      responseFormat = "structured";
    try {
      await consumeAI(
        await aiFetch(`/jobs/${job.id}/events`),
        (event) => {
          toolEvent(event);
          if (event.type === "start")
            responseFormat = event.responseFormat || "structured";
          if (event.type === "delta") {
            raw += event.text;
            S.chatPreview =
              responseFormat === "text" ? raw : streamedChatMessage(raw);
          }
          if (event.type === "status") S.chatProgress = event.message;
          if (event.type === "error") toast(event.message);
        },
        {
          replay: () => {
            raw = "";
            S.chatPreview = "";
          },
        },
      );
    } catch (error) {
      toast(error.message);
    } finally {
      S.busy = false;
      S.job = null;
      S.toolApprovals = [];
      S.chatPreview = "";
      S.chatProgress = "";
      await loadChats();
      recovering = false;
    }
  }
  function editMessage(message) {
    if (S.busy) return;
    openDialog(
      __t("메시지 수정 · 새 대화로 이어가기"),
      [
        field(__t("질문"), "message", message.text, "textarea", {
          required: true,
        }),
      ],
      async (form) => {
        const { thread } = await aiAPI(`/threads/${S.chatThread.id}/fork`, {
          method: "POST",
          body: { messageId: message.id },
        });
        await threads.selectThread(thread);
        S.draft = String(form.get("message"));
        S.chatAttachments = message.attachments || [];
        sendChat();
      },
      { save: __t("수정하고 전송") },
    );
  }
  function continueAnswer() {
    if (S.busy) return;
    const text = __t(
      "직전 답변이 중단된 부분부터 이어서 작성해 주세요. 이미 작성한 내용은 반복하지 마세요.",
    );
    if (S.chatMode === "plan") S.planDraft = text;
    else S.draft = text;
    sendChat();
  }
  function regenerateLast() {
    if (S.busy || S.chatLoading || !S.w || !S.chatThread) return;
    if (S.chatQueue.some(sameScope))
      return toast(__t("대기 메시지를 전송하거나 취소한 뒤 다시 요청하세요."));
    const last = S.messages.at(-1);
    const question = S.messages.findLast((message) => message.role === "user");
    if (!last?.id || !question) return;
    S.chatQueuePaused = false;
    S.chatQueue.push({
      id: nextQueueId(),
      text: question.text,
      userId: S.user.id,
      workspaceId: S.w.id,
      specId: chatSpec()?.id || null,
      threadId: S.chatThread.id,
      regenerateOf: last.id,
    });
    void processQueue();
  }
  return {
    attachmentUI,
    editMessage,
    continueAnswer,
    loadChats,
    serverSettings,
    serverChats,
    refreshModels,
    persistSettings,
    aiOptions,
    sendChat,
    cancelQueued,
    resumeQueue,
    openChatHistory: threads.openHistory,
    loadChatHistory: threads.loadHistory,
    newChat: threads.newChat,
    renameChat: threads.rename,
    deleteChat: threads.remove,
    previewChat: threads.preview,
    regenerateLast,
  };
}
