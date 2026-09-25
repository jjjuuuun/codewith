import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../", import.meta.url));
export function checkPublicFiles(files, base = root) {
  const forbidden =
    /(^|\/)(?:\.codewith(?:-local)?|node_modules|data|\.git|release)(\/|$)|(^|\/)\.env(?!\.example$)(?:\.|$)|(^|\/)(?:\.npmrc|codewith-login-key\.json|runtime\.local\.json)$|\.(?:pem|key|p12|pfx|crt|sqlite(?:-wal|-shm)?|db|log)$/i;
  const secrets = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /gh[pousr]_[A-Za-z0-9]{30,}/,
    /github_pat_[A-Za-z0-9_]{50,}/,
    /AKIA[0-9A-Z]{16}/,
    /sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{40,}/,
  ];
  for (const file of files) {
    if (file.includes("..") || path.isAbsolute(file) || forbidden.test(file))
      throw new Error(`Private or invalid publication path: ${file}`);
    const absolute = path.resolve(base, file);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(absolute);
      if (!target.startsWith(path.resolve(base) + path.sep))
        throw new Error(`Symlink leaves repository: ${file}`);
      continue;
    }
    if (!stat.isFile()) continue;
    const bytes = fs.readFileSync(absolute);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (secrets.some((pattern) => pattern.test(text)))
      throw new Error(`Possible credential in ${file}; content withheld.`);
    if (/\/(?:home|Users)\/[\w.-]+|\/mnt\/[a-z]\/Users\/[\w.-]+/i.test(text))
      throw new Error(`Machine-specific path or address in ${file}`);
  }
}
export function checkRelease() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json")),
  );
  if (
    pkg.private ||
    pkg.name !== "@jjjuuuun/codewith" ||
    !/^\d+\.\d+\.\d+$/.test(pkg.version)
  )
    throw new Error("Invalid public package metadata.");
  if (
    pkg.version !== lock.version ||
    pkg.version !== lock.packages[""].version ||
    pkg.name !== lock.name
  )
    throw new Error("Package and lockfile versions differ.");
  if (
    pkg.license !== "MIT" ||
    !fs
      .readFileSync(path.join(root, "LICENSE"), "utf8")
      .includes("Copyright (c) 2026 jjjuuuun")
  )
    throw new Error("License metadata differs.");
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  if (!files.length)
    throw new Error(
      "Stage the intended public files before the release check.",
    );
  checkPublicFiles(files);
  for (const name of ["README.md", "README.ko.md"]) {
    const text = fs.readFileSync(path.join(root, name), "utf8");
    for (const match of text.matchAll(
      /(?:\]\(|src=")([^\s)"#]+)(?:#[^\s)"]*)?/g,
    )) {
      if (/^(https?:|data:)/.test(match[1])) continue;
      if (!fs.existsSync(path.resolve(root, match[1])))
        throw new Error(`Broken local link in ${name}: ${match[1]}`);
    }
  }
  console.log(
    `Publication check passed: ${files.length} source files; version ${pkg.version}.`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  checkRelease();
