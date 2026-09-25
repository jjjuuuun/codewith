<script setup>
import { ref, watch, onMounted, onBeforeUnmount, useAttrs } from "vue";
import { mountRichEditor } from "@codewith/editor";
defineOptions({ inheritAttrs: false });
const props = defineProps({
  modelValue: { type: String, default: "" },
  disabled: Boolean,
  placeholder: String,
  skills: Array,
});
const emit = defineEmits(["update:modelValue", "send"]);
const attrs = useAttrs();
const host = ref();
let area, editor;
onMounted(() => {
  area = document.createElement("textarea");
  for (const [key, value] of Object.entries(attrs))
    if (!key.startsWith("on")) area.setAttribute(key, value);
  area.dataset.vueEditor = "true";
  area.value = props.modelValue;
  area.disabled = props.disabled;
  area.placeholder = props.placeholder || "";
  host.value.append(area);
  editor = mountRichEditor(area, {
    getSkills: () => props.skills || [],
    onChatSend: () => emit("send"),
  });
  area.addEventListener("input", onInput);
  window.addEventListener("pointerdown", dismiss);
});
function dismiss(event) {
  if (editor && !editor.wrap.contains(event.target)) editor.closeMenu();
}
defineExpose({ command: (action) => editor?.command(action) });
function onInput() {
  emit("update:modelValue", area.value);
}
watch(
  () => props.modelValue,
  (value) => {
    if (area && area.value !== value) editor.setValue(value);
  },
);
watch(
  () => props.disabled,
  (value) => {
    if (area) {
      area.disabled = value;
      editor.view.setProps({
        editable: () => !area.disabled && !area.readOnly,
      });
    }
  },
);
watch(
  () => props.placeholder,
  (value) => {
    if (area) {
      area.placeholder = value;
      editor.view.updateState(editor.view.state);
    }
  },
);
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", dismiss);
  area?.removeEventListener("input", onInput);
  editor?.destroy();
});
</script>
<template>
  <div
    ref="host"
    class="rich-input-host"
  />
</template>
