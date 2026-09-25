import { watch } from "vue";
export function useChatDrafts(S) {
  let current = "";
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  const key = () =>
    S.user?.id && S.w?.id
      ? `codewith.draft:${S.user.id}:${S.w.id}:${S.specId || "workspace"}:${S.chatMode}:${S.chatThread?.id || "new"}`
      : "";
  const save = () => {
    if (current)
      write(current, {
        text: S.chatMode === "plan" ? S.planDraft : S.draft,
        attachments: S.chatAttachments || [],
      });
  };
  watch(
    key,
    (next, old) => {
      // Text watchers save the old scope before a navigation changes the key.
      current = next;
      const value = read(next, { text: "", attachments: [] });
      if (S.chatMode === "plan") S.planDraft = value.text;
      else S.draft = value.text;
      S.chatAttachments = value.attachments || [];
    },
    { flush: "sync", immediate: true },
  );
  watch(() => [S.draft, S.planDraft, S.chatAttachments], save, {
    deep: true,
    flush: "sync",
  });
  watch(
    () => S.user?.id,
    (uid) => {
      S.chatQueue = uid ? read(`codewith.queue:${uid}`, []) : [];
      S.chatQueuePaused = !!S.chatQueue.length;
    },
    { immediate: true },
  );
  watch(
    () => S.chatQueue,
    (queue) => {
      if (S.user?.id) write(`codewith.queue:${S.user.id}`, queue);
    },
    { deep: true, flush: "sync" },
  );
  return { save };
}
