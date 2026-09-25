<script setup>
import { t as __t } from "../i18n/index.js";

import { computed } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
import { date } from "../services/format.js";
const { S, projectSource } = useWorkspace();
const busy = computed(
  () =>
    S.busy ||
    projectSource.connecting.value ||
    projectSource.refreshing.value ||
    projectSource.status.value === "checking",
);
</script>
<template>
  <section class="card project-source-card">
    <div class="row between">
      <div class="project-source-title">
        <h2>{{ __t("프로젝트 연결") }}</h2>
        <span
          class="pill"
          :class="projectSource.connected.value ? 'completed' : 'pending'"
          role="status"
          >{{ projectSource.statusLabel.value }}</span
        >
      </div>
      <div class="row project-source-actions">
        <CwButton
          v-if="projectSource.previous.value"
          action="project-source-reconnect"
          class="small"
          :disabled="busy"
          :title="
            projectSource.previous.value.path ||
            projectSource.previous.value.label
          "
          >{{ __t("이전 폴더 재연결") }}</CwButton
        >
        <CwButton
          action="project-source-open"
          class="small"
          :disabled="busy"
          >{{
            S.w.projectSource ? __t("폴더 변경") : __t("폴더 선택")
          }}</CwButton
        >
      </div>
    </div>
    <p
      v-if="projectSource.detail.value"
      class="project-source-notice"
    >
      {{ projectSource.detail.value }}
    </p>
    <template v-if="S.w.projectSource">
      <p class="project-folder-path">
        {{ S.w.projectSource.path ? __t("연결 경로") : __t("연결 폴더") }}:
        <b>{{ S.w.projectSource.path || S.w.projectSource.label }}</b>
      </p>
      <p class="muted">
        {{
          S.w.projectSource.kind === "server"
            ? __t("연결한 폴더에서 코드 읽기·파일 수정·명령 실행")
            : __t("코드 분석용 사본")
        }}
        · {{ S.w.projectSource.fileCount }}{{ __t("개 파일 ·") }}
        {{ date(S.w.projectSource.scannedAt) }}{{ __t("에 읽음") }}
      </p>
      <div class="row">
        <CwButton
          action="project-source-refresh"
          :disabled="busy || !projectSource.connected.value"
          class="small"
          >{{
            projectSource.refreshing.value
              ? __t("코드를 읽고 있습니다…")
              : S.w.projectSource.kind === "upload"
                ? __t("폴더 다시 선택")
                : __t("코드 다시 읽기")
          }}</CwButton
        >
        <CwButton
          action="project-source-disconnect"
          :disabled="busy"
          class="small ghost"
          >{{ __t("연결 해제") }}</CwButton
        >
      </div>
    </template>
    <p
      v-else-if="projectSource.previous.value"
      class="project-folder-path muted"
    >
      {{ __t("이전 폴더:") }}
      {{
        projectSource.previous.value.path || projectSource.previous.value.label
      }}
    </p>
  </section>
</template>
<style scoped>
.project-source-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.project-source-title h2 {
  margin: 0;
}
.project-source-actions {
  flex-wrap: wrap;
}
.project-folder-path,
.project-source-notice {
  overflow-wrap: anywhere;
}
</style>
