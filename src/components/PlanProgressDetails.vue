<script setup>
import { onBeforeUnmount, ref } from "vue";
const props = defineProps({
  title: { type: String, default: "" },
  initiallyOpen: { type: Boolean, default: false },
});
const element = ref(null);
const expanded = ref(props.initiallyOpen);
let animation;
function toggle() {
  const panel = element.value;
  const from = panel.getBoundingClientRect().height;
  animation?.cancel();
  expanded.value = !expanded.value;
  panel.open = true;
  const to = expanded.value
    ? panel.getBoundingClientRect().height
    : panel.querySelector("summary").getBoundingClientRect().height + 2;
  const finish = () => {
    panel.open = expanded.value;
    animation = null;
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish();
    return;
  }
  animation = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: 220,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  });
  animation.onfinish = finish;
}
onBeforeUnmount(() => animation?.cancel());
</script>
<template>
  <details
    ref="element"
    class="plan-progress-details"
    :open="initiallyOpen"
  >
    <summary
      :aria-expanded="expanded"
      @click.prevent="toggle"
    >
      <span class="disclosure-title"
        ><slot name="title">{{ title }}</slot></span
      >
      <CwIcon
        name="chevronRight"
        :class="{ expanded }"
      />
    </summary>
    <div class="plan-progress-details-body"><slot /></div>
  </details>
</template>
<style scoped>
.plan-progress-details {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--green) 4%, var(--bg));
}
.plan-progress-details > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin: 0;
  min-height: 48px;
  cursor: pointer;
  font-weight: 600;
  list-style: none;
}
.disclosure-title {
  min-width: 0;
  overflow-wrap: anywhere;
}
summary::-webkit-details-marker {
  display: none;
}
summary:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -3px;
}
summary:hover {
  background: color-mix(in srgb, var(--green) 8%, transparent);
}
summary :deep(.cw-icon) {
  transition: transform 220ms ease;
  flex-shrink: 0;
}
summary :deep(.expanded) {
  transform: rotate(90deg);
}
.plan-progress-details-body {
  padding: 0 14px 14px;
}
@media (prefers-reduced-motion: reduce) {
  summary :deep(.cw-icon) {
    transition: none;
  }
}
</style>
