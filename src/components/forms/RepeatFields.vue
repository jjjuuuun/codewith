<script setup>
import { t as __t } from "../../i18n/index.js";

import { ref, watch } from "vue";
import { uid } from "../../services/format.js";
const props = defineProps({
  name: { type: String, required: true },
  items: Array,
  ids: Boolean,
  formRows: Boolean,
  editor: { type: Object, required: true },
});
// UI-only identities survive editing and deleting neighboring rows.
const rowKeys = ref([]);
watch(
  () => props.editor.rows[props.name],
  (rows) => {
    rowKeys.value = rows.map(() => uid("ROW"));
  },
  { immediate: true, flush: "sync" },
);
function remove(index) {
  props.editor.rows[props.name].splice(index, 1);
  rowKeys.value.splice(index, 1);
}
function add() {
  rowKeys.value.push(uid("ROW"));
  props.editor.rows[props.name].push(
    props.ids ? { id: uid("AC"), text: "" } : "",
  );
}
</script>
<template>
  <div
    class="repeater"
    :data-list="name"
    :data-ids="ids"
  >
    <div
      v-for="(row, index) in editor.rows[name]"
      :key="rowKeys[index]"
      class="row"
    >
      <CwButton
        data-action="repeat-remove"
        class="small"
        :aria-label="__t('항목 삭제')"
        :disabled="editor.busy"
        @click="remove(index)"
        >−</CwButton
      >
      <input
        v-if="ids"
        v-model="row.id"
        :aria-label="__t('완료 기준 식별번호')"
        data-row-id
        style="width: 125px"
        required
        pattern="(?:[a-zA-Z0-9_]|-)+"
        :disabled="editor.busy"
      />
      <textarea
        v-if="ids"
        v-model="row.text"
        data-row-text
        :aria-label="__t('항목 내용')"
        required
        :disabled="editor.busy"
      />
      <textarea
        v-else
        v-model="editor.rows[name][index]"
        data-row-text
        :aria-label="__t('항목 내용')"
        required
        :disabled="editor.busy"
      />
    </div>
  </div>
  <CwButton
    data-action="repeat-add"
    class="small"
    :data-list-name="name"
    :disabled="editor.busy"
    @click="add"
    >{{ __t("+ 항목 추가") }}</CwButton
  >
</template>
