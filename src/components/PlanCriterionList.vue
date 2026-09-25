<script setup>
import { t as __t } from "../i18n/index.js";

import PlanProgressDetails from "./PlanProgressDetails.vue";
defineProps({ criteria: { type: Array, required: true } });
const tones = { pass: "success", fail: "error", uncertain: "warning" };
const labels = {
  pass: __t("충족"),
  fail: __t("보완 필요"),
  uncertain: __t("확인 필요"),
};
</script>
<template>
  <p
    v-if="!criteria.length"
    class="muted"
  >
    {{ __t("기준별 평가가 필요합니다.") }}
  </p>
  <PlanProgressDetails
    v-for="criterion in criteria"
    :key="criterion.id"
    class="criterion-row"
  >
    <template #title>
      <span
        class="criterion-badge plan-status-surface"
        :data-plan-tone="tones[criterion.status]"
        >{{ labels[criterion.status] }}</span
      >
      <span class="criterion-text"
        >{{ criterion.id }} · {{ criterion.text }}</span
      >
    </template>
    <p
      v-for="(evidence, i) in criterion.evidence"
      :key="i"
    >
      {{ __t("평가자") }} {{ i + 1 }}: {{ evidence }}
    </p>
  </PlanProgressDetails>
</template>
<style scoped>
.criterion-row .criterion-badge {
  display: inline-block;
  white-space: nowrap;
  border-radius: 30px;
  padding: 3px 9px;
  text-align: center;
  align-self: center;
  font-weight: 700;
  font-size: 12px;
}
.criterion-row {
  margin-top: 10px;
  overflow-wrap: anywhere;
}
.criterion-row :deep(.disclosure-title) {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 10px;
  flex: 1;
}
.criterion-row :deep(summary) {
  align-items: center;
}
.criterion-row :deep(.plan-progress-details-body) {
  padding-left: 94px;
}
.criterion-text {
  min-width: 0;
}
.criterion-row p {
  margin: 8px 0;
}
</style>
