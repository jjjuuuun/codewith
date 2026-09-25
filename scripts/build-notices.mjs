import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json")));
const sections = [
  "# Third-party notices\n\nCodeWith's own code is MIT licensed. Dependencies retain their own licenses and terms. This list covers installed production dependencies; it does not relicense them. Regenerate with `npm run build:notices`.\n",
];
for (const [location, metadata] of Object.entries(lock.packages).sort(
  ([a], [b]) => a.localeCompare(b, "en"),
)) {
  if (!location || metadata.dev) continue;
  const directory = path.join(root, location);
  if (!fs.existsSync(path.join(directory, "package.json"))) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
  sections.push(
    `## ${pkg.name} ${pkg.version}\n\nLicense: ${pkg.license || "See upstream terms"}. [Package and source](https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}).\n`,
  );
  for (const name of fs.readdirSync(directory).sort()) {
    if (
      !/^(licen[cs]e|copying|notice)(?:[._-]|$)/i.test(name) ||
      !fs.statSync(path.join(directory, name)).isFile()
    )
      continue;
    sections.push(
      `### ${name}\n\n\`\`\`text\n${fs.readFileSync(path.join(directory, name), "utf8").trim()}\n\`\`\`\n`,
    );
  }
}
fs.writeFileSync(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  sections.join("\n"),
);
console.log("Production dependency notices generated.");
