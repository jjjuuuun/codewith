import fs from "node:fs";
import { parseSkillMarkdown } from "../shared/skill-markdown.mjs";
import { validateDocument, SCHEMA } from "../shared/schema.mjs";

const ids = [
  "codewith-html-plan",
  "codewith-plan-ui",
  "codewith-plan-review",
  "codewith-plan-flow",
];
export const defaultSkills = ids.map((id) => {
  const file = new URL(`../skills/defaults/${id}/SKILL.md`, import.meta.url);
  const skill = parseSkillMarkdown(fs.readFileSync(file, "utf8"));
  if (skill.id !== id)
    throw new Error(`기본 스킬 ID를 확인하세요: ${file.pathname}`);
  return validateDocument({
    schema: SCHEMA,
    project: "기본 스킬",
    specs: [],
    files: {},
    projectSpec: {
      purpose: "",
      principles: [],
      constraints: [],
      skills: [skill],
    },
  }).projectSpec.skills[0];
});
export const [
  defaultPlanSkill,
  defaultPlanUISkill,
  defaultPlanReviewSkill,
  defaultPlanFlowSkill,
] = defaultSkills;

// Keep the live question policy sourced from the maintained default skill.
export const planDecisionPolicy = defaultPlanFlowSkill.content
  .split("## 자율 판단과 질문")[1]
  .split("## 실시간 확인 질문")[0]
  .trim();
