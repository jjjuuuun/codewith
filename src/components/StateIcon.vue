<script setup>
import { t } from "../i18n/index.js";
import { statusLabel } from "../../shared/completion.mjs";
defineProps({ status: String });
</script>
<template>
  <span
    class="state-icon"
    :class="status === 'completed' ? 'completed' : 'pending'"
    :data-state="status === 'completed' ? 'completed' : 'pending'"
    role="img"
    :aria-label="t(statusLabel(status))"
    ><svg
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
      />
      <path
        v-if="status === 'completed'"
        d="m4.8 8 2.1 2.2 4.3-4.4"
      /></svg
  ></span>
</template>
