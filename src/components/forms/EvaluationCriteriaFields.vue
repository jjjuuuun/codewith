<script setup>
import { t as __t } from "../../i18n/index.js";

import { computed, nextTick } from "vue";
import { uid } from "../../services/format.js";
import { MAX_EVALUATION_CRITERIA } from "../../../shared/plan-evaluation-policy.mjs";
const props = defineProps({
  name: { type: String, required: true },
  items: Array,
  formRows: Boolean,
  editor: { type: Object, required: true },
});
const criteria = computed(() => props.editor.rows[props.name]);
const disabled = computed(
  () => props.editor.busy || props.editor.values.evaluationMode !== "custom",
);
const total = computed(() =>
  criteria.value.reduce((sum, item) => sum + Number(item.points || 0), 0),
);
const balance = computed(() =>
  total.value === 100
    ? __t("배점 설정 완료")
    : total.value < 100
      ? __t("{0}점을 더 배분해 주세요.", [100 - total.value])
      : __t("{0}점을 줄여 주세요.", [total.value - 100]),
);
async function add(event) {
  const form = event.currentTarget.closest("form");
  criteria.value.push({
    id: uid("criterion"),
    label: "",
    description: "",
    points: Math.max(1, 100 - total.value),
  });
  await nextTick();
  form
    ?.querySelector(`#f-evaluationLabel${criteria.value.length - 1}`)
    ?.focus();
}
async function remove(index, event) {
  const form = event.currentTarget.closest("form");
  criteria.value.splice(index, 1);
  await nextTick();
  form
    ?.querySelector(
      `#f-evaluationLabel${Math.min(index, criteria.value.length - 1)}`,
    )
    ?.focus();
}
</script>
<template>
  <div class="evaluation-criteria-fields">
    <div
      id="evaluation-total"
      class="evaluation-total"
      :class="{ complete: total === 100 }"
      role="status"
      aria-live="polite"
    >
      <strong>{{ __t("배점 합계") }} {{ total }} {{ __t("/ 100점") }}</strong>
      <span>{{ balance }}</span>
    </div>
    <p class="muted">
      {{
        __t(
          "항목을 추가하거나 삭제할 수 있습니다. 각 항목에 1점 이상 배분하고 합계를 100점으로 맞춰 주세요.",
        )
      }}
    </p>
    <div
      v-for="(item, index) in criteria"
      :key="item.id"
      class="evaluation-policy-item"
    >
      <div class="evaluation-item-heading">
        <strong>{{ __t("평가 항목") }} {{ index + 1 }}</strong>
        <CwButton
          type="button"
          data-action="evaluation-remove"
          class="small ghost"
          :aria-label="__t('평가 항목 {0} 삭제', [index + 1])"
          :title="__t('평가 항목 삭제')"
          :disabled="disabled || criteria.length === 1"
          @click="remove(index, $event)"
          ><CwIcon name="trash"
        /></CwButton>
      </div>
      <label :for="`f-evaluationLabel${index}`">{{ __t("항목 이름") }}</label>
      <input
        :id="`f-evaluationLabel${index}`"
        v-model="item.label"
        :name="`evaluationLabel${index}`"
        maxlength="160"
        required
        :disabled="disabled"
      />
      <label :for="`f-evaluationDescription${index}`">{{
        __t("판단 기준 · 필요한 근거")
      }}</label>
      <textarea
        :id="`f-evaluationDescription${index}`"
        v-model="item.description"
        :name="`evaluationDescription${index}`"
        class="evaluation-policy-description"
        rows="3"
        maxlength="4000"
        required
        :disabled="disabled"
      ></textarea>
      <label :for="`f-evaluationPoints${index}`">{{ __t("배점") }}</label>
      <input
        :id="`f-evaluationPoints${index}`"
        v-model.number="item.points"
        :name="`evaluationPoints${index}`"
        type="number"
        min="1"
        max="100"
        step="1"
        required
        :disabled="disabled"
      />
    </div>
    <CwButton
      type="button"
      data-action="evaluation-add"
      class="evaluation-add"
      :disabled="disabled || criteria.length >= MAX_EVALUATION_CRITERIA"
      @click="add"
      >{{ __t("+ 평가 항목 추가") }}</CwButton
    >
  </div>
</template>
<style scoped>
.evaluation-criteria-fields {
  display: grid;
  gap: 14px;
}
.evaluation-criteria-fields > p {
  margin: 0;
}
.evaluation-item-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.evaluation-total {
  display: grid;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--soft);
}
.evaluation-total strong {
  color: var(--orange);
}
.evaluation-total.complete strong {
  color: var(--green);
}
.evaluation-total span {
  color: var(--muted);
  font-size: 12px;
}
.evaluation-add {
  justify-self: stretch;
}
</style>
