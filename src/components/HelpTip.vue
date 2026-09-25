<script setup>
import { t as __t } from "../i18n/index.js";

import { ref, useId } from "vue";
defineProps({
  text: { type: String, required: true },
  label: { type: String, default: __t("설명 보기") },
});
const open = ref(false);
const id = useId();
</script>
<template>
  <span
    class="help-tip"
    @mouseenter="open = true"
    @mouseleave="open = false"
  >
    <button
      type="button"
      class="help-tip-trigger"
      :aria-label="label"
      :aria-expanded="open"
      :aria-describedby="open ? id : undefined"
      @click.prevent.stop="open = true"
      @focus="open = true"
      @blur="open = false"
      @keydown.esc.prevent.stop="open = false"
    >
      <CwIcon name="help" />
    </button>
    <span
      v-if="open"
      :id="id"
      role="tooltip"
      class="help-tip-content"
      >{{ text }}</span
    >
  </span>
</template>
<style scoped>
:global(.field-label-help) {
  position: relative;
}
.help-tip {
  display: inline-flex;
  vertical-align: middle;
  margin-left: 6px;
}
button.help-tip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  min-width: 24px;
  min-height: 24px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.help-tip-content {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  width: min(360px, 100%);
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper, #fff);
  color: var(--ink);
  box-shadow: 0 6px 22px #0002;
  font-size: 14px;
  line-height: 1.7;
  font-weight: 400;
  white-space: normal;
}
</style>
