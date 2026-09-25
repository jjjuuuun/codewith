<script setup>
import { ref } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
defineOptions({ inheritAttrs: false });
const props = defineProps({ action: String });
const workspace = useWorkspace();
const pending = ref(false);
async function click(event) {
  if (!props.action || pending.value) return;
  pending.value = true;
  try {
    await workspace.runAction(props.action, event.currentTarget);
  } finally {
    pending.value = false;
  }
}
</script>
<template>
  <v-btn
    v-bind="$attrs"
    class="cw-button"
    :data-action="action || $attrs['data-action']"
    :ripple="false"
    :disabled="pending || $attrs.disabled"
    @click="click"
    ><slot
  /></v-btn>
</template>
