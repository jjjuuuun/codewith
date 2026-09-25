import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { root } from "./check-release.mjs";
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
const tarball = path.join(
  root,
  "release",
  fs
    .readdirSync(path.join(root, "release"))
    .find((name) => name.endsWith(".tgz")),
);
for (const format of ["npm", "zip"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codewith-install-"));
  let child;
  try {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    let appDir;
    if (format === "npm") {
      execFileSync(
        npm,
        ["install", "--omit=dev", "--no-audit", "--no-fund", tarball],
        { cwd: dir, stdio: "pipe", shell: process.platform === "win32" },
      );
      appDir = path.join(dir, "node_modules/@jjjuuuun/codewith");
    } else {
      execFileSync("unzip", [
        "-q",
        path.join(root, "release", `codewith-${pkg.version}.zip`),
        "-d",
        dir,
      ]);
      appDir = path.join(dir, `codewith-${pkg.version}`);
      execFileSync(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
        cwd: appDir,
        stdio: "pipe",
        shell: process.platform === "win32",
      });
    }
    const cli = path.join(appDir, "bin/codewith.mjs");
    assert.equal(
      execFileSync(process.execPath, [cli, "--version"], {
        encoding: "utf8",
      }).trim(),
      pkg.version,
    );
    const portServer = net.createServer();
    await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const port = portServer.address().port;
    await new Promise((resolve) => portServer.close(resolve));
    fs.writeFileSync(
      path.join(dir, ".env"),
      `CODEWITH_MODE=personal\nCODEWITH_DATA_DIR=${path.join(dir, "private-data")}\nPORT=${port}\nHOST=127.0.0.1\n`,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith("CODEWITH_") && !["PORT", "HOST"].includes(key),
      ),
    );
    child = spawn(process.execPath, [cli], { cwd: dir, env, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const origin = `http://127.0.0.1:${port}`;
    let response;
    for (let i = 0; i < 100; i++) {
      try {
        response = await fetch(origin + "/api/health");
        if (response.ok) break;
      } catch {}
      if (child.exitCode !== null)
        throw Error("Installed CLI exited: " + output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(response?.ok, "Installed package did not become healthy");
    assert.equal((await response.json()).version, pkg.version);
    assert((await (await fetch(origin)).text()).includes('id="app"'));
    for (const asset of [
      "/auth/wait",
      "/auth-wait.js",
      "/text-editor.js",
      "/guide/deployment",
    ])
      assert.equal((await fetch(origin + asset)).status, 200, asset);
    assert(
      fs.existsSync(path.join(dir, "private-data", "database.json")),
      "CLI respects .env data directory",
    );
    assert(
      !fs.existsSync(path.join(appDir, ".codewith")),
      "Package directory must not hold user data",
    );
    console.log(
      `Installed ${format} package: version, HTTP, guides, editor assets and isolated .env data directory passed.`,
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
