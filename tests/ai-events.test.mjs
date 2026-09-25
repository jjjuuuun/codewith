import test from "node:test";
import assert from "node:assert/strict";
import { consumeAI } from "../src/services/ai-events.js";
const stream = (events) =>
  new Response(
    events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""),
  );
test("stream recovery retries failed fetches without submitting another plan", async () => {
  let requests = 0,
    replays = 0;
  const events = [];
  await consumeAI(
    stream([
      { type: "run", job: "one" },
      { type: "delta", text: "partial" },
    ]),
    (event) => events.push(event),
    {
      delay: async () => {},
      replay: () => {
        replays++;
        events.length = 0;
      },
      request: async (route) => {
        assert.equal(route, "/jobs/one/events");
        if (++requests < 3) throw new TypeError("Failed to fetch");
        return stream([
          { type: "run", job: "one" },
          { type: "answer", text: "done" },
        ]);
      },
    },
  );
  assert.equal(requests, 3);
  assert.equal(replays, 1);
  assert.equal(events.at(-1).text, "done");
});
test("offline retry exhaustion reports unknown server state, not model failure", async () => {
  let requests = 0;
  await assert.rejects(
    consumeAI(stream([{ type: "run", job: "one" }]), () => {}, {
      delay: async () => {},
      request: async () => {
        requests++;
        throw new TypeError("Failed to fetch");
      },
    }),
    (error) => error.network && error.message.includes("may still be running"),
  );
  assert.equal(requests, 3);
});
test("terminal provider errors and rejected access are never retried", async () => {
  let requests = 0;
  await assert.rejects(
    consumeAI(
      stream([
        { type: "run", job: "one" },
        { type: "error", message: "provider" },
      ]),
      (event) => {
        if (event.type === "error") throw Error(event.message);
      },
      {
        request: async () => {
          requests++;
        },
      },
    ),
    /provider/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    consumeAI(stream([{ type: "run", job: "one" }]), () => {}, {
      delay: async () => {},
      request: async () => {
        requests++;
        throw Object.assign(Error("로그인이 필요합니다"), { status: 401 });
      },
    }),
    (error) => error.status === 401,
  );
  assert.equal(requests, 1);
});
