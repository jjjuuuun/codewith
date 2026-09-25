export const requirementContract = (r) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  criteria: r.criteria,
  resources: r.resources || [],
});
export const specStatus = (s) =>
  s.requirements.length > 0 &&
  s.requirements.every((r) => r.status === "completed")
    ? "completed"
    : "pending";
export const statusLabel = (status) =>
  status === "completed" ? "완료" : "구현 이전";
