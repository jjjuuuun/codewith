<script setup>
import { t as __t } from "../i18n/index.js";

import { computed } from "vue";
import { defaultPlanSkill, defaultPlanUISkill } from "../../shared/plans.mjs";
import {
  defaultPlanReviewSkill,
  defaultPlanFlowSkill,
} from "../../shared/plan-workflow.mjs";
const props = defineProps({
  skills: { type: Array, required: true },
  editable: Boolean,
});
const roles = [
  [
    defaultPlanSkill.id,
    __t("계획 작성"),
    __t("요구사항별 구현 방법, 코드 변경과 완료 기준을 작성합니다."),
  ],
  [
    defaultPlanUISkill.id,
    __t("계획서 화면"),
    __t("탭·섹션·코드 비교 등 HTML 계획서의 표시 형식을 맞춥니다."),
  ],
  [
    defaultPlanReviewSkill.id,
    __t("검증·채점"),
    __t("요구사항 충족 여부와 구현 가능성을 검토하고 점수를 매깁니다."),
  ],
  [
    defaultPlanFlowSkill.id,
    __t("작성·검토 절차"),
    __t("후보 작성, 교차 검토, 수정과 최종 평가 절차를 정합니다."),
  ],
];
const items = computed(() =>
  roles.map(([id, role, description]) => ({
    id,
    role,
    description,
    skill: props.skills.find((s) => s.id === id),
  })),
);
</script>
<template>
  <section
    class="plan-skills card"
    :aria-label="__t('계획 작성 스킬')"
  >
    <header>
      <h3>{{ __t("계획 작성 스킬") }}</h3>
      <p class="muted">
        {{
          __t(
            "다음 계획 생성에 사용할 지침입니다. 배점과 목표 점수는 명세 또는 워크스페이스의 평가 기준 설정을 우선합니다.",
          )
        }}
      </p>
    </header>
    <ul class="plan-skill-grid">
      <li
        v-for="item in items"
        :key="item.id"
        class="plan-skill-card"
      >
        <div class="plan-skill-card-head">
          <span class="eyebrow">{{ item.role }}</span>
          <CwButton
            v-if="item.skill"
            action="instruction-edit"
            data-kind="skills"
            :data-id="item.id"
            class="ghost small"
            :disabled="!editable"
            :aria-label="item.skill.name + __t(' 편집')"
            :title="item.skill.name + __t(' 편집')"
            ><CwIcon name="edit"
          /></CwButton>
        </div>
        <b>{{ item.skill?.name || item.role }}</b>
        <p>{{ item.description }}</p>
        <small>{{
          !item.skill
            ? __t("기본 제공 지침 사용")
            : item.skill.enabled
              ? __t("활성화")
              : __t("비활성화")
        }}</small>
      </li>
    </ul>
    <footer class="plan-skill-footer">
      <CwButton
        v-if="!skills.some((s) => s.id === defaultPlanSkill.id)"
        action="plan-install-skill"
        class="small"
        :disabled="!editable"
        >{{ __t("기본 스킬 추가") }}</CwButton
      >
      <CwButton
        action="plan-reset-skills"
        class="ghost small"
        :disabled="!editable"
        >{{ __t("기본 계획 스킬 복원") }}</CwButton
      >
    </footer>
  </section>
</template>
<style scoped>
.plan-skills {
  margin: 20px 0;
  padding: 20px;
}
.plan-skills header p {
  margin: 8px 0 16px;
  font-size: 12px;
}
.plan-skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
  gap: 12px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.plan-skill-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.plan-skill-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}
.plan-skill-card p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
.plan-skill-card small {
  margin-top: auto;
  color: var(--muted);
}
.plan-skill-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--line);
  margin-top: 16px;
  padding-top: 12px;
}
</style>
