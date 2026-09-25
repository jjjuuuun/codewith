import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocale, translate } from "../src/i18n/index.js";
import english from "../src/i18n/en.json" with { type: "json" };
import { progressDeltaText } from "../src/i18n/plan-progress.js";

test("English is the default and a supported saved preference takes precedence", () => {
  assert.equal(resolveLocale(null), "en");
  assert.equal(resolveLocale("ko", "en"), "ko");
  assert.equal(resolveLocale("en", "ko"), "en");
  assert.equal(resolveLocale("invalid", "ko"), "ko");
  assert.equal(resolveLocale("invalid", "invalid"), "en");
});
test("translation preserves authored values and unknown messages", () => {
  assert.equal(translate("저장", [], "en"), "Save");
  assert.equal(translate("저장", [], "ko"), "저장");
  assert.equal(
    translate("사용자가 작성한 문서", [], "en"),
    "사용자가 작성한 문서",
  );
  assert.equal(translate("{0}명", ["사용자"], "en"), "사용자 members");
  assert.equal(translate("{0}명", [2], "ko"), "2명");
});
test("English messages retain every interpolation argument", () => {
  const placeholders = (value) =>
    [...new Set(value.match(/\{\d+\}/g) || [])].sort();
  for (const [source, value] of Object.entries(english)) {
    assert.ok(value.trim(), source);
    assert.deepEqual(placeholders(value), placeholders(source), source);
  }
});
test("plan progress localizes structured deltas without reversing blocker direction", () => {
  assert.equal(
    progressDeltaText({ criteria: 2, blockers: 1, score: -0.5 }),
    "Criteria met +2 · Blockers -1 · Score -0.5 pts",
  );
});
