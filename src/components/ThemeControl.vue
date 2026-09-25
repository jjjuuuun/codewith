<script setup>
import { t as __t } from "../i18n/index.js";

import { ref, onMounted, onBeforeUnmount } from "vue";
import LanguageControl from "./LanguageControl.vue";
import { useTheme } from "vuetify";
const theme = useTheme();
const mode = ref(window.CodeWithTheme.mode);
const options = [
  { title: __t("시스템 설정"), value: "system" },
  { title: __t("라이트"), value: "light" },
  { title: __t("다크"), value: "dark" },
];
const sync = () => {
  mode.value = window.CodeWithTheme.mode;
  theme.change(window.CodeWithTheme.resolved);
};
function change(value) {
  window.CodeWithTheme.set(value);
  sync();
}
onMounted(() => {
  sync();
  document.addEventListener("codewith:controls-sync", sync);
});
onBeforeUnmount(() =>
  document.removeEventListener("codewith:controls-sync", sync),
);
</script>
<template>
  <LanguageControl />
  <span
    class="theme-control"
    :title="__t('화면 테마')"
    ><v-select
      data-theme-select
      :data-value="mode"
      :model-value="mode"
      @update:model-value="change"
      :items="options"
      :aria-label="__t('화면 테마')"
      class="theme-select"
      :menu-props="{ maxWidth: 250 }"
  /></span>
</template>
