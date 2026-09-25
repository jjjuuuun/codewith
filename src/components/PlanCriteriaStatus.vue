<script setup>
import { t as __t } from "../i18n/index.js";

import PlanProgressDetails from "./PlanProgressDetails.vue";
import PlanCriterionList from "./PlanCriterionList.vue";
import { computed } from "vue";
import { PLAN_DEFAULTS } from "../../shared/config.mjs";
import { planScoreStatus } from "../services/plan-status.js";
const props = defineProps({
  summary: Object,
  showScore: { type: Boolean, default: true },
  showIssues: { type: Boolean, default: false },
  groupCriteria: { type: Boolean, default: false },
});
const passed = computed(
  () => props.summary?.criteria?.filter((c) => c.status === "pass").length || 0,
);
const scoreStatus = computed(() => planScoreStatus(props.summary));
const total = computed(() => props.summary?.criteria?.length || 0);
const criteriaTone = computed(() =>
  !total.value
    ? "neutral"
    : passed.value === total.value
      ? "success"
      : props.summary.criteria.some((c) => c.status === "fail")
        ? "error"
        : "warning",
);
const blockers = computed(() => props.summary?.blockingIssues?.length || 0);
const blockerTone = computed(() =>
  !props.summary ? "neutral" : blockers.value ? "error" : "success",
);
const issues = computed(() => [
  ...new Set(
    (props.summary?.blockingIssues || []).map((issue) =>
      issue.replace(/^\[차단\]\s*/, "").trim(),
    ),
  ),
]);
</script>
<template>
  <section
    class="criteria-status"
    :aria-label="__t('명세 기준별 계획 검토')"
  >
    <div class="criteria-metrics">
      <div
        v-if="showScore"
        class="criteria-metric plan-status-surface"
        :data-plan-tone="scoreStatus.tone"
      >
        <span>{{ __t("계획 품질 ·") }} {{ scoreStatus.label }}</span>
        <strong
          >{{ summary ? (summary.score * 10).toFixed(1) : "—" }}
          <small>{{ __t("/ 100점") }}</small></strong
        >
        <small
          >{{
            summary?.requirementScores?.length > 1
              ? __t("목표 평균")
              : __t("목표")
          }}
          {{ summary?.target ?? PLAN_DEFAULTS.targetScore
          }}{{ __t("점") }}</small
        >
      </div>
      <div
        class="criteria-metric plan-status-surface"
        :data-plan-tone="criteriaTone"
      >
        <span>{{ __t("필수 기준") }}</span>
        <strong
          >{{ passed }} / {{ total }}<small>{{ __t("개 충족") }}</small></strong
        >
        <small>{{
          !total
            ? __t("평가 필요")
            : passed === total
              ? __t("모든 기준 충족")
              : __t("{0}개 기준 확인·보완 필요", [total - passed])
        }}</small>
      </div>
      <div
        class="criteria-metric plan-status-surface"
        :data-plan-tone="blockerTone"
      >
        <span>{{ __t("차단 문제") }}</span>
        <strong
          >{{ summary ? blockers : "—" }}<small>{{ __t("건") }}</small></strong
        >
        <small>{{
          !summary
            ? __t("평가 필요")
            : blockers
              ? __t("승인 전 해결 필요")
              : __t("차단 문제 없음")
        }}</small>
      </div>
    </div>
    <slot name="after-metrics" />
    <p
      v-if="summary?.scope === 'spec'"
      class="muted"
    >
      {{ __t("평가 기준:") }}
      {{
        {
          spec: "명세 직접 설정",
          workspace: "워크스페이스 공통 설정",
          system: "워크스페이스 설정 · 시스템 기본값 상속",
        }[summary.requirementScores[0]?.source]
      }}
      {{ __t("· 이 명세의 계획 전체에 적용") }}
    </p>
    <div
      v-else-if="summary?.requirementScores?.length"
      class="requirement-scores"
      :aria-label="__t('요구사항별 평가 점수')"
    >
      <div
        v-for="item in summary.requirementScores"
        :key="item.id"
        class="plan-status-surface"
        :data-plan-tone="item.passed ? 'success' : 'warning'"
      >
        <b>{{ item.id }} · {{ item.title }}</b>
        <span
          >{{ (item.score * 10).toFixed(1) }} {{ __t("/ 100점 · 목표") }}
          {{ item.targetScore }}{{ __t("점 ·") }}
          {{ item.passed ? __t("점수 충족") : __t("점수 미달") }}</span
        >
        <small
          >{{ __t("평가 기준:") }}
          {{
            {
              requirement: "요구사항 직접 설정",
              workspace: "워크스페이스 공통 설정",
              system: "시스템 기본값",
            }[item.source]
          }}</small
        >
      </div>
    </div>
    <p class="muted">
      {{
        __t(
          "설계와 검증 방법에 대한 평가입니다. 실제 구현의 테스트 결과나 진행률이 아닙니다.",
        )
      }}
    </p>
    <PlanProgressDetails
      v-if="groupCriteria"
      class="criteria-group"
      :title="__t('명세 기준별 판단 · 근거')"
      initially-open
    >
      <div class="criteria-list">
        <PlanCriterionList :criteria="summary?.criteria || []" />
      </div>
    </PlanProgressDetails>
    <PlanCriterionList
      v-else
      :criteria="summary?.criteria || []"
    />
    <PlanProgressDetails
      v-if="showIssues && issues.length"
      class="criteria-issues"
      :title="__t('해결할 차단 문제 · {0}건', [issues.length])"
      initially-open
    >
      <p class="muted">
        {{
          __t(
            "계획 승인을 막는 평가 지적입니다. 기준별 판단과 함께 보완하세요.",
          )
        }}
      </p>
      <ul>
        <li
          v-for="issue in issues"
          :key="issue"
        >
          {{ issue }}
        </li>
      </ul>
    </PlanProgressDetails>
  </section>
</template>
<style scoped>
.requirement-scores {
  display: grid;
  gap: 10px;
  margin: 16px 0;
}
.requirement-scores > div {
  display: grid;
  gap: 6px;
  padding: 12px;
  overflow-wrap: anywhere;
}
.criteria-status {
  margin: 16px 0;
}
.criteria-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}
.criteria-metric {
  flex: 1 1 150px;
  min-width: 0;
  display: grid;
  gap: 5px;
  padding: 14px 16px;
  border-left: 4px solid var(--plan-tone);
}
.criteria-metric > span {
  font-size: 12px;
  font-weight: 650;
}
.criteria-metric strong {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
}
.criteria-metric small {
  font-size: 12px;
  font-weight: 500;
}
.criteria-metric strong small {
  margin-left: 5px;
}
.criteria-group {
  margin-top: 16px;
}
.criteria-list {
  display: grid;
  gap: 10px;
}
.criteria-issues {
  margin-top: 16px;
}
.criteria-issues p {
  margin-bottom: 10px;
}
.criteria-issues ul {
  margin: 0;
  padding-left: 22px;
}
.criteria-issues li {
  padding: 10px 0;
  overflow-wrap: anywhere;
}
.criteria-issues li + li {
  border-top: 1px solid var(--line);
}
</style>
