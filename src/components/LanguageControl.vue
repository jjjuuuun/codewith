<script setup>
import { locale, changeLocale, t } from "../i18n/index.js";
const options = [
  { title: "English", value: "en" },
  { title: "한국어", value: "ko" },
];
</script>
<template>
  <span
    class="language-control"
    :title="t('언어 변경 시 페이지를 새로고침합니다.')"
  >
    <v-select
      data-language-select
      :model-value="locale"
      :items="options"
      :aria-label="t('표시 언어')"
      :menu-props="{ maxWidth: 220 }"
      @update:model-value="changeLocale"
    />
  </span>
</template>
<style scoped>
.language-control {
  display: inline-block;
  width: 106px;
  flex: 0 0 106px;
}
.language-control :deep(.v-field__input) {
  min-height: 34px;
  padding-top: 5px;
  padding-bottom: 5px;
  font-size: 12px;
}
</style>
