import { runtimeConfig as runtime } from "./runtime-config.mjs";
import { streamedChatMessage } from "../shared/chat-stream.mjs";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { problem } from "../shared/schema.mjs";

export function createChatRuns(store) {
  store.db.aiRuns ??= [];
  const live = new Map();
  for (const run of store.db.aiRuns)
    if (run.state === "running") {
      run.state = "interrupted";
      const start = run.events.find((e) => e.type === "start");
      const partial = (
        start?.responseFormat === "text"
          ? (value) => value
          : streamedChatMessage
      )(
        run.events
          .filter((e) => e.type === "delta")
          .map((e) => e.text)
          .join(""),
      );
      if (
        run.kind === "chat" &&
        run.threadId &&
        start?.userMessageId &&
        !store.db.chats.some((m) => m.responseTo === start.userMessageId)
      )
        store.db.chats.push({
          id: randomUUID(),
          role: "assistant",
          userId: run.userId,
          workspaceId: run.workspaceId,
          specId: run.specId,
          threadId: run.threadId,
          responseTo: start.userMessageId,
          text: partial,
          partial: true,
          status: "interrupted",
          error: "서버 재시작으로 중단된 응답입니다.",
          files: [],
          at: new Date().toISOString(),
        });
      run.events.push({
        type: "error",
        message:
          "서버 재시작으로 작업이 중단되었습니다. 저장된 부분 응답을 확인하고 다시 요청하세요.",
      });
    }
  const view = (run) => ({
    id: run.id,
    kind: run.kind,
    workspaceId: run.workspaceId,
    specId: run.specId,
    threadId: run.threadId,
    state: run.state,
    input: run.input,
    createdAt: run.createdAt,
  });
  function get(uid, id) {
    const run = store.db.aiRuns.find((r) => r.id === id && r.userId === uid);
    if (!run) throw problem("작업을 찾을 수 없습니다.", 404);
    store.workspace(run.workspaceId, uid);
    return run;
  }
  function latest(uid, wid, sid, kind) {
    store.workspace(wid, uid);
    return [...store.db.aiRuns]
      .reverse()
      .find(
        (r) =>
          r.userId === uid &&
          r.workspaceId === wid &&
          r.specId === sid &&
          (!kind || r.kind === kind),
      );
  }
  function attach(run, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
    });
    const send = (event) => {
      if (!res.destroyed) res.write("data: " + JSON.stringify(event) + "\n\n");
    };
    send({ type: "run", job: run.id, kind: run.kind });
    for (const event of run.events) send(event);
    const emitter = live.get(run.id);
    if (!emitter) {
      res.end();
      return;
    }
    const end = () => res.end();
    emitter.on("event", send);
    emitter.once("end", end);
    const keep = setInterval(() => {
      if (!res.destroyed) res.write(": keepalive\n\n");
    }, runtime.sseHeartbeatMs);
    res.on("close", () => {
      clearInterval(keep);
      emitter.off("event", send);
      emitter.off("end", end);
    });
  }
  async function start(kind, req, res, input, user, execute) {
    if (!user) throw problem("로그인이 필요합니다.", 401);
    if (store.db.aiRuns.some((r) => r.userId === user.id && live.has(r.id)))
      throw problem("진행 중인 응답을 먼저 마쳐 주세요.", 409);
    const run = {
      id: randomUUID(),
      kind,
      userId: user.id,
      workspaceId: input.workspaceId,
      specId: input.specId ?? null,
      threadId: input.threadId || null,
      input,
      state: "running",
      createdAt: new Date().toISOString(),
      events: [],
    };
    store.workspace(run.workspaceId, user.id);
    const emitter = new EventEmitter();
    live.set(run.id, emitter);
    const sink = new EventEmitter();
    let attached = false,
      buffer = "",
      timer;
    sink.destroyed = false;
    sink.jobId = run.id;
    sink.writeHead = () => {
      if (!attached) {
        attached = true;
        store.db.aiRuns.push(run);
        attach(run, res);
      }
    };
    const persist = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await store.persist();
        } catch {}
      }, runtime.runPersistDebounceMs);
      timer.unref?.();
    };
    sink.write = (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const line = frame.split("\n").find((s) => s.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.threadId) run.threadId = event.threadId;
        // Merge adjacent deltas for bounded event overhead; retain partial output on disk.
        const last = run.events.at(-1);
        if (
          event.type === "delta" &&
          last?.type === "delta" &&
          event.call === last.call &&
          event.stage === last.stage
        )
          last.text += event.text;
        else
          run.events.push(
            event.type === "answer" && event.workspace
              ? { ...event, workspace: undefined }
              : event,
          );
        emitter.emit("event", event);
        persist();
      }
      return true;
    };
    sink.end = () => {};
    try {
      await execute(req, sink, input, user);
    } catch (error) {
      if (!attached) throw error;
      sink.write(
        "data: " +
          JSON.stringify({
            type: "error",
            message:
              error.status && error.status < 500
                ? error.message
                : "응답을 완료하지 못했습니다. 다시 요청하세요.",
          }) +
          "\n\n",
      );
    } finally {
      clearTimeout(timer);
      if (attached) {
        run.state = run.events.some((e) => e.type === "error")
          ? "failed"
          : run.events.some((e) => e.type === "plan-questions")
            ? "questions"
            : run.kind === "plan" &&
                run.events.some(
                  (e) =>
                    e.type === "plan-loop" &&
                    e.stopReason &&
                    e.stopReason !== "target_met",
                )
              ? "paused"
              : "completed";
        run.endedAt = new Date().toISOString();
        // Retain the latest 20 jobs per user; saved conversations/plans are separate.
        const old = store.db.aiRuns
          .filter((r) => r.userId === user.id && r.state !== "running")
          .slice(0, -20);
        store.db.aiRuns = store.db.aiRuns.filter((r) => !old.includes(r));
        await store.persist();
      }
      live.delete(run.id);
      emitter.emit("end");
    }
  }
  return { start, attach, get, latest, view };
}
