#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION } from "../server/version.mjs";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(VERSION);
} else if (args.includes("--help")) {
  console.log(`CodeWith ${VERSION}
Usage: codewith [--mode personal|shared|server] [--host HOST] [--port PORT]

Reads .env from the current directory. Stores data in ./.codewith unless
CODEWITH_DATA_DIR is set. Personal mode binds to loopback by default.
Documentation: https://github.com/jjjuuuun/codewith`);
} else {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const child = spawn(
    process.execPath,
    [
      "--env-file-if-exists=.env",
      fileURLToPath(new URL("../server/index.mjs", import.meta.url)),
      ...args,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CODEWITH_DATA_DIR:
          process.env.CODEWITH_DATA_DIR || path.resolve(".codewith"),
      },
    },
  );
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
}
