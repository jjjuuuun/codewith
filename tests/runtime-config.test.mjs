import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readRuntimeConfig,
  runtimeEnvName,
} from "../server/runtime-config.mjs";
import { PLAN_DEFAULTS } from "../shared/config.mjs";

test("runtime defaults preserve behavior and every environment key overrides its default", () => {
  const config = readRuntimeConfig({});
  assert.equal(config.planTimeoutSeconds, PLAN_DEFAULTS.timeoutSeconds);
  assert.equal(config.aiRequestTimeoutMs, 1800000);
  for (const key of Object.keys(config)) {
    assert.equal(readRuntimeConfig({ [runtimeEnvName(key)]: "30" })[key], 30);
  }
  assert(Object.isFrozen(config));
});
test("runtime JSON overrides defaults and environment overrides JSON without exposing values", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-config-"));
  const file = path.join(dir, "runtime.json");
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ planTimeoutSeconds: 3600, aiRequestTimeoutMs: 1200000 }),
    );
    const config = readRuntimeConfig({
      CODEWITH_CONFIG_FILE: file,
      CODEWITH_PLAN_TIMEOUT_SECONDS: "2400",
    });
    assert.equal(config.planTimeoutSeconds, 2400);
    assert.equal(config.aiRequestTimeoutMs, 1200000);
    assert.equal(config.sseHeartbeatMs, 15000);
    for (const value of [
      [],
      null,
      { typo: 10 },
      { planTimeoutSeconds: -1 },
      { planTimeoutSeconds: true },
      { planTimeoutSeconds: null },
    ]) {
      fs.writeFileSync(file, JSON.stringify(value));
      assert.throws(() => readRuntimeConfig({ CODEWITH_CONFIG_FILE: file }));
    }
    fs.writeFileSync(file, "not-json-secret");
    assert.throws(
      () => readRuntimeConfig({ CODEWITH_CONFIG_FILE: file }),
      (e) => !e.message.includes("secret"),
    );
    assert.throws(() =>
      readRuntimeConfig({ CODEWITH_CONFIG_FILE: file + "-missing" }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("runtime rejects invalid numeric and timer values rather than silently falling back", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "secret",
    "86400001",
  ]) {
    assert.throws(
      () => readRuntimeConfig({ CODEWITH_AI_REQUEST_TIMEOUT_MS: value }),
      /CODEWITH_AI_REQUEST_TIMEOUT_MS/,
    );
  }
  assert.throws(() =>
    readRuntimeConfig({ CODEWITH_PLAN_TIMEOUT_SECONDS: "86401" }),
  );
});
