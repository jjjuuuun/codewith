<script setup>
import { t as __t } from "../../i18n/index.js";

import { ref, watch, nextTick, computed } from "vue";
import { useWorkspace } from "../../composables/useWorkspace.js";
import FormNodes from "./FormNodes.js";
import ConfirmDialog from "./ConfirmDialog.vue";
import { richEditorFor } from "@codewith/editor";
const { editors } = useWorkspace();
const dialog = ref();
const editor = computed(() => editors.state.dialog);
let backdrop = false;
watch(
  () => editor.value?.id,
  async () => {
    await nextTick();
    if (editor.value) {
      if (!dialog.value.open) dialog.value.showModal();
    } else if (dialog.value.open) dialog.value.close();
  },
  { flush: "post" },
);
function outside(e) {
  const r = dialog.value.getBoundingClientRect();
  return (
    e.target === dialog.value &&
    (e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom)
  );
}
function escape(e) {
  if (e.key !== "Escape" || e.isComposing) return;
  if (e.target.closest(".help-tip")?.querySelector('[aria-expanded="true"]'))
    return;
  if (
    e.target.closest(".v-select") &&
    e.target.getAttribute("aria-expanded") === "true"
  ) {
    e.preventDefault();
    return;
  }
  if (
    e.target
      .closest(".rich-editor")
      ?.querySelector(
        ".rich-menu:not([hidden]),.rich-link-editor:not([hidden])",
      )
  )
    return;
  e.preventDefault();
  e.stopPropagation();
  editors.requestModalClose();
}

function submit(e) {
  for (const area of e.target.querySelectorAll("textarea"))
    if (richEditorFor(area)?.validate() === false) return;
  editors.submit(editor.value, new FormData(e.target), e.target);
}
</script>
<template>
  <dialog
    id="modal"
    ref="dialog"
    :style="{
      width: editor?.options.wide ? 'min(900px,calc(100vw - 28px))' : '',
    }"
    :data-saving="!!editor?.busy"
    :data-editable="!!editor?.onSave"
    @cancel.prevent="editors.requestModalClose"
    @keydown.capture="escape"
    @pointerdown="backdrop = outside($event)"
    @click="
      backdrop && outside($event) && editors.requestModalClose();
      backdrop = false;
    "
  >
    <form
      v-if="editor"
      :key="editor.id"
      id="dialog-form"
      @submit.prevent="submit"
    >
      <div class="modal-head">
        <div class="modal-title-row">
          <h2>{{ editor.title }}</h2>
          <FormNodes
            v-if="editor.options.titleActions"
            :nodes="editor.options.titleActions"
            :editor="editor"
          />
        </div>
        <CwButton
          action="close"
          class="ghost"
          :aria-label="__t('닫기')"
          >✕</CwButton
        >
      </div>
      <div
        v-if="editor.options.headerActions"
        class="modal-actions"
        role="group"
        :aria-label="__t('추가 작업')"
      >
        <FormNodes
          :nodes="editor.options.headerActions"
          :editor="editor"
        />
      </div>
      <div class="modal-body">
        <FormNodes
          :nodes="editor.overrides['dialog-prefix']"
          :editor="editor"
        /><FormNodes
          :nodes="editor.nodes"
          :editor="editor"
        />
        <p
          class="error"
          id="dialog-error"
          role="alert"
        >
          {{ editor.error }}
        </p>
      </div>
      <div class="modal-foot">
        <div
          v-if="editor.options.footerStart"
          class="modal-foot-start"
        >
          <FormNodes
            :nodes="editor.options.footerStart"
            :editor="editor"
          />
        </div>
        <CwButton
          action="close"
          :disabled="editor.busy"
          >{{
            editor.options.closeLabel ||
            (editor.onSave ? __t("취소") : __t("닫기"))
          }}</CwButton
        ><CwButton
          v-if="editor.onSave"
          type="submit"
          class="primary"
          :disabled="editor.busy"
          >{{ editor.options.save || __t("저장") }}</CwButton
        >
      </div>
    </form>
  </dialog>
  <ConfirmDialog
    v-if="editor?.unsaved"
    id="modal-unsaved"
    :title="__t('변경 내용을 버릴까요?')"
    :message="
      __t(
        '저장하지 않은 변경 내용이 있습니다. 닫으면 작성한 내용이 사라집니다.',
      )
    "
    :cancel-label="__t('계속 작성')"
    :confirm-label="__t('변경 내용 버리고 닫기')"
    cancel-action="keep-modal"
    confirm-action="discard-modal"
    :busy="editor.busy"
    destructive
    @cancel="editor.unsaved = false"
    @confirm="editors.closeDialog"
  />
</template>

<style scoped>
.modal-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
</style>
