import { locale, t } from "./index.js";

export function progressDeltaText(delta) {
  if (!delta) return "";
  if (locale === "ko") return delta.text;
  if (!Number.isFinite(delta.criteria)) return t(delta.text);
  const signed = (value) => `${value >= 0 ? "+" : ""}${value}`;
  return t("충족 기준 {0}개 · 차단 문제 {1}건 · 점수 {2}점", [
    signed(delta.criteria),
    signed(-delta.blockers),
    signed(delta.score),
  ]);
}
