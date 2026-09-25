import fs from "node:fs";
import path from "node:path";
import { formatSkillMarkdown } from "../shared/skill-markdown.mjs";

function directory(parent, name) {
  const target = path.join(parent, name);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`스킬 저장 폴더를 확인하세요: ${target}`);
  return target;
}
function safeId(id) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error("잘못된 스킬 저장 ID입니다.");
  // Preserve distinct IDs on case-insensitive Windows file systems too.
  return id.replace(/[A-Z]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
}
function write(file, content) {
  if (fs.existsSync(file)) {
    if (!fs.lstatSync(file).isFile())
      throw new Error(`스킬 파일을 확인하세요: ${file}`);
    if (fs.readFileSync(file, "utf8") === content) return;
  }
  const temp = file + ".tmp";
  const fd = fs.openSync(temp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.closeSync(fd);
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {}
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Versioned DB documents remain authoritative. These are managed Markdown
// copies for inspection/re-import, not an independent source of live changes.
export function syncSkillFiles(root, workspaces) {
  const base = directory(root, "workspaces");
  for (const workspace of workspaces) {
    const folder = directory(directory(base, safeId(workspace.id)), "skills");
    const skills = workspace.deletedAt
      ? []
      : workspace.document.projectSpec.skills;
    const names = new Set(skills.map((skill) => safeId(skill.id)));
    for (const skill of skills) {
      const target = directory(folder, safeId(skill.id));
      write(path.join(target, "SKILL.md"), formatSkillMarkdown(skill));
    }
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (
        names.has(entry.name) ||
        !/^(?:[a-z0-9_-]|%[0-9a-f]{2})+$/.test(entry.name)
      )
        continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const target = path.join(folder, entry.name);
      // Remove only the managed file, never recursively delete user files.
      fs.rmSync(path.join(target, "SKILL.md"), { force: true });
      if (!fs.readdirSync(target).length) fs.rmdirSync(target);
    }
  }
}
