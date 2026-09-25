import { t as __t } from "../i18n/index.js";
import { UI_CONFIG } from "../config/ui.js";
import { aiFetch } from "./api.js";

const connectionError = () =>
  Object.assign(
    new Error(
      __t(
        "서버 연결이 끊겨 작업 상태를 확인할 수 없습니다. 서버와 네트워크 연결을 확인한 후 다시 연결하세요. 서버에서는 작업이 계속 진행 중일 수 있습니다.",
      ),
    ),
    { network: true },
  );

// Reconnect to the same server job, never re-submit the model request.
export async function consumeAI(
  response,
  onEvent,
  {
    replay = () => {},
    request = aiFetch,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  let job = null,
    tries = 0;
  while (true) {
    let buffer = "",
      ended = false;
    try {
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let at;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const raw = frame.split("\n").find((s) => s.startsWith("data: "));
          if (!raw) continue;
          const event = JSON.parse(raw.slice(6));
          if (["error", "status"].includes(event.type) && event.message)
            event.message = __t(event.message);
          if (event.type === "run") job = event.job;
          if (["answer", "error", "plan-questions"].includes(event.type))
            ended = true;
          await onEvent(event);
        }
      }
      if (ended) return;
    } catch (error) {
      if (ended) throw error;
    }
    if (!job) throw connectionError();
    let connected = false;
    while (tries < UI_CONFIG.streamReconnectAttempts && !connected) {
      await delay(UI_CONFIG.streamReconnectDelayMs * ++tries);
      try {
        response = await request(`/jobs/${job}/events`);
        connected = true;
      } catch (error) {
        if (error.status || error.name === "AbortError") throw error;
      }
    }
    if (!connected) throw connectionError();
    await replay();
  }
}
