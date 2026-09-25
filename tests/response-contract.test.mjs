import test from "node:test";
import assert from "node:assert/strict";
import { parseResponseJSON } from "../shared/response-json.mjs";
import { agentResponse } from "../shared/agent-response.mjs";
import { streamedChatMessage } from "../shared/chat-stream.mjs";
import { parseAnswer } from "../server/ai.mjs";
import { planQuestions } from "../server/plan-questions.mjs";
import { renderPlanHTML, PLAN_FIELDS } from "../shared/plans.mjs";
import { planResponseSchema } from "../shared/plan-response-schema.mjs";

test("object plans and legacy/fenced JSON preserve code and render identically", () => {
  const content = Object.fromEntries(
    PLAN_FIELDS.map((k) => [k, k === "mockup" ? "" : "내용"]),
  );
  content.after =
    '```js\nconst x = "C:\\\\repo";\nconst regex = /\\r?\\n/;\n```';
  const spec = {
    title: "명세",
    requirements: [{ id: "R", title: "요구사항" }],
  };
  const expected = renderPlanHTML(spec, [{ path: "R.html", content }]);
  for (const value of [
    content,
    JSON.stringify(content),
    "```json\n" + JSON.stringify(content) + "\n```",
  ]) {
    const files = [{ path: "R.html", content: value }];
    assert.equal(renderPlanHTML(spec, files), expected);
    assert.equal(
      agentResponse(JSON.stringify({ message: "완료", files })).files[0].content
        .after,
      content.after,
    );
  }
  assert.throws(
    () =>
      renderPlanHTML(spec, [
        { path: "R.html", content: '{"after":"truncated' },
      ]),
    /JSON 문법/,
  );
  assert.throws(
    () =>
      renderPlanHTML(spec, [{ path: "R.html", content: { after: "partial" } }]),
    /필수 섹션/,
  );
});
test("chat and planning share envelope decoding without exposing transport markup", () => {
  const answer = {
    message: '설명\n```js\nconst s = "x";\n```',
    proposal: null,
    files: [],
  };
  for (const text of [
    JSON.stringify(answer),
    "```json\n" + JSON.stringify(answer) + "\n```",
    "진행 상황\n" + JSON.stringify(answer),
  ]) {
    assert.deepEqual(parseResponseJSON(text), answer);
    assert.equal(parseAnswer(text, "discuss").message, answer.message);
    assert.equal(agentResponse(text).message, answer.message);
    assert.equal(streamedChatMessage(text), answer.message);
  }
  assert.equal(streamedChatMessage("일반 Markdown 응답"), "일반 Markdown 응답");
  assert.equal(
    agentResponse('{"message":"unfinished', { complete: false }).message,
    "",
  );
  assert.equal(streamedChatMessage('{"message":"unfinished'), "unfinished");
});
test("draft, review and questions use typed objects, with legacy questions accepted", () => {
  for (const review of [false, true]) {
    const choices =
      planResponseSchema(review).properties.files.items.properties.content
        .anyOf;
    assert.deepEqual(
      choices[0].required,
      review ? ["candidates"] : PLAN_FIELDS,
    );
    assert.deepEqual(choices[1].required, ["questions"]);
  }
  for (const content of [
    { questions: ["질문"] },
    JSON.stringify({ questions: ["질문"] }),
  ])
    assert.deepEqual(
      planQuestions({ files: [{ path: "questions.json", content }] }),
      ["질문"],
    );
});
