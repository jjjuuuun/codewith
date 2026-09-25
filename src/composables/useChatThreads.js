import { t as __t } from "../i18n/index.js";
import { chatMessageText } from "../../shared/chat-proposal.mjs";
import { h } from "vue";
import { aiAPI } from "../services/api.js";
import { btn, field } from "../services/form-fields.js";
import { date } from "../services/format.js";
import MarkdownContent from "../components/MarkdownContent.vue";
import ChatHistoryList from "../components/ChatHistoryList.vue";

export function useChatThreads({
  S,
  chatSpec,
  openDialog,
  modal,
  syncRoute,
  loadChats,
  render,
  toast,
}) {
  const scopeKey = (wid, sid) =>
    `codewith.chat:${S.user?.id}:${wid}:${sid || "workspace"}`;
  const remember = (thread) => {
    try {
      sessionStorage.setItem(
        scopeKey(thread.workspaceId, thread.specId),
        thread.id,
      );
    } catch {}
  };
  function selected(wid, sid) {
    try {
      return sessionStorage.getItem(scopeKey(wid, sid));
    } catch {
      return null;
    }
  }
  async function fetchChats(wid, sid, requested) {
    if (!wid) return { thread: null, messages: [] };
    const id = requested || selected(wid, sid);
    const url = `/chats?workspace=${encodeURIComponent(wid)}${sid ? "&spec=" + encodeURIComponent(sid) : ""}`;
    let result;
    try {
      result = await aiAPI(
        url + (id ? "&thread=" + encodeURIComponent(id) : ""),
      );
    } catch (error) {
      if (!id || requested || error.status !== 404) throw error;
      result = await aiAPI(url);
    }
    if (result.thread) remember(result.thread);
    return result;
  }
  async function openHistory() {
    const wid = S.w?.id;
    if (!wid) return;
    const { threads } = await aiAPI(
      `/threads?workspace=${encodeURIComponent(wid)}`,
    );
    if (S.w?.id !== wid) return;
    openDialog(
      __t("이전 대화"),
      [
        h(ChatHistoryList, {
          threads: threads.map((thread) => {
            const spec = S.w.document.specs.find((s) => s.id === thread.specId);
            return {
              ...thread,
              scope: thread.specId
                ? spec?.title || __t("삭제된 명세")
                : __t("워크스페이스 전체"),
              unavailable: !!thread.specId && !spec,
            };
          }),
        }),
      ],
      null,
      { wide: true },
    );
  }
  async function selectThread(thread) {
    S.chatLoading = true;

    S.chatThread = thread;
    remember(thread);
    S.specId = thread.specId;
    S.view = thread.specId ? "spec" : "workspace";
    S.tab = "requirements";
    S.messages = [];
    modal.close();
    syncRoute();
    await loadChats(thread.id);
    render();
  }
  async function loadHistory(sid, id) {
    if (S.busy || S.chatLoading)
      return toast(__t("응답을 완료하거나 중지한 뒤 대화를 불러오세요."));
    const { thread } = await aiAPI(`/threads/${encodeURIComponent(id)}`);
    if (thread.workspaceId !== S.w?.id) return;
    if (
      thread.specId &&
      !S.w.document.specs.some((s) => s.id === thread.specId)
    )
      return toast(__t("삭제된 명세의 대화는 미리보기로 확인하세요."));
    await selectThread(thread);
  }
  async function newChat() {
    if (S.busy || S.chatLoading || !S.w) return;
    const wid = S.w.id,
      sid = chatSpec()?.id || null;
    S.chatLoading = true;
    try {
      const { thread } = await aiAPI("/threads", {
        method: "POST",
        body: { workspaceId: wid, specId: sid },
      });
      if (S.w?.id === wid && (chatSpec()?.id || null) === sid)
        await selectThread(thread);
    } finally {
      S.chatLoading = false;
    }
  }
  async function preview(id) {
    const { thread, messages } = await aiAPI(
      `/threads/${encodeURIComponent(id)}`,
    );
    openDialog(
      thread.title,
      messages.length
        ? messages.map((message) =>
            h("div", { class: "bubble " + message.role }, [
              h(
                "small",
                {},
                (message.role === "user" ? __t("나") : "AI") +
                  " · " +
                  date(message.at),
              ),
              h(MarkdownContent, { text: chatMessageText(message) }),
            ]),
          )
        : [h("p", {}, __t("아직 메시지가 없습니다."))],
      null,
      { wide: true, footerStart: btn("chat-history", __t("목록"), "small") },
    );
  }
  async function rename(id) {
    const { thread } = await aiAPI(`/threads/${encodeURIComponent(id)}`);
    openDialog(
      __t("대화 이름 변경"),
      [
        field(__t("대화 이름"), "chatTitle", thread.title, "input", {
          required: true,
          maxlength: "120",
        }),
      ],
      async (form) => {
        const result = await aiAPI(`/threads/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { title: form.get("chatTitle") },
        });
        if (S.chatThread?.id === id) S.chatThread = result.thread;
        toast(__t("대화 이름을 변경했습니다."));
      },
    );
  }
  async function remove(id) {
    const { thread } = await aiAPI(`/threads/${encodeURIComponent(id)}`);
    openDialog(
      __t("대화를 삭제할까요?"),
      [
        h("p", {}, thread.title),
        h(
          "p",
          { class: "muted" },
          __t(
            "대화 목록과 AI 문맥에서 제외합니다. 이 대화에서 추가한 명세와 프로젝트 파일은 유지됩니다.",
          ),
        ),
      ],
      async () => {
        await aiAPI(`/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
        for (const key of Object.keys(localStorage))
          if (
            key.startsWith(`codewith.draft:${S.user.id}:`) &&
            key.endsWith(":" + id)
          )
            localStorage.removeItem(key);
        S.chatQueue = S.chatQueue.filter((item) => item.threadId !== id);
        try {
          if (selected(thread.workspaceId, thread.specId) === id)
            sessionStorage.removeItem(
              scopeKey(thread.workspaceId, thread.specId),
            );
        } catch {}
        if (S.chatThread?.id === id) {
          S.chatThread = null;
          S.draft = "";
          await loadChats();
        }
        toast(__t("대화를 삭제했습니다."));
      },
      { save: __t("삭제") },
    );
  }
  return {
    selectThread,
    fetchChats,
    remember,
    newChat,
    openHistory,
    loadHistory,
    preview,
    rename,
    remove,
  };
}
