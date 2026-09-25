import fs from "node:fs";
const defaults = JSON.parse(
  fs.readFileSync(
    new URL("../config/runtime.defaults.json", import.meta.url),
    "utf8",
  ),
);
export const runtimeEnvName = (key) =>
  "CODEWITH_" + key.replace(/[A-Z]/g, (letter) => "_" + letter).toUpperCase();
// All values are positive integers. Bounds protect Node timers and accidental allocation spikes.
export function readRuntimeConfig(env = process.env) {
  let overrides = {};
  if (env.CODEWITH_CONFIG_FILE) {
    try {
      overrides = JSON.parse(fs.readFileSync(env.CODEWITH_CONFIG_FILE, "utf8"));
    } catch {
      throw Error("CODEWITH_CONFIG_FILE 설정 JSON을 읽을 수 없습니다.");
    }
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
      throw Error("CODEWITH_CONFIG_FILE은 설정 객체여야 합니다.");
    for (const key of Object.keys(overrides))
      if (!Object.hasOwn(defaults, key))
        throw Error(`알 수 없는 실행 설정: ${key}`);
  }
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const name = runtimeEnvName(key);
    const raw = Object.hasOwn(env, name)
      ? env[name]
      : Object.hasOwn(overrides, key)
        ? overrides[key]
        : fallback;
    const value =
      typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
    const max = key.endsWith("Ms")
      ? 86400000
      : key === "planTimeoutSeconds"
        ? 86400
        : key.endsWith("Tokens")
          ? 1000000
          : key.endsWith("Calls") ||
              key.endsWith("Retries") ||
              key.endsWith("Turns") ||
              key.endsWith("Uses")
            ? 100
            : 100000000;
    const minimum = key === "planTimeoutSeconds" ? 30 : 1;
    if (
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > max ||
      (key === "planFollowupMaxCalls" && value > 32)
    )
      throw Error(
        `${name}은 ${minimum}~${key === "planFollowupMaxCalls" ? 32 : max} 사이 정수여야 합니다.`,
      );
    result[key] = value;
  }
  return Object.freeze(result);
}
export const runtimeConfig = readRuntimeConfig();
