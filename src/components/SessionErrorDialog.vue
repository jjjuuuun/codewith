<script setup>
import { t as __t } from "../i18n/index.js";

import { onMounted, onBeforeUnmount, ref, useId } from "vue";
defineProps({
  step: { type: Object, default: null },
  controlError: { type: String, default: "" },
  canRestart: Boolean,
  state: { type: String, default: "" },
});
const emit = defineEmits(["close"]);
const dialog = ref();
const titleId = useId();
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
function close() {
  dialog.value.close();
  emit("close");
}
</script>
<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="session-error-dialog"
      :aria-labelledby="titleId"
      @cancel.prevent="close"
      @keydown.esc.prevent.stop="close"
    >
      <div class="modal-head">
        <h2 :id="titleId">{{ __t("오류 내용") }}</h2>
        <CwButton
          class="ghost"
          :aria-label="__t('오류 내용 닫기')"
          autofocus
          @click="close"
          ><CwIcon name="close"
        /></CwButton>
      </div>
      <div class="modal-body">
        <p
          v-if="controlError"
          role="alert"
        >
          {{ controlError }}
        </p>
        <p
          v-if="canRestart"
          role="status"
        >
          {{
            state === "failed"
              ? __t("이 세션이 실패했습니다.")
              : __t("이 세션은 정지되었습니다.")
          }}
          {{
            __t(
              "재시작하면 해당 단계를 다시 실행합니다. 다른 세션은 계속 진행합니다.",
            )
          }}
        </p>

        <p
          v-if="step?.error"
          role="alert"
        >
          <strong v-if="step.failure?.label">{{ step.failure.label }} · </strong
          >{{ step.error }}
        </p>
        <p
          v-if="step?.failure"
          class="agent-failure-details"
        >
          {{ __t("요청") }} {{ step.call }} · {{ step.provider }} /
          {{ step.model }}
          <template v-if="step.failure.detectedAt">
            {{ __t("· 발생") }}
            {{ new Date(step.failure.detectedAt).toLocaleString() }}</template
          >
          <template v-if="step.failure.durationMs != null">
            {{ __t("· 경과") }} {{ (step.failure.durationMs / 1000).toFixed(1)
            }}{{ __t("초") }}</template
          >
          <template v-if="step.failure.chars != null">
            {{ __t("· 수신") }} {{ step.failure.chars.toLocaleString()
            }}{{ __t("자") }}</template
          >
          <template v-if="step.failure.timeoutSeconds">
            {{ __t("· 제한") }} {{ step.failure.timeoutSeconds
            }}{{ __t("초") }}</template
          >
          <template v-if="step.failure.providerReason">
            {{ __t("· 공급자 종료 사유:") }}
            {{ step.failure.providerReason }}</template
          >
          <template v-if="step.failure.operation">
            {{ __t("· 명령:") }} {{ step.failure.operation }}</template
          >
          <template v-if="step.failure.usage?.input != null">
            {{ __t("· 입력") }} {{ step.failure.usage.input.toLocaleString()
            }}{{ __t("토큰") }}</template
          >
          <template v-if="step.failure.usage?.output != null">
            {{ __t("· 출력") }} {{ step.failure.usage.output.toLocaleString()
            }}{{ __t("토큰") }}</template
          >
        </p>
      </div>
      <div class="modal-foot">
        <CwButton @click="close">{{ __t("닫기") }}</CwButton>
      </div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.session-error-dialog {
  width: min(680px, calc(100vw - 28px));
  margin: auto;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.7;
}
.modal-head h2 {
  font-size: 18px;
}
</style>
