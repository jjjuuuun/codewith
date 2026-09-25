import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (/\.(mjs|js)$/.test(file)) yield file;
  }
}
for (const file of [
  ...files("src"),
  ...files("server"),
  ...files("shared"),
  ...files("scripts"),
]) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(
  "JavaScript syntax checks passed. Vue templates are checked by npm run build.",
);
