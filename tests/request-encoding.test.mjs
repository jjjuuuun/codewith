import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApplication } from "../server/index.mjs";
import { keyLogin } from "./auth-helper.mjs";

test("JSON request bodies preserve Korean and emoji split across network chunks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-utf8-"));
  const app = await createApplication({ mode: "server", dataDir: dir });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    const { cookie } = await keyLogin(base);
    const instructions = "한글 보존 😀 계획";
    const payload = Buffer.from(JSON.stringify({ instructions, revision: 0 }));
    const cuts = [
      payload.indexOf(Buffer.from("한")) + 1,
      payload.indexOf(Buffer.from("😀")) + 2,
    ];
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        base + "/api/preferences",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "X-CodeWith": "1",
            "Content-Type": "application/json",
          },
        },
        (res) => {
          res.setEncoding("utf8");
          let text = "";
          res.on("data", (part) => {
            text += part;
          });
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.setNoDelay(true);
      req.write(payload.subarray(0, cuts[0]));
      setTimeout(() => {
        req.write(payload.subarray(cuts[0], cuts[1]));
        setTimeout(() => req.end(payload.subarray(cuts[1])), 20);
      }, 20);
    });
    assert.equal(result.status, 200);
    const saved = await fetch(base + "/api/preferences", {
      headers: { Cookie: cookie },
    }).then((r) => r.json());
    assert.equal(saved.instructions, instructions);
  } finally {
    app.server.closeAllConnections();
    await new Promise((r) => app.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
