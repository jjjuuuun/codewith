<script setup>
import { useWorkspace } from "../composables/useWorkspace.js";
import { renderMarkdown } from "../services/markdown.js";
const { runAction } = useWorkspace();
function copy(event) {
  const button = event.target.closest('[data-action="copy-code"]');
  if (button && event.currentTarget.contains(button))
    runAction("copy-code", button);
}
defineProps({ text: { type: String, default: "" } });
</script>
<template>
  <div
    class="markdown"
    @click="copy"
    v-html="renderMarkdown(text)"
  />
</template>
