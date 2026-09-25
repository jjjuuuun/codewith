import { t as __t } from "../i18n/index.js";
export function planScoreStatus(summary) {
  if (!summary || !Number.isFinite(summary.score))
    return { tone: "neutral", label: __t("미평가") };
  const requirementGaps = summary.requirementScores?.map(
    (r) => r.targetScore - r.score * 10,
  );
  const gap = requirementGaps?.length
    ? Math.max(...requirementGaps)
    : summary.target - summary.score * 10;
  if (gap <= 1e-9) return { tone: "success", label: __t("목표 달성") };
  if (gap <= 10) return { tone: "warning", label: __t("목표 근접") };
  return { tone: "error", label: __t("개선 필요") };
}
