<script setup>
import { t as __t } from "../i18n/index.js";

import { onMounted } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
const { runAction, editors } = useWorkspace();
onMounted(async () => {
  await runAction("personal-settings", { dataset: {} });
  editors.state.dialog?.handlers["personal-tab-project"]?.();
});
</script>
<template>
  <PageHeading
    :label="__t('개인 설정')"
    :title="__t('프로젝트 연결')"
    :description="
      __t('프로젝트 연결은 개인 설정의 프로젝트 연결 탭에서 관리합니다.')
    "
    ><CwButton action="personal-settings">{{
      __t("개인 설정 열기")
    }}</CwButton></PageHeading
  >
</template>
