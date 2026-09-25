import fs from "node:fs";
import { spawnSync } from "node:child_process";
// Published packages already contain the production frontend.
if (!fs.existsSync(new URL("../dist/index.html", import.meta.url))) {
  if (!fs.existsSync(new URL("../src/main.js", import.meta.url))) {
    throw new Error(
      "The frontend build is missing. Reinstall the complete release package.",
    );
  }
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build"],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
