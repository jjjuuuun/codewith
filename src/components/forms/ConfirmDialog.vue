<script setup>
import { t as __t } from "../../i18n/index.js";

import { onBeforeUnmount, onMounted, ref, useId } from "vue";

const props = defineProps({
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmLabel: { type: String, default: __t("확인") },
  cancelLabel: { type: String, default: __t("취소") },
  confirmAction: { type: String, default: "confirm" },
  cancelAction: { type: String, default: "cancel" },
  busy: Boolean,
  destructive: Boolean,
});
const emit = defineEmits(["confirm", "cancel"]);
const dialog = ref();
const titleId = useId();
const messageId = useId();

onMounted(() => {
  dialog.value.showModal();
  dialog.value.querySelector("[autofocus]")?.focus();
});
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close();
});
function finish(event) {
  if (props.busy) return;
  // Close the upper dialog first so native focus restoration respects the stack.
  dialog.value.close();
  emit(event);
}
</script>
<template>
  <dialog
    ref="dialog"
    class="confirmation-dialog"
    role="alertdialog"
    :aria-labelledby="titleId"
    :aria-describedby="messageId"
    @cancel.prevent="finish('cancel')"
    @keydown.esc.stop
  >
    <div class="modal-head">
      <h2 :id="titleId">{{ title }}</h2>
    </div>
    <div class="modal-body">
      <p :id="messageId">{{ message }}</p>
    </div>
    <div class="modal-foot">
      <CwButton
        type="button"
        class="primary"
        :data-action="cancelAction"
        :disabled="busy"
        autofocus
        @click="finish('cancel')"
        >{{ cancelLabel }}</CwButton
      >
      <CwButton
        type="button"
        :class="{ danger: destructive }"
        :data-action="confirmAction"
        :disabled="busy"
        @click="finish('confirm')"
        >{{ confirmLabel }}</CwButton
      >
    </div>
  </dialog>
</template>
<style scoped>
.confirmation-dialog {
  width: min(480px, calc(100vw - 28px));
  margin: auto;
}
.modal-head h2 {
  font-size: 18px;
}
.modal-body p {
  margin: 0;
}
.modal-foot {
  flex-wrap: wrap;
}
</style>
