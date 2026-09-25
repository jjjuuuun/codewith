import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS } from "../shared/config.mjs";
import {
  renderPlanHTML,
  validatePlanHTML,
  securePlanHTML,
  PLAN_FIELDS,
} from "../shared/plans.mjs";
import { renderPlanMarkdown } from "../server/plan-renderer.mjs";
import { planFailure } from "../server/plan-failure.mjs";
import { runPlanWorkflow } from "../server/plan-workflow.mjs";
import { validatePlanSettings } from "../shared/plan-workflow.mjs";
const fields = () =>
  Object.fromEntries(
    PLAN_FIELDS.map((key) => [
      key,
      key === "mockup" ? "" : "구체적인 구현 및 검증 설명",
    ]),
  );
test("highlighted plans can exceed 200k rendered characters without truncating source", () => {
  const content = fields();
  content.after =
    "```javascript\n" +
    Array.from({ length: 2200 }, (_, i) => `const value${i} = ${i};`).join(
      "\n",
    ) +
    "\n```";
  const files = [{ path: "R.html", content }];
  assert(JSON.stringify(files).length < LIMITS.planSourceChars);
  const html = renderPlanHTML(
    { title: "크기 검증", requirements: [{ id: "R", title: "완전한 코드" }] },
    files,
    renderPlanMarkdown,
  );
  assert(html.length > 200000);
  assert(html.includes("value2199"));
  assert(html.includes("hljs-keyword"));
  assert.equal(validatePlanHTML(securePlanHTML(html)), securePlanHTML(html));
});
test("source and rendered limits are independent and storage errors are classified precisely", async () => {
  const requirements = Array.from({ length: 4 }, (_, i) => ({
    id: `R${i}`,
    title: "범위",
  }));
  const files = requirements.map((r) => ({
    path: r.id + ".html",
    content: { ...fields(), implementation: "내용".repeat(30000) },
  }));
  assert.throws(
    () => renderPlanHTML({ title: "원문 한도", requirements }, files),
    /전체 원문 한도/,
  );
  const large =
    "<html><body>" + "x".repeat(LIMITS.planHtmlChars) + "</body></html>";
  let failure;
  try {
    validatePlanHTML(large);
  } catch (error) {
    failure = error;
  }
  assert.equal(failure.code, "plan_document_size");
  assert.match(failure.message, /2,000,000/);
  assert.equal(planFailure(failure).label, "계획 HTML 저장 한도");
  await assert.rejects(
    runPlanWorkflow({
      settings: validatePlanSettings({ mode: "single" }),
      fallback: { provider: "codex", model: "test" },
      skills: [],
      context: "test",
      draftPrompt: "draft",
      signal: new AbortController().signal,
      emit: () => {},
      run: async () => ({
        text: JSON.stringify({
          files: [{ path: "R.html", content: fields() }],
        }),
      }),
      validateDraft: () => {
        throw failure;
      },
    }),
    (error) => error.code === "plan_document_size",
  );
  assert.throws(() => validatePlanHTML("plain text"), /HTML 태그/);
});
