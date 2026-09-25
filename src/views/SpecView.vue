<script setup>
import { t as __t } from "../i18n/index.js";

import { ref, onMounted, onBeforeUnmount } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
import { specStatus } from "../../shared/completion.mjs";
import { t } from "../services/i18n.js";
import { date } from "../services/format.js";
import InlineEditor from "../components/forms/InlineEditor.vue";
import RequirementCard from "../components/RequirementCard.vue";
import PlanPanel from "../components/PlanPanel.vue";
const { S, currentSpec: spec, canEdit } = useWorkspace();
const header = ref();
const topbarHeight = ref(65);
const headerHeight = ref(0);
let observer;
onMounted(() => {
  const topbar = header.value?.closest(".center")?.querySelector(".topbar");
  if (!topbar || !header.value) return;
  const measure = () => {
    topbarHeight.value = topbar.getBoundingClientRect().height;
    headerHeight.value = header.value.getBoundingClientRect().height;
  };
  observer = new ResizeObserver(measure);
  observer.observe(topbar);
  observer.observe(header.value);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <div
    v-if="spec"
    class="spec-view"
    :style="{
      '--spec-header-top': topbarHeight + 'px',
      '--spec-scroll-offset': topbarHeight + headerHeight + 16 + 'px',
    }"
  >
    <div
      ref="header"
      class="spec-header"
    >
      <PageHeading
        :label="spec.id"
        :title="spec.title"
        ><template #badge
          ><span
            class="pill"
            :class="specStatus(spec)"
            >{{ t(specStatus(spec)) }}</span
          ></template
        ><CwButton
          action="edit-spec"
          class="small"
          :disabled="!canEdit"
          >{{ __t("편집") }}</CwButton
        ><CwButton
          action="delete-spec"
          class="small danger"
          :disabled="!canEdit"
          >{{ __t("삭제") }}</CwButton
        ></PageHeading
      >
      <div
        class="row muted"
        style="font-size: 11px"
      >
        {{ __t("최근 작성") }} {{ spec.updatedBy?.name || "—" }} ·
        {{ spec.updatedAt ? date(spec.updatedAt) : "" }}
      </div>
      <div
        class="tabs"
        role="tablist"
      >
        <CwButton
          v-for="(tab, index) in ['requirements', 'design']"
          :key="tab"
          action="tab"
          :data-tab="tab"
          :class="{ active: S.tab === tab }"
          role="tab"
          :aria-selected="S.tab === tab"
          ><span class="step-circle">{{ index + 1 }}</span
          >{{ t(tab === "requirements" ? "requirementsTab" : tab) }}</CwButton
        >
      </div>
    </div>
    <InlineEditor />
    <template v-if="S.tab === 'requirements'"
      ><div class="section-title">
        <h3>
          {{ __t("요구사항") }} <small>{{ spec.requirements.length }}</small>
        </h3>
        <CwButton
          action="new-requirement"
          class="primary small"
          :disabled="!canEdit"
          >{{ __t("+ 요구사항") }}</CwButton
        >
      </div>
      <div :data-requirement-list="spec.id">
        <RequirementCard
          v-for="r in spec.requirements"
          :key="r.id"
          :requirement="r"
          :spec="spec"
        />
        <InlineEditor :requirement-spec="spec.id" />
        <div
          v-if="!spec.requirements.length"
          class="empty"
        >
          {{ __t("어떤 조건에서 시스템이 어떻게 동작해야 하는지 작성하세요.")
          }}<br />{{ __t("완료 기준은 각각 독립된 항목으로 추가합니다.") }}
        </div>
      </div>
    </template>
    <PlanPanel v-else />
    <div class="step-footer">
      <span class="muted"
        >{{ S.tab === "requirements" ? 1 : 2 }} {{ __t("/ 2 단계") }}</span
      >
      <div class="row">
        <CwButton
          v-if="S.tab === 'design'"
          action="tab"
          data-tab="requirements"
          >{{ __t("← 이전 단계") }}</CwButton
        ><CwButton
          v-if="S.tab === 'requirements'"
          action="tab"
          data-tab="design"
          class="primary"
          >{{ __t("다음:") }} {{ t("design") }} →</CwButton
        ><CwButton
          v-else
          action="view"
          data-view="workspace"
          >{{ __t("워크스페이스로") }}</CwButton
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.spec-header {
  position: sticky;
  top: var(--spec-header-top);
  z-index: 1;
  margin-top: -16px;
  margin-bottom: 25px;
  padding-top: 16px;
  background: var(--bg);
}
.spec-header .tabs {
  margin-bottom: 0;
}
.spec-view :deep([data-requirement-card]),
.spec-view :deep(.inline-editor) {
  scroll-margin-top: var(--spec-scroll-offset);
}
</style>
