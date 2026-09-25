import test from "node:test";
import assert from "node:assert/strict";
import { streamedChatMessage } from "../shared/chat-stream.mjs";

test("partial chat JSON shows only decoded message content across chunk boundaries", () => {
  const message =
    '## 제목\n"따옴표"와 \\경로, 한글 😀\n```js\nconst a = 1;\n```';
  const raw = JSON.stringify({
    proposal: { title: "hidden", body: "message" },
    message,
    files: [],
  });
  for (let i = 0; i <= raw.length; i++) {
    const preview = streamedChatMessage(raw.slice(0, i));
    assert(message.startsWith(preview), JSON.stringify(preview));
    assert(!preview.includes("hidden"));
  }
  assert.equal(streamedChatMessage(raw), message);
  assert.equal(
    streamedChatMessage('```json\n{"message":"hello\\uD83D'),
    "hello",
  );
  assert.equal(
    streamedChatMessage('{"message":"hello\\uD83D\\uDE00"}'),
    "hello😀",
  );
  assert.equal(streamedChatMessage('{"files":[{"content":"secret"}]}'), "");
});
