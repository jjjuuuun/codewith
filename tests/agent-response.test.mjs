import test from "node:test";
import assert from "node:assert/strict";
import { agentResponse, codeMarkdown } from "../shared/agent-response.mjs";

test("session responses decode nested JSON while preserving actual code escapes", () => {
  const code =
    '```js\nconst regex = /\\r?\\n/;\nconst path = "C:\\\\repo";\n```';
  const raw = JSON.stringify({
    message: "설명\n다음 줄",
    files: [
      {
        path: "R.html",
        content: JSON.stringify({ after: code, implementation: "구현\n내용" }),
      },
    ],
  });
  const result = agentResponse(raw);
  assert.equal(result.message, "설명\n다음 줄");
  assert.equal(result.files[0].content.after, code);
  assert.equal(
    agentResponse("```json\n" + raw + "\n```").files[0].content.after,
    code,
  );
  const partial = agentResponse(
    raw.slice(0, raw.indexOf("implementation") - 3),
  );
  assert.equal(partial.incomplete, true);
  assert.deepEqual(partial.files, []);
});
test("streaming messages and reviews remain readable; malformed output stays safe", () => {
  assert.equal(
    agentResponse('{"message":"hello\\nworld', { complete: false }).pending,
    true,
  );
  assert.equal(agentResponse("plain text").message, "plain text");
  const markdown = "```js\nconst value = 1;\n```";
  assert.equal(agentResponse(markdown).message, markdown);
  assert.equal(agentResponse('{"files":[null]}').files.length, 0);
  const review = agentResponse(
    JSON.stringify({
      files: [
        {
          path: "review.json",
          content: JSON.stringify({
            candidates: [{ id: "A", scores: { quality: 8.25 } }],
          }),
        },
      ],
    }),
  );
  assert.equal(review.files[0].content.candidates[0].scores.quality, 8.25);
  assert(
    codeMarkdown("```html\n<script>alert(1)</script>\n```", "html").startsWith(
      "````html",
    ),
  );
});

test("structured output reveals only finished fields and file blocks", () => {
  const file = {
    path: "R.html",
    content: JSON.stringify({ after: '```js\nconst a = "\\n";\n```' }),
  };
  const prefix = '{"message":"완료된 설명","files":[' + JSON.stringify(file);
  const result = agentResponse(
    prefix + ',{"path":"next.html","content":"unfinished',
    { complete: false },
  );
  assert.equal(result.message, "완료된 설명");
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].content.after, JSON.parse(file.content).after);
  assert.equal(result.pending, true);
  assert.equal(
    agentResponse('{"message":"미완성', { complete: false }).message,
    "",
  );
});
test("code fences are displayed block by block while ordinary text streams", () => {
  const first = "설명\n\n```js\nconst a = 1;\n```\n";
  assert.equal(
    agentResponse(first + "\n```html\n<div", { complete: false }).message,
    first + "\n",
  );
  assert.equal(agentResponse(first, { complete: false }).message, first);
  assert.equal(
    agentResponse("일반 문장 작성 중", { complete: false }).message,
    "일반 문장 작성 중",
  );
  assert.equal(
    agentResponse("~~~js\nconst a = 1;", { complete: false }).message,
    "",
  );
});

test("untyped code fences are not treated as JSON and unfinished final fences stay hidden", () => {
  const code = "```\nconst a = 1;\n```";
  assert.equal(agentResponse(code, { complete: false }).message, code);
  const result = agentResponse("설명\n```js\nconst", { complete: true });
  assert.equal(result.message, "설명\n");
  assert.equal(result.incomplete, true);
});

test("Markdown links remain ordinary streamed text", () => {
  const text = "[문서](https://example.com)";
  assert.equal(agentResponse(text, { complete: false }).message, text);
  assert.equal(
    agentResponse('[{"title":"partial', { complete: false }).pending,
    true,
  );
});

test("commentary before a plan envelope never exposes raw JSON", () => {
  const prefix = "요구사항을 검토하고 계획을 작성하겠습니다.\n\n";
  const partial =
    '{\n"message": "11개 요구사항의 구현 구조를 작성했습니다.\\n\\n사용된 Skill", "specProposal": null, "proposal": null, "files": [{';
  for (const leader of [prefix, prefix + "```json\n", "진행 설명"]) {
    const result = agentResponse(leader + partial, { complete: false });
    assert.equal(
      result.message,
      "11개 요구사항의 구현 구조를 작성했습니다.\n\n사용된 Skill",
    );
    assert.deepEqual(result.files, []);
    assert.equal(result.pending, true);
  }
  for (const suffix of ["{", '{\n"mess', '{\n"message":']) {
    const result = agentResponse(prefix + suffix, { complete: false });
    assert(!result.message.includes("{"));
    assert.equal(result.pending, true);
  }
  assert.equal(
    agentResponse(prefix + '```json\n{"message":"완료","files":[]}\n```')
      .message,
    "완료",
  );
});

test("invalid nested plan JSON is marked instead of displayed as HTML code", () => {
  const result = agentResponse(
    JSON.stringify({
      message: "계획",
      files: [{ path: "R.html", content: '{"implementation":"broken"' }],
    }),
  );
  assert.equal(result.files[0].incomplete, true);
});
