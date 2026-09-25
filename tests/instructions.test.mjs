import test from "node:test";
import assert from "node:assert/strict";
import { selectInstructions } from "../shared/instructions.mjs";
import { validateDocument } from "../shared/schema.mjs";
import { sample } from "./fixtures.mjs";
import { renderMarkdown } from "../public/markdown.js";
import { claudeEnvironment } from "../server/claude-code.mjs";
import { claudeModels, runClaude } from "../server/claude.mjs";
const item = (id, scope, trigger, keywords = []) => ({
  id,
  name: id,
  description: "설명",
  content: "지침",
  scope,
  trigger,
  keywords,
  enabled: true,
});
test("skills select by command or transparent keywords without a target field", () => {
  const p = {
    skills: [
      item("common", "all", "always"),
      item("java", "code", "auto", ["java"]),
      item("review", "code", "manual"),
    ],
  };
  assert.deepEqual(
    selectInstructions(p, { role: "discuss", message: "hello" }).map(
      (x) => x.id,
    ),
    ["common"],
  );
  assert.deepEqual(
    selectInstructions(p, {
      role: "discuss",
      message: "$review Java 확인",
    }).map((x) => x.id),
    ["common", "java", "review"],
  );
  assert.throws(
    () => selectInstructions(p, { message: "/missing" }),
    /찾을 수/,
  );
  p.skills[2].enabled = false;
  assert.throws(
    () => selectInstructions(p, { message: "/review" }),
    /비활성화/,
  );
});
test("legacy rules migrate losslessly to skills and remove scope", () => {
  const d = sample();
  d.projectSpec.rules = [item("legacy", "code", "always")];
  d.projectSpec.skills = [item("new", "spec", "manual")];
  const next = validateDocument(d);
  assert.equal(next.projectSpec.rules, undefined);
  assert.equal(next.projectSpec.instructions, "");
  assert.equal(next.projectSpec.skills[0].content, "지침");
  assert(next.projectSpec.skills.every((x) => !("scope" in x)));
  assert.deepEqual(validateDocument(next), next);
});
test("instruction storage validates collisions and preserves genuinely empty projects", () => {
  const d = sample();
  d.specs = [];
  d.projectSpec.rules = [item("rule", "all", "always")];
  d.projectSpec.skills = [];
  assert.equal(validateDocument(d).specs.length, 0);
  d.projectSpec.skills.push(item("rule", "code", "manual"));
  assert.throws(() => validateDocument(d), /중복/);
});
test("chat formats code and lists without executing user HTML", () => {
  const html = renderMarkdown(
    '## 제목\n- **첫째**\n- 둘째\n```java\nString s = "<script>";\n```\n<img src=x onerror=alert(1)>',
  );
  assert(html.includes("<ul>"));
  assert(html.includes("<strong>첫째</strong>"));
  assert(html.includes('class="code-block"'));
  assert(!html.includes("<script>"));
  assert(!html.includes("<img"));
  assert(html.includes("&lt;img"));
});
test("Claude Code receives only this user token; other providers are not inherited", () => {
  const before = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "other-user-secret";
  try {
    const env = claudeEnvironment("/tmp/personal-claude", "own-token");
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "own-token");
    assert.equal(env.CLAUDE_CONFIG_DIR, "/tmp/personal-claude");
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = before;
  }
});
test("Claude API obtains real catalog capabilities and streams structured output", async () => {
  const models = await claudeModels("personal", {
    request: async (url, opts) => {
      assert.equal(opts.headers["x-api-key"], "personal");
      return Response.json({
        data: [
          {
            id: "test-claude",
            display_name: "Test",
            capabilities: {
              effort: { supported: true, high: { supported: true } },
              structured_outputs: { supported: true },
            },
          },
        ],
        has_more: false,
      });
    },
  });
  assert.equal(models[0].supportedReasoningEfforts[0].reasoningEffort, "high");
  const resultText = JSON.stringify({
    message: "완료",
    proposal: null,
    files: [],
  });
  const events = [];
  const result = await runClaude({
    key: "personal",
    prompt: "hello",
    model: "test-claude",
    effort: "high",
    onEvent: (e) => events.push(e),
    request: async (url, opts) => {
      const body = JSON.parse(opts.body);
      assert.equal(body.output_config.effort, "high");
      assert.equal(body.output_config.format.type, "json_schema");
      return new Response(
        [
          {
            type: "content_block_delta",
            delta: { type: "text_delta", text: resultText },
          },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 20 },
          },
          { type: "message_stop" },
        ]
          .map((x) => "data: " + JSON.stringify(x) + "\n\n")
          .join(""),
      );
    },
  });
  assert.equal(result.text, resultText);
  assert.equal(events[0].type, "delta");
});

test("Markdown links allow web destinations and escape content without executable schemes", () => {
  const safe = renderMarkdown("[문서](https://example.com/page?q=1&x=2)");
  assert(safe.includes('href="https://example.com/page?q=1&amp;x=2"'));
  assert(safe.includes("noopener noreferrer"));
  for (const value of [
    "[실행](javascript:alert(1))",
    "[실행](data:text/html,x)",
    "[<img src=x>](https://example.com)",
  ]) {
    const result = renderMarkdown(value);
    assert(!result.includes('href="javascript:'));
    assert(!result.includes('href="data:'));
    assert(!result.includes("<img"));
  }
});
