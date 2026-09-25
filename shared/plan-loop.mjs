export const planStopLabels = {
  target_met: "목표 달성 · 승인 대기",
  call_budget: "목표 미달 · 호출 예산 소진",
  time_budget: "목표 미달 · 시간 예산 소진",
  stagnation: "목표 미달 · 개선 정체로 중단",
  evaluated: "평가 완료 · 목표 미달",
  interrupted: "목표 미달 · 사용자 중단",
  execution_failed: "목표 미달 · 실행 오류",
  round_limit: "목표 미달 · 이전 개선 횟수 한도 도달",
};
const passed = (s) => s.criteria.filter((c) => c.status === "pass").length;
const metTargets = (s) =>
  s.requirementScores?.filter((r) => r.passed).length || 0;
const deficit = (s) =>
  s.requirementScores?.reduce(
    (n, r) => n + Math.max(0, r.targetScore - r.score * 10),
    0,
  ) || 0;
export function comparePlanProgress(a, b) {
  return (
    Number(a.passed) - Number(b.passed) ||
    b.blockingIssues.length - a.blockingIssues.length ||
    passed(a) - passed(b) ||
    b.criteria.filter((c) => c.status === "fail").length -
      a.criteria.filter((c) => c.status === "fail").length ||
    metTargets(a) - metTargets(b) ||
    deficit(b) - deficit(a) ||
    a.score - b.score
  );
}
export function planProgressDelta(current, previous) {
  if (!previous) return { improved: false, text: "첫 평가 · 비교 기준 저장" };
  const criteria = passed(current) - passed(previous);
  const blockers =
    previous.blockingIssues.length - current.blockingIssues.length;
  const score = Math.round((current.score - previous.score) * 100) / 10;
  const improved =
    comparePlanProgress(current, previous) > 0 &&
    (metTargets(current) > metTargets(previous) ||
      deficit(previous) - deficit(current) >= 0.5 ||
      criteria > 0 ||
      blockers > 0 ||
      current.criteria.filter((c) => c.status === "fail").length <
        previous.criteria.filter((c) => c.status === "fail").length ||
      score >= 0.5);
  return {
    improved,
    criteria,
    blockers,
    score,
    text: `${current.requirementScores?.length > 1 ? `목표 충족 요구사항 ${metTargets(current)}/${current.requirementScores.length}개 · ` : ""}충족 기준 ${criteria >= 0 ? "+" : ""}${criteria}개 · 차단 문제 ${blockers >= 0 ? "감소 " : "증가 "}${Math.abs(blockers)}건 · 점수 ${score >= 0 ? "+" : ""}${score}점`,
  };
}
