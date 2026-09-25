import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { checkRelease, checkPublicFiles, root } from "./check-release.mjs";
checkRelease();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
if (!fs.existsSync(path.join(root, "dist/index.html")))
  throw new Error("Build before packaging.");
const output = path.join(root, "release");
fs.mkdirSync(output, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const [packed] = JSON.parse(
  execFileSync(
    npm,
    ["pack", "--ignore-scripts", "--pack-destination", output, "--json"],
    { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
  ),
);
const files = packed.files.map((file) => file.path);
checkPublicFiles(files);
for (const required of [
  "dist/index.html",
  "public/text-editor.js",
  "public/auth-wait.js",
  "bin/codewith.mjs",
  "server/index.mjs",
  "LICENSE",
])
  if (!files.includes(required))
    throw new Error(`Runtime package is missing ${required}`);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codewith-release-"));
try {
  execFileSync("tar", ["-xzf", path.join(output, packed.filename), "-C", temp]);
  const folder = `codewith-${pkg.version}`;
  fs.renameSync(path.join(temp, "package"), path.join(temp, folder));
  fs.copyFileSync(
    path.join(root, "package-lock.json"),
    path.join(temp, folder, "package-lock.json"),
  );
  const zip = path.join(output, `${folder}.zip`);
  fs.rmSync(zip, { force: true });
  execFileSync("zip", ["-q", "-r", zip, folder], { cwd: temp });
  const names = [packed.filename, `${folder}.zip`];
  fs.writeFileSync(
    path.join(output, "SHA256SUMS"),
    names
      .map(
        (name) =>
          `${createHash("sha256")
            .update(fs.readFileSync(path.join(output, name)))
            .digest("hex")}  ${name}\n`,
      )
      .join(""),
  );
  console.log(
    JSON.stringify({
      version: pkg.version,
      files: names,
      packageFiles: files.length,
    }),
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
