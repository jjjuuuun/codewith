import test from "node:test";
import assert from "node:assert/strict";
import { runChatAnswer } from "../server/chat-answer.mjs";
import {
  requestedProposal,
  chatMessageText,
} from "../shared/chat-proposal.mjs";
import { buildPrompt } from "../server/ai.mjs";
import { sample } from "./fixtures.mjs";

const requirement = {
  title: "알림 끄기",
  body: "알림을 끄면 메일을 발송하지 않는다.",
  criteria: ["비활성 상태에서는 메일이 발송되지 않는다."],
};
const response = (fields = {}) => ({
  message: "일반 답변",
  proposal: null,
  specProposal: null,
  files: [],
  ...fields,
});

test("short creation requests distinguish specs, requirements and ordinary questions", () => {
  for (const text of [
    "명세 추가해줘",
    "이걸 명세로 만들어줘",
    "새 명세 작성 부탁해",
    "명세 추가",
  ])
    assert.equal(requestedProposal(text, true), "specProposal", text);
  assert.equal(requestedProposal("요구사항 추가해줘", true), "proposal");
  assert.equal(requestedProposal("요구사항 추가해줘", false), "specProposal");
  for (const text of [
    "명세 추가하지 마",
    "명세 추가는 어떻게 해?",
    "명세 추가해줘 했는데 안되네",
    "요구사항을 설명해줘",
    "명세 추가 말고 설명해줘",
  ])
    assert.equal(requestedProposal(text, true), null, text);
});

test("missing proposal is repaired once with conversation context and without duplicate prose", async () => {
  const calls = [],
    events = [];
  const answer = await runChatAnswer({
    run: async (options) => {
      calls.push(options);
      options.onEvent({ type: "delta", text: "중복 설명" });
      return {
        text: JSON.stringify(
          response(
            calls.length === 2
              ? {
                  specProposal: {
                    title: "알림 설정",
                    requirements: [requirement],
                  },
                }
              : {},
          ),
        ),
      };
    },
    options: {
      prompt: "앞선 대화: 알림을 끄는 기능",
      onEvent: (e) => events.push(e),
    },
    message: "명세 추가해줘",
    scoped: true,
  });
  assert.equal(calls.length, 2);
  assert(calls[1].prompt.includes("앞선 대화: 알림을 끄는 기능"));
  assert.equal(answer.message, "");
  assert.equal(answer.specProposal.requirements[0].title, requirement.title);
  assert(!events.some((e) => e.type === "delta"));
});

test("valid requirement needs one call; insufficient context asks a question without looping", async () => {
  let calls = 0;
  const answer = await runChatAnswer({
    run: async () => {
      calls++;
      return { text: JSON.stringify(response({ proposal: requirement })) };
    },
    options: {},
    message: "요구사항 추가해줘",
    scoped: true,
  });
  assert.equal(calls, 1);
  assert.equal(answer.message, "");
  calls = 0;
  const missing = await runChatAnswer({
    run: async () => {
      calls++;
      return {
        text: JSON.stringify(
          response({ message: "어떤 기능을 명세로 작성할까요?" }),
        ),
      };
    },
    options: {},
    message: "명세 추가해줘",
    scoped: false,
  });
  assert.equal(calls, 2);
  assert.equal(missing.specProposal, null);
  assert(missing.message.includes("어떤 기능"));
});

test("proposal-only responses remain readable in copied text and subsequent prompts", () => {
  const message = {
    role: "assistant",
    text: "",
    specProposal: { title: "알림 설정", requirements: [requirement] },
  };
  const text = chatMessageText(message);
  assert(text.includes("# 알림 설정"));
  assert(text.includes(requirement.body));
  assert(text.includes(requirement.criteria[0]));
  const prompt = buildPrompt({
    document: sample(),
    specId: null,
    role: "discuss",
    message: "명세 추가해줘",
    history: [message],
    selectedFiles: [],
  });
  assert(prompt.includes(requirement.body));
});
