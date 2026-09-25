<script setup>
import { t as __t } from "../i18n/index.js";

import { useWorkspace } from "../composables/useWorkspace.js";
const { S, canEdit } = useWorkspace();
</script>
<template>
  <PageHeading
    :label="__t('설계를 위한 자료')"
    :title="__t('참고 코드')"
    :description="__t('프로젝트의 참고 코드를 보관하고 편집합니다.')"
    ><CwButton
      action="new-file"
      class="primary"
      :disabled="!canEdit"
      >{{ __t("파일 작성") }}</CwButton
    ></PageHeading
  >
  <div
    class="row"
    style="margin-bottom: 18px"
  >
    <CwButton
      action="import-code"
      class="small"
      :disabled="!canEdit"
      >{{ __t("텍스트 파일 가져오기") }}</CwButton
    ><small
      >{{ Object.keys(S.w.document.files).length }}{{ __t("개 파일") }}</small
    >
  </div>
  <div
    v-if="S.w.projectPath"
    class="note"
  >
    {{ __t("서버 프로젝트 폴더") }}<br /><code>{{ S.w.projectPath }}</code>
  </div>
  <div class="card">
    <div
      v-for="(content, path) in S.w.document.files"
      :key="path"
      class="list-row"
    >
      <div class="grow file-path">
        {{ path
        }}<small style="display: block"
          >{{ content.length.toLocaleString() }}{{ __t("자") }}</small
        >
      </div>
      <CwButton
        action="edit-file"
        :data-path="path"
        class="small"
        >{{ canEdit ? __t("열기 · 편집") : __t("열기") }}</CwButton
      ><CwButton
        action="download-file"
        :data-path="path"
        class="small"
        :aria-label="__t('파일 다운로드')"
        ><CwIcon name="download"
      /></CwButton>
    </div>
    <p
      v-if="!Object.keys(S.w.document.files).length"
      class="muted"
    >
      {{ __t("아직 코드 파일이 없습니다.") }}
    </p>
  </div>
</template>
