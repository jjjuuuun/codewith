<script setup>
import { ref, watch, nextTick } from "vue";

const props = defineProps({
  message: { type: String, default: "" },
  target: { type: String, default: "body" },
});
const element = ref();
watch(
  () => [props.message, props.target],
  async ([message]) => {
    await nextTick();
    if (message !== props.message) return;
    if (!element.value) return;
    // Native dialogs occupy the top layer. Keep notifications visible above
    // them without adding another modal or moving focus away from the form.
    element.value.hidePopover();
    if (message) element.value.showPopover();
  },
  { flush: "post" },
);
</script>

<template>
  <Teleport :to="target">
    <div
      id="toast"
      ref="element"
      popover="manual"
      role="status"
      aria-live="polite"
      :class="{ show: message }"
    >
      {{ message }}
    </div>
  </Teleport>
</template>
