import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { defaultSkills } from "../server/default-skills.mjs";
import {
  parseSkillMarkdown,
  formatSkillMarkdown,
} from "../shared/skill-markdown.mjs";

test("skill Markdown roundtrip preserves metadata and complete code", () => {
  for (const skill of defaultSkills)
    assert.deepEqual(parseSkillMarkdown(formatSkillMarkdown(skill)), skill);
  const content =
    "---\nname: existing-yaml\n---\n# 지침\n```js\nconst x = 1;\n```\n";
  assert.deepEqual(parseSkillMarkdown(content), { content });
});

for (const databaseUrl of ["", "sqlite:skills.sqlite"])
  test(`workspace skill files: isolation, edits, import, removal and migration (${databaseUrl || "file"})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-skills-"));
    let store;
    const file = (w, id) =>
      path.join(dir, "workspaces", w.id, "skills", id, "SKILL.md");
    const read = (w, id) =>
      parseSkillMarkdown(fs.readFileSync(file(w, id), "utf8"));
    try {
      store = await Store.open(dir, { databaseUrl });
      store.db.users.push({ id: "u", name: "U", login: "u" });
      let a = await store.create("u", "A");
      const b = await store.create("u", "B");
      for (const skill of defaultSkills)
        assert.deepEqual(read(a, skill.id), skill);
      const doc = structuredClone(a.document);
      doc.projectSpec.skills[0].content =
        "워크스페이스 A의 수정 지침\n```js\nconst a = 1;\n```\n";
      doc.projectSpec.skills.push({
        ...defaultSkills[0],
        id: "imported",
        content: "# 외부 MD\n전체 내용",
      });
      await store.commit(a, "u", doc, "스킬 수정·추가", a.head);
      assert.deepEqual(read(a, "imported"), doc.projectSpec.skills.at(-1));
      assert.equal(
        read(a, defaultSkills[0].id).content,
        doc.projectSpec.skills[0].content,
      );
      assert.equal(
        read(b, defaultSkills[0].id).content,
        defaultSkills[0].content,
      );
      await store.close();
      fs.rmSync(path.join(dir, "workspaces"), { recursive: true });
      store = await Store.open(dir, { databaseUrl });
      a = store.db.workspaces.find((w) => w.id === a.id);
      assert.equal(
        read(a, defaultSkills[0].id).content,
        doc.projectSpec.skills[0].content,
      );
      const next = structuredClone(a.document);
      next.projectSpec.skills = next.projectSpec.skills.filter(
        (s) => s.id !== "imported",
      );
      await store.commit(a, "u", next, "삭제", a.head);
      assert.equal(fs.existsSync(file(a, "imported")), false);
      await store.remove(a.id, "u", a.head);
      assert.equal(fs.existsSync(file(a, defaultSkills[0].id)), false);
      assert.equal(
        read(b, defaultSkills[0].id).content,
        defaultSkills[0].content,
      );
    } finally {
      await store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
