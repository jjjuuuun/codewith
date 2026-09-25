<script setup>
import { t as __t } from "../../i18n/index.js";

import { ref } from "vue";
import { api } from "../../services/api.js";
const props = defineProps({
  endpoint: { type: String, required: true },
  editor: { type: Object, required: true },
  name: String,
  items: Array,
  formRows: Boolean,
});
const listing = ref(null);
const busy = ref(false);
const error = ref("");
async function browse(path = "") {
  busy.value = true;
  error.value = "";
  try {
    listing.value = await api(
      props.endpoint + "/folders?path=" + encodeURIComponent(path),
    );
    props.editor.values.path = listing.value.path || "";
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="project-folder-browser">
    <CwButton
      type="button"
      data-action="project-folder-browse"
      class="small"
      :disabled="busy || editor.busy"
      @click="browse(editor.values.path || '')"
      ><CwIcon name="folder" />{{ __t("폴더 탐색") }}</CwButton
    >
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-if="listing"
      class="folder-list"
      :aria-label="__t('프로젝트 폴더 탐색')"
    >
      <p
        v-if="listing.path"
        class="folder-path"
      >
        {{ listing.path }}
      </p>
      <div class="row">
        <CwButton
          v-if="listing.path"
          type="button"
          class="small ghost"
          :disabled="busy || editor.busy"
          @click="browse()"
          >{{ __t("시작 위치") }}</CwButton
        >
        <CwButton
          v-if="listing.parent"
          type="button"
          class="small ghost"
          :disabled="busy || editor.busy"
          @click="browse(listing.parent)"
          >{{ __t("상위 폴더") }}</CwButton
        >
      </div>
      <CwButton
        v-for="folder in listing.path
          ? listing.folders
          : listing.roots.map((path) => ({ name: path, path }))"
        :key="folder.path"
        type="button"
        class="folder-choice ghost"
        :disabled="busy || editor.busy"
        @click="browse(folder.path)"
        ><CwIcon name="folder" />{{ folder.name }}</CwButton
      >
      <p
        v-if="listing.path && !listing.folders.length"
        class="muted"
      >
        {{ __t("하위 폴더가 없습니다.") }}
      </p>
      <p class="muted">
        {{
          listing.selectable
            ? __t("현재 폴더가 입력되었습니다. 아래 연결 버튼으로 확정하세요.")
            : __t("연결할 프로젝트 폴더로 이동하세요.")
        }}
      </p>
    </div>
  </div>
</template>
<style scoped>
.project-folder-browser {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}
.project-folder-browser > .cw-button {
  justify-self: start;
}
.folder-list {
  display: grid;
  gap: 8px;
  max-height: 300px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.folder-list p {
  margin: 0;
}
.folder-path {
  overflow-wrap: anywhere;
}
.folder-choice {
  justify-content: start;
  height: auto;
  min-height: 36px;
}
.folder-choice :deep(.v-btn__content) {
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
</style>
