<script setup>
import { t as __t } from "../i18n/index.js";

import { useWorkspace } from "../composables/useWorkspace.js";
import { t } from "../services/i18n.js";
const { S } = useWorkspace();
</script>
<template>
  <div
    class="workspace-overview"
    :data-workspace="S.w.id"
  >
    <PageHeading
      :label="__t('워크스페이스')"
      :title="S.w.document.project"
      :description="__t('프로젝트의 기본 정보를 확인하고 관리합니다.')"
      ><CwButton
        v-if="S.w.role === 'owner'"
        action="edit-workspace"
        class="workspace-action"
        >{{ __t("편집") }}</CwButton
      ></PageHeading
    >
    <section
      class="workspace-basics"
      :aria-label="__t('워크스페이스 기본 설정')"
    >
      <div class="card">
        <h2>{{ __t("기본 설정") }}</h2>
        <dl class="settings-list">
          <div>
            <dt>{{ __t("워크스페이스 이름") }}</dt>
            <dd>{{ S.w.document.project }}</dd>
          </div>
          <div>
            <dt>{{ __t("프로젝트 목적") }}</dt>
            <dd>
              <MarkdownContent
                v-if="S.w.document.projectSpec.purpose"
                :text="S.w.document.projectSpec.purpose"
              /><span
                v-else
                class="muted"
                >{{ __t("아직 작성하지 않았습니다.") }}</span
              >
            </dd>
          </div>
          <div>
            <dt>{{ __t("공유 범위") }}</dt>
            <dd>
              {{
                S.w.visibility === "team"
                  ? __t("초대와 승인을 통해 참여")
                  : __t("비공개")
              }}
            </dd>
          </div>
          <div>
            <dt>{{ __t("내 권한") }}</dt>
            <dd>{{ t(S.w.role) }}</dd>
          </div>
          <div>
            <dt>{{ __t("참여 멤버") }}</dt>
            <dd>
              {{
                S.w.memberCount === 1
                  ? __t("1명")
                  : __t("{0}명", [S.w.memberCount])
              }}
            </dd>
          </div>
        </dl>
      </div>
      <section
        class="card workspace-document"
        aria-labelledby="workspace-document-title"
      >
        <div class="row between">
          <h2 id="workspace-document-title">{{ __t("워크스페이스 문서") }}</h2>
          <CwButton
            action="export-html"
            class="small"
          >
            {{ __t("HTML 다운로드") }}
          </CwButton>
        </div>
        <p class="muted">
          {{
            __t(
              "현재 워크스페이스의 명세와 참고 자료를 브라우저에서 읽을 수 있는 HTML 문서로 저장합니다.",
            )
          }}
        </p>
      </section>
      <p class="muted">
        {{
          __t(
            "AI 지침은 좌측 공통 설정 · 스킬에서, 요구사항과 계획은 명세에서 관리합니다.",
          )
        }}
      </p>
    </section>
  </div>
</template>
