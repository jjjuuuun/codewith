<script setup>
import { t as __t } from "../i18n/index.js";

import { useWorkspace } from "../composables/useWorkspace.js";
import { t } from "../services/i18n.js";
import { date } from "../services/format.js";
const { runAction, S, mode } = useWorkspace();
</script>
<template>
  <div class="workspace-home">
    <PageHeading
      label="CODEWITH"
      :title="__t('워크스페이스')"
      :description="__t('함께 정한 기준으로, 한 단계씩 만들어 가세요.')"
      ><CwButton
        v-if="mode !== 'personal'"
        action="join-dialog"
        >{{ __t("초대 코드로 참여") }}</CwButton
      ><CwButton
        action="new-workspace"
        class="primary"
        >{{ __t("+ 워크스페이스 만들기") }}</CwButton
      ></PageHeading
    >
    <template v-if="S.workspaces.length"
      ><div class="row between workspace-list-heading">
        <small
          >{{ __t("참여 중인 워크스페이스") }} {{ S.workspaces.length
          }}{{ __t("개") }}</small
        >
      </div>
      <div class="workspace-grid">
        <article
          v-for="w in S.workspaces"
          :key="w.id"
          class="workspace-tile"
        >
          <button
            class="workspace-open"
            data-action="switch-workspace"
            @click="runAction('switch-workspace', $event.currentTarget)"
            :data-id="w.id"
          >
            <div class="row between">
              <span class="workspace-mark"><CwIcon name="project" /></span
              ><span class="pill">{{ t(w.role) }}</span>
            </div>
            <h2>{{ w.name }}</h2>
            <p>
              {{ __t("명세") }} {{ w.specCount }}{{ __t("개 · 멤버") }}
              {{ w.memberCount }}{{ __t("명") }}
            </p>
            <span>{{ __t("열기 →") }}</span>
          </button>
          <footer class="row between">
            <small>{{ date(w.updatedAt) }}</small>
            <div
              v-if="w.role === 'owner'"
              class="workspace-actions"
            >
              <CwButton
                action="edit-workspace"
                class="workspace-action"
                :data-id="w.id"
                :aria-label="__t('{0} 편집', [w.name])"
                >{{ __t("편집") }}</CwButton
              >
            </div>
          </footer>
        </article>
      </div></template
    >
    <template v-else
      ><div class="home-blank">
        <span class="blank-icon"><CwIcon name="project" /></span>
        <h2>{{ __t("첫 워크스페이스를 만들어 보세요") }}</h2>
        <p>
          {{ __t("프로젝트별로 요구사항과 계획을 함께 관리할 수 있습니다.") }}
        </p>
        <CwButton
          action="new-workspace"
          class="primary"
          >{{ __t("워크스페이스 만들기") }}</CwButton
        >
      </div>
      <div
        v-if="mode !== 'personal'"
        class="row between"
      >
        <small>{{
          __t(
            "참여 요청을 보냈다면 관리자 승인 후 브라우저를 새로고침해 주세요.",
          )
        }}</small>
      </div></template
    >
  </div>
</template>
