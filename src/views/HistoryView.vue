<script setup>
import { t as __t } from "../i18n/index.js";

import { useWorkspace } from "../composables/useWorkspace.js";
import { date, short } from "../services/format.js";
const { S } = useWorkspace();
</script>
<template>
  <PageHeading
    :label="__t('프로젝트 버전 관리')"
    :title="__t('변경 이력')"
    :description="
      __t(
        '프로젝트 기준, 모든 명세, 코드 파일을 한 커밋으로 기록합니다. 복원은 기존 이력을 보존하는 새 커밋을 만듭니다.',
      )
    "
  />
  <div class="timeline">
    <div
      v-for="(commit, index) in S.w.commits"
      :key="commit.id"
      class="card commit"
    >
      <div class="row between">
        <code>{{ short(commit.id) }} {{ index === 0 ? "· HEAD" : "" }}</code
        ><small>{{ date(commit.at) }}</small>
      </div>
      <h3 style="margin-top: 12px">{{ commit.message }}</h3>
      <p class="muted">
        {{ commit.author.name
        }}{{ commit.author.viaAI ? " · AI " + commit.author.viaAI.role : "" }}
      </p>
      <div class="row between">
        <small
          >{{ commit.changes.length }}{{ __t("개 변경 경로")
          }}{{ commit.restoreOf ? __t(" · 복원 커밋") : "" }}</small
        ><CwButton
          action="commit-detail"
          class="small"
          :data-id="commit.id"
          >{{ __t("변경 보기") }}</CwButton
        >
      </div>
    </div>
  </div>
</template>
