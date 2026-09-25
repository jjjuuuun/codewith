import { parseResponseJSON } from "../shared/response-json.mjs";
import { PLAN_FIELDS } from "../shared/plans.mjs";

// Retain the validated parts of a draft; the model only supplies replacements.
export function mergePlanRepair(previous, answer, detail = "") {
  if (!Array.isArray(previous?.files) || !Array.isArray(answer?.files))
    return answer;
  if (
    answer.files.some((f) => !f || typeof f.path !== "string") ||
    new Set(answer.files.map((f) => f.path)).size !== answer.files.length ||
    answer.files.some((f) => f.path === "questions.json")
  )
    return answer;
  const targets = previous.files.filter(
    (f) => typeof f?.path === "string" && detail.includes(f.path),
  );
  const field = PLAN_FIELDS.find((key) => detail.includes(` · ${key})`));
  const files = previous.files.map((old) => {
    if (!old || (targets.length && !targets.includes(old))) return old;
    const replacement = answer.files.find((f) => f.path === old.path);
    if (!replacement) return old;
    if (field) {
      try {
        const before = parseResponseJSON(old.content);
        const after = parseResponseJSON(replacement.content);
        if (
          before &&
          after &&
          typeof before === "object" &&
          typeof after === "object"
        )
          return { ...old, content: { ...before, [field]: after[field] } };
      } catch {
        /* Invalid JSON requires a complete replacement of this file. */
      }
    }
    return replacement;
  });
  for (const file of answer.files)
    if (!previous.files.some((old) => old?.path === file.path))
      files.push(file);
  return { ...answer, files };
}
