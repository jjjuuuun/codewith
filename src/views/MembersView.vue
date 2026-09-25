<script setup>
import { t as __t } from "../i18n/index.js";

import { computed, reactive } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
import { t } from "../services/i18n.js";
const { S } = useWorkspace();
const roles = reactive({});
const pendingRequests = computed(() =>
  S.w.requests.filter((request) => request.status === "pending"),
);
</script>
<template>
  <PageHeading
    :label="__t('멤버와 접근 권한')"
    :title="__t('멤버 · 공유')"
    :description="
      __t(
        '만든 사람이 슈퍼관리자가 되어 참여 요청과 권한을 관리합니다. AI 연결과 대화는 개인별로 분리됩니다.',
      )
    "
  />
  <div class="card">
    <div class="row between">
      <h3>
        {{
          S.w.visibility === "team"
            ? __t("팀 공유 켜짐")
            : __t("개인 워크스페이스")
        }}
      </h3>
      <CwButton
        v-if="S.w.role === 'owner'"
        action="sharing"
        class="small"
        >{{
          S.w.visibility === "team" ? __t("팀 공유 끄기") : __t("팀 공유 켜기")
        }}</CwButton
      >
    </div>
    <template v-if="S.w.role === 'owner' && S.w.visibility === 'team'"
      ><label>{{ __t("참여 요청용 초대 코드") }}</label>
      <div class="row">
        <code
          class="grow"
          style="word-break: break-all"
          >{{ S.w.inviteCode }}</code
        ><CwButton
          action="copy-invite"
          class="small"
          >{{ __t("초대 코드 복사") }}</CwButton
        ><CwButton
          action="rotate-invite"
          class="small"
          >{{ __t("재발급") }}</CwButton
        >
      </div>
      <small>{{
        __t(
          "초대받은 사람은 계정을 만든 뒤 참여를 요청합니다. 승인 전에는 프로젝트를 열 수 없습니다.",
        )
      }}</small></template
    >
  </div>
  <template v-if="S.w.role === 'owner'"
    ><div class="section-title">
      <h3>{{ __t("참여 요청") }}</h3>
    </div>
    <div
      v-for="request in pendingRequests"
      :key="request.id"
      class="card row"
    >
      <div class="grow">
        <b>{{ request.user.name }}</b
        ><small> @{{ request.user.login }}</small>
      </div>
      <v-select
        :model-value="roles[request.id] || 'editor'"
        @update:model-value="roles[request.id] = $event"
        :items="[
          { title: __t('편집자'), value: 'editor' },
          { title: __t('열람자'), value: 'viewer' },
        ]"
        :data-join-role="request.id"
        :aria-label="__t('참여 권한')"
      />
      <CwButton
        action="approve"
        :data-role="roles[request.id] || 'editor'"
        class="primary small"
        :data-id="request.id"
        >{{ __t("승인") }}</CwButton
      ><CwButton
        action="reject"
        class="small"
        :data-id="request.id"
        >{{ __t("거절") }}</CwButton
      >
    </div>
    <p
      v-if="!pendingRequests.length"
      class="muted"
    >
      {{ __t("대기 중인 요청이 없습니다.") }}
    </p></template
  >
  <div class="section-title">
    <h3>{{ __t("참여 멤버") }} {{ S.w.members.length }}</h3>
  </div>
  <div class="card">
    <div
      v-for="member in S.w.members"
      :key="member.userId"
      class="list-row"
    >
      <span class="avatar">{{ member.user.name[0] }}</span>
      <div class="grow">
        <b>{{ member.user.aiIdentity?.label || member.user.name }}</b
        ><small style="display: block"
          >@{{ member.user.login }} · {{ t(member.role) }}</small
        >
      </div>
      <template v-if="S.w.role === 'owner' && member.role !== 'owner'"
        ><CwButton
          action="member-role"
          class="small"
          :data-id="member.userId"
          :data-role="member.role === 'viewer' ? 'editor' : 'viewer'"
          >{{
            member.role === "viewer" ? __t("편집 허용") : __t("열람으로 변경")
          }}</CwButton
        ><CwButton
          action="member-remove"
          class="danger small"
          :data-id="member.userId"
          >{{ __t("제외") }}</CwButton
        ></template
      >
    </div>
  </div>
</template>
