import test from "node:test";
import assert from "node:assert/strict";
import { createPlanDialogue } from "../server/plan-dialogue.mjs";
test("live questions enforce ownership, validate answers, advance individually and cancel waits", async () => {
  const d = createPlanDialogue(),
    controller = new AbortController(),
    events = [];
  let waiting = 0;
  const opts = {
    userId: "u",
    workspaceId: "w",
    jobId: "j",
    stage: "draft",
    call: 1,
    signal: controller.signal,
    emit: (e) => events.push(e),
    waiting: (n) => {
      waiting += n;
    },
  };
  const result = d.ask({ ...opts, questions: ["first", "second"] });
  const first = events[0].id;
  assert.equal(events.length, 1);
  assert.throws(() => d.answer("other", "w", "j", first, "yes"));
  assert.throws(() => d.answer("u", "w", "j", first, ""));
  d.answer("u", "w", "j", first, "yes");
  await new Promise((resolve) => setImmediate(resolve));
  const second = events.at(-1).id;
  assert.notEqual(first, second);
  assert.equal(waiting, 1);
  d.answer("u", "w", "j", second, "no");
  assert.deepEqual(await result, [
    { question: "first", answer: "yes" },
    { question: "second", answer: "no" },
  ]);
  assert.equal(waiting, 0);
  assert.throws(() => d.answer("u", "w", "j", second, "duplicate"));
  const cancelled = d.ask({ ...opts, questions: ["cancel"] });
  controller.abort();
  await assert.rejects(cancelled, /중지/);
  assert.equal(waiting, 0);
});
