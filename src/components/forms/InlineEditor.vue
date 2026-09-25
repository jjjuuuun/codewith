<script setup>
import { t as __t } from "../../i18n/index.js";

import { computed, ref, watch, nextTick } from "vue";
import { richEditorFor } from "@codewith/editor";
import { useWorkspace } from "../../composables/useWorkspace.js";
import FormNodes from "./FormNodes.js";
const props = defineProps({
  requirementId: String,
  requirementSpec: String,
  resourceRequirement: String,
  resourceSpec: String,
});
const { editors } = useWorkspace();
const editor = computed(() => {
  const item = editors.state.inline;
  if (!item) return null;
  const keys = [
    "requirementId",
    "requirementSpec",
    "resourceRequirement",
    "resourceSpec",
  ];
  return keys.every((key) => (item.options[key] || "") === (props[key] || ""))
    ? item
    : null;
});
const host = ref();
watch(
  () => editor.value?.id,
  async (id) => {
    if (!id) return;
    await nextTick();
    host.value?.scrollIntoView({
      block: props.resourceRequirement ? "nearest" : "start",
      behavior: "instant",
    });
    host.value
      ?.querySelector("input,textarea,select")
      ?.focus({ preventScroll: true });
  },
  { immediate: true },
);
function submit(e) {
  for (const area of e.target.querySelectorAll("textarea"))
    if (richEditorFor(area)?.validate() === false) return;
  editors.submit(editor.value, new FormData(e.target), e.target);
}
</script>
<template>
  <section
    v-if="editor"
    :key="editor.id"
    ref="host"
    id="inline-editor"
    class="inline-editor card"
    :data-editable="!!editor.onSave"
    :data-saving="editor.busy"
  >
    <form
      id="inline-form"
      @submit.prevent="submit"
    >
      <header class="row between">
        <h2>{{ editor.title }}</h2>
        <CwButton
          action="inline-cancel"
          class="ghost small"
          :disabled="editor.busy"
          >{{ __t("취소") }}</CwButton
        >
      </header>
      <div class="inline-body">
        <FormNodes
          :nodes="editor.nodes"
          :editor="editor"
        />
      </div>
      <p
        id="inline-error"
        class="error"
        role="alert"
      >
        {{ editor.error }}
      </p>
      <footer class="row">
        <CwButton
          v-if="editor.onSave"
          class="primary"
          type="submit"
          :disabled="editor.busy"
          >{{ editor.options.save || __t("저장") }}</CwButton
        ><CwButton
          action="inline-cancel"
          :disabled="editor.busy"
          >{{ editor.onSave ? __t("취소") : __t("닫기") }}</CwButton
        >
      </footer>
    </form>
  </section>
</template>
