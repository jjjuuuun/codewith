<script setup>
import { t as __t } from "../i18n/index.js";

import { useWorkspace } from "../composables/useWorkspace.js";
import { specStatus, statusLabel } from "../../shared/completion.mjs";
import { t } from "../services/i18n.js";
import StateIcon from "./StateIcon.vue";
const { menuKey, S, mode, canEdit } = useWorkspace();
</script>
<template>
  <aside class="rail">
    <div
      class="workspace-picker"
      @keydown="menuKey"
    >
      <CwButton
        action="workspaces"
        class="workspace-switch"
        :aria-expanded="!!S.workspaceMenuOpen"
        aria-controls="workspace-menu"
        ><span
          ><small>{{ __t("워크스페이스") }}</small
          ><b>{{ S.w.document.project }}</b></span
        ><CwIcon name="chevronDown"
      /></CwButton>
      <div
        id="workspace-menu"
        class="workspace-menu"
        :hidden="!S.workspaceMenuOpen"
      >
        <p class="eyebrow">{{ __t("워크스페이스 전환") }}</p>
        <nav :aria-label="__t('워크스페이스 전환 목록')">
          <CwButton
            v-for="w in S.workspaces"
            :key="w.id"
            action="switch-workspace"
            :data-id="w.id"
            class="workspace-option"
            :aria-current="w.id === S.w.id ? 'true' : undefined"
            ><span
              >{{ w.name }}<small>{{ t(w.role) }}</small></span
            ><span
              v-if="w.id === S.w.id"
              aria-hidden="true"
              >✓</span
            ></CwButton
          >
        </nav>
      </div>
    </div>
    <nav :aria-label="__t('워크스페이스 탐색')">
      <CwButton
        v-for="view in ['workspace', 'project']"
        :key="view"
        action="view"
        :data-view="view"
        class="nav"
        :class="{ active: S.view === view }"
        ><span class="symbol"
          ><CwIcon :name="view === 'workspace' ? 'settings' : view" /></span
        >{{ view === "workspace" ? __t("기본 설정") : t(view) }}</CwButton
      >
    </nav>
    <section
      class="rail-section spec-navigation"
      :aria-label="__t('명세')"
    >
      <div class="row between">
        <span class="eyebrow">{{ __t("명세") }}</span
        ><CwButton
          action="new-spec"
          class="small ghost"
          :aria-label="__t('명세 만들기')"
          :disabled="!canEdit"
          >+</CwButton
        >
      </div>
      <nav
        class="spec-parent"
        :aria-label="__t('모든 요구사항')"
      >
        <CwButton
          action="view"
          data-view="requirements"
          class="nav"
          :class="{ active: S.view === 'requirements' }"
          ><span class="symbol"><CwIcon name="requirements" /></span
          >{{ t("requirements") }}</CwButton
        >
      </nav>
      <div class="spec-list nested-specs">
        <template
          v-for="spec in S.w.document.specs"
          :key="spec.id"
        >
          <CwButton
            action="spec"
            :data-id="spec.id"
            class="spec-link status-nav"
            :class="{ active: S.view === 'spec' && S.specId === spec.id }"
            :title="`${spec.id} · ${spec.title} · ${statusLabel(specStatus(spec))}`"
            ><StateIcon :status="specStatus(spec)" /><code
              class="nav-identifier"
              >{{ spec.id }}</code
            ><span class="nav-name">{{ spec.title }}</span></CwButton
          >
          <div
            v-if="
              S.view === 'spec' &&
              S.specId === spec.id &&
              spec.requirements.length
            "
            class="requirement-nav-list"
          >
            <CwButton
              v-for="r in spec.requirements"
              :key="r.id"
              action="requirement-nav"
              :data-id="r.id"
              :data-spec="spec.id"
              class="requirement-nav status-nav"
              :title="`${r.id} · ${r.title} · ${statusLabel(r.status)}`"
              ><StateIcon :status="r.status" /><code class="nav-identifier">{{
                r.id
              }}</code
              ><span class="nav-name">{{ r.title }}</span></CwButton
            >
          </div>
        </template>
        <small
          v-if="!S.w.document.specs.length"
          class="empty-spec-list"
          >{{ __t("첫 명세를 추가해 보세요.") }}</small
        >
      </div>
    </section>
    <nav
      class="rail-section workspace-management"
      :aria-label="__t('워크스페이스 관리')"
    >
      <span class="eyebrow">{{ __t("관리") }}</span
      ><CwButton
        v-for="view in mode === 'personal'
          ? ['history']
          : ['history', 'members']"
        :key="view"
        action="view"
        :data-view="view"
        class="nav"
        :class="{ active: S.view === view }"
        ><span class="symbol"><CwIcon :name="view" /></span
        >{{ t(view) }}</CwButton
      >
    </nav>
    <div class="rail-bottom">
      <CwButton
        action="personal-settings"
        class="profile-settings ghost"
        :title="__t('개인 설정')"
        :aria-label="__t('개인 설정 열기')"
        ><span
          class="avatar"
          aria-hidden="true"
          >{{ S.user.name.slice(0, 1) }}</span
        ><span class="grow"
          ><b>{{ S.user.name }}</b
          ><small>{{
            mode === "personal" ? __t("개인 작업 공간") : t(S.w.role)
          }}</small></span
        ><span
          class="profile-settings-icon"
          aria-hidden="true"
          ><CwIcon name="settings" /></span
      ></CwButton>
      <div
        v-if="mode !== 'personal'"
        class="rail-account-actions"
      >
        <CwButton
          action="access-account"
          class="small"
          >{{ __t("계정") }}</CwButton
        ><CwButton
          action="logout"
          class="ghost small"
          :title="__t('로그아웃')"
          >↗</CwButton
        >
      </div>
    </div>
  </aside>
</template>
