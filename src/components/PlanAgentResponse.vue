<script setup>
import { t as __t } from "../i18n/index.js";

import { computed, ref, watch } from "vue";
import { agentResponse } from "../../shared/agent-response.mjs";
import AiResponseContent from "./AiResponseContent.vue";
import SessionErrorDialog from "./SessionErrorDialog.vue";
const props = defineProps({
  task: { type: Object, required: true },
  call: { type: Number, required: true },
  control: { type: Function, required: true },
});
const selected = ref(props.call);
const origin = computed(() =>
  props.task.steps.find((s) => s.call === props.call),
);
const steps = computed(() =>
  props.task.steps.filter((s) =>
    origin.value?.session
      ? s.session === origin.value.session
      : s.call === props.call,
  ),
);
const step = computed(
  () => steps.value.find((s) => s.call === selected.value) || origin.value,
);
const pending = ref(false);
const followRestart = ref(false);
const controlError = ref("");
const showError = ref(false);
const state = computed(() => props.task.agents?.[origin.value?.session]);
const canStop = computed(() => props.task.active && state.value === "running");
const canRestart = computed(
  () => props.task.active && ["paused", "failed"].includes(state.value),
);
watch(
  () => steps.value.at(-1)?.call,
  (call) => {
    if (call && followRestart.value) {
      selected.value = call;
      followRestart.value = false;
    }
  },
);
async function controlSession(action) {
  pending.value = true;
  controlError.value = "";
  if (action === "restart") followRestart.value = true;
  try {
    await props.control(origin.value.session, action);
  } catch (error) {
    followRestart.value = false;
    controlError.value = error.message;
  } finally {
    pending.value = false;
  }
}
const raw = computed(() => step.value?.response || step.value?.output || "");
const response = computed(() =>
  agentResponse(raw.value, {
    complete:
      typeof step.value?.response === "string" ||
      step.value?.status === "completed",
  }),
);
const hasResponse = computed(
  () =>
    response.value.message ||
    response.value.files.length ||
    Object.keys(response.value.extra || {}).length,
);
const responseNotice = computed(() => {
  if (response.value.pending)
    return step.value?.status === "running"
      ? __t("응답 작성 중…")
      : __t("응답이 중단되었습니다. 완성된 항목만 표시합니다.");
  if (response.value.incomplete)
    return __t("응답 형식이 완성되지 않아 표시할 수 없습니다.");
  return "";
});
</script>
<template>
  <section
    class="agent-response"
    :aria-label="__t('에이전트 응답')"
  >
    <header class="agent-response-header">
      <div
        class="agent-response-tabs"
        :aria-label="__t('세션 내 단계')"
      >
        <CwButton
          v-for="item in steps"
          :key="item.call"
          class="small"
          :title="`${item.provider} / ${item.model} · ${item.session}`"
          :aria-pressed="selected === item.call"
          @click="selected = item.call"
          >{{ item.stage }} {{ __t("· 요청") }} {{ item.call }} ({{
            item.model
          }})</CwButton
        >
      </div>
      <div class="agent-response-actions">
        <CwButton
          v-if="step?.error || step?.failure || controlError"
          class="small danger"
          :aria-label="__t('오류 내용 보기')"
          @click="showError = true"
          >{{ __t("오류 내용 보기") }}</CwButton
        >
        <CwButton
          class="ghost small"
          :aria-label="__t('세션 정지')"
          :title="__t('이 세션만 정지')"
          :disabled="pending || !canStop"
          @click="controlSession('stop')"
          ><CwIcon name="stop"
        /></CwButton>
        <CwButton
          class="ghost small"
          :aria-label="__t('세션 재시작')"
          :title="__t('정지하거나 실패한 단계를 같은 세션에서 다시 실행')"
          :disabled="pending || !canRestart"
          @click="controlSession('restart')"
          ><CwIcon name="refresh"
        /></CwButton>
      </div>
    </header>
    <AiResponseContent
      v-if="hasResponse"
      :response="response"
      class="agent-response-body"
    />
    <p
      v-else-if="!responseNotice && step?.status !== 'running'"
      role="status"
    >
      {{ __t("아직 수신한 응답이 없습니다.") }}
    </p>
    <p
      v-if="step?.status === 'running' && !responseNotice"
      role="status"
    >
      {{ __t("응답 작성 중…") }}
    </p>
    <p
      v-if="responseNotice"
      role="status"
    >
      {{ responseNotice }}
    </p>
    <SessionErrorDialog
      v-if="showError"
      :step="step"
      :control-error="controlError"
      :can-restart="canRestart"
      :state="state"
      @close="showError = false"
    />
  </section>
</template>
<style scoped>
.agent-response-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.agent-response-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
.agent-response-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.agent-response-tabs :deep(.v-btn) {
  max-width: 100%;
  height: auto;
  min-height: 32px;
  white-space: normal;
  padding: 6px 10px;
}
.agent-response-tabs :deep(.v-btn__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.agent-response-body {
  overflow-wrap: anywhere;
  padding: 16px;
  font-size: 14px;
  line-height: 1.7;
}
</style>
