import { chatMessageText } from "../shared/chat-proposal.mjs";
import { randomBytes } from "node:crypto";
import { problem } from "../shared/schema.mjs";

const now = () => new Date().toISOString();
const threadId = () => "chat_" + randomBytes(12).toString("hex");

export function migrateChatThreads(db) {
  db.chatThreads ??= [];
  const legacy = new Map();
  for (const message of db.chats) {
    if (message.threadId) continue;
    const key = JSON.stringify([
      message.userId,
      message.workspaceId,
      message.specId ?? null,
    ]);
    let thread = legacy.get(key);
    if (!thread) {
      thread = {
        id: threadId(),
        userId: message.userId,
        workspaceId: message.workspaceId,
        specId: message.specId ?? null,
        title: message.text?.trim().slice(0, 80) || "이전 대화",
        createdAt: message.at || now(),
        updatedAt: message.at || now(),
      };
      legacy.set(key, thread);
      db.chatThreads.push(thread);
    }
    message.threadId = thread.id;
    thread.updatedAt = message.at || thread.updatedAt;
  }
}

export function createChatThreads(store) {
  function get(uid, id) {
    const thread = store.db.chatThreads.find(
      (t) => t.id === id && t.userId === uid && !t.deletedAt,
    );
    if (!thread) throw problem("대화를 찾을 수 없습니다.", 404);
    store.workspace(thread.workspaceId, uid);
    return thread;
  }
  function messages(thread) {
    return store.db.chats.filter(
      (m) =>
        m.threadId === thread.id &&
        m.userId === thread.userId &&
        m.workspaceId === thread.workspaceId,
    );
  }
  function list(uid, wid) {
    store.workspace(wid, uid);
    migrateChatThreads(store.db);
    return store.db.chatThreads
      .filter((t) => t.userId === uid && t.workspaceId === wid && !t.deletedAt)
      .reverse()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((thread) => {
        const items = messages(thread);
        return {
          ...thread,
          count: items.length,
          preview: chatMessageText(items.at(-1)).slice(0, 160),
          searchText: items.map(chatMessageText).join("\n"),
        };
      });
  }
  function create(uid, wid, sid = null) {
    const workspace = store.workspace(wid, uid);
    if (sid && !workspace.document.specs.some((s) => s.id === sid))
      throw problem("명세를 찾을 수 없습니다.", 404);
    const thread = {
      id: threadId(),
      userId: uid,
      workspaceId: wid,
      specId: sid,
      title: "새 대화",
      createdAt: now(),
      updatedAt: now(),
    };
    store.db.chatThreads.push(thread);
    return thread;
  }
  function resolve(uid, wid, sid, id) {
    if (id) {
      const thread = get(uid, id);
      if (thread.workspaceId !== wid || thread.specId !== sid)
        throw problem("대화의 워크스페이스와 명세를 확인하세요.", 400);
      return thread;
    }
    const latest = list(uid, wid).find((t) => t.specId === sid);
    return latest ? get(uid, latest.id) : null;
  }
  async function fork(uid, id, messageId) {
    const source = get(uid, id),
      items = messages(source),
      at = items.findIndex((m) => m.id === messageId);
    if (at < 0) throw problem("메시지를 찾을 수 없습니다.", 404);
    const thread = create(uid, source.workspaceId, source.specId);
    thread.title = (source.title + " · 분기").slice(0, 120);
    thread.parentThreadId = id;
    const prefix = items.slice(0, at);
    const ids = new Map(prefix.map((item) => [item.id, threadId()]));
    for (const item of prefix)
      store.db.chats.push({
        ...structuredClone(item),
        id: ids.get(item.id),
        ...(item.responseTo ? { responseTo: ids.get(item.responseTo) } : {}),
        ...(item.regeneratedFrom
          ? { regeneratedFrom: ids.get(item.regeneratedFrom) }
          : {}),
        threadId: thread.id,
        originalMessageId: item.id,
      });
    await store.persist();
    return thread;
  }
  async function rename(uid, id, title) {
    const thread = get(uid, id);
    if (typeof title !== "string" || !title.trim() || title.length > 120)
      throw problem("대화 이름은 1~120자로 작성하세요.");
    thread.title = title.trim();
    thread.renamed = true;
    await store.persist();
    return thread;
  }
  async function remove(uid, id) {
    const thread = get(uid, id);
    thread.deletedAt = now();
    await store.persist();
  }
  return { get, messages, list, create, resolve, rename, remove, fork };
}
