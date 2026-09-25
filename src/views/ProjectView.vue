<script setup>
import { t as __t } from "../i18n/index.js";

import { resolveEvaluationPolicy } from "../../shared/plan-evaluation-policy.mjs";
import { computed } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
const { S, canEdit } = useWorkspace();
const project = computed(() => S.w.document.projectSpec);
const evaluation = computed(() => resolveEvaluationPolicy(project.value));
</script>
<template>
  <PageHeading
    :label="__t('워크스페이스')"
    :title="__t('공통 설정 · 스킬')"
    :description="
      __t('공통 설정은 모든 명세 대화에, 스킬은 선택한 방식에 따라 적용합니다.')
    "
    ><CwButton
      action="edit-project"
      class="primary"
      :disabled="!canEdit"
      >{{ __t("공통 설정 편집") }}</CwButton
    ></PageHeading
  >
  <section class="common-settings">
    <h2>{{ __t("공통 설정") }}</h2>
    <div class="card">
      <h3>{{ __t("AI 공통 지침") }}</h3>
      <MarkdownContent
        v-if="project.instructions"
        :text="project.instructions"
      />
      <p
        v-else
        class="muted"
      >
        {{ __t("팀이 함께 지킬 작성 방식과 검토 기준을 작성하세요.") }}
      </p>
    </div>
    <div class="card">
      <h3>{{ __t("프로젝트 목적") }}</h3>
      <MarkdownContent
        v-if="project.purpose"
        :text="project.purpose"
      />
      <p
        v-else
        class="muted"
      >
        {{ __t("아직 작성하지 않았습니다.") }}
      </p>
    </div>
    <div
      v-for="[key, label] in [
        ['principles', '설계 · 개발 원칙'],
        ['constraints', '공통 제약'],
      ]"
      :key="key"
      class="card"
    >
      <h3>{{ label }}</h3>
      <ul
        v-if="project[key].length"
        class="criteria"
      >
        <li
          v-for="(item, index) in project[key]"
          :key="index"
        >
          {{ item }}
        </li>
      </ul>
      <p
        v-else
        class="muted"
      >
        {{ __t("아직 작성하지 않았습니다.") }}
      </p>
    </div>
  </section>
  <section
    class="workspace-evaluation"
    :aria-label="__t('워크스페이스 평가 기준')"
  >
    <div class="section-title">
      <div>
        <h2>{{ __t("평가 기준") }}</h2>
        <p class="muted">
          {{ __t("명세에 별도 설정이 없으면 이 기준으로 계획을 평가합니다.") }}
        </p>
      </div>
      <CwButton
        action="edit-workspace-evaluation"
        class="small"
        :disabled="!canEdit"
        >{{ __t("평가 기준 편집") }}</CwButton
      >
    </div>
    <div class="card">
      <p>
        <strong
          >{{ __t("목표") }} {{ evaluation.policy.targetScore
          }}{{ __t("점") }}</strong
        >
        ·
        {{
          evaluation.source === "workspace"
            ? __t("워크스페이스 직접 설정")
            : __t("시스템 기본값")
        }}
      </p>
      <div class="evaluation-labels">
        <span
          v-for="item in evaluation.policy.criteria"
          :key="item.id"
          class="pill"
          >{{ item.label }} {{ item.points }}{{ __t("점") }}</span
        >
      </div>
    </div>
  </section>
  <div class="project-instructions">
    <div class="section-title">
      <div>
        <h2>{{ __t("스킬") }}</h2>
        <p class="muted">
          {{
            __t("프로젝트에 함께 보관하고, 대화마다 필요한 지침을 적용합니다.")
          }}
        </p>
      </div>
    </div>
    <div class="note">
      {{
        __t("항상 적용 · 키워드 자동 선택 · 직접 호출을 선택하세요. 채팅에서")
      }}
      <code>$java-review</code
      >{{
        __t(
          "처럼 입력하면 스킬을 검색하고 호출할 수 있습니다. 적용한 지침은 응답에 표시됩니다.",
        )
      }}
    </div>
    <div class="section-title">
      <h3>
        {{ __t("등록된 스킬") }} <small>{{ project.skills.length }}</small>
      </h3>
      <CwButton
        action="instruction-new"
        data-kind="skills"
        class="small"
        :disabled="!canEdit"
        >{{ __t("+ 스킬") }}</CwButton
      >
    </div>
    <article
      v-for="skill in project.skills"
      :key="skill.id"
      class="card instruction-card"
    >
      <div class="row between">
        <div>
          <code>${{ skill.id }}</code>
          <span class="pill">{{
            skill.enabled
              ? {
                  always: __t("항상 적용"),
                  auto: __t("자동 선택"),
                  manual: __t("직접 호출"),
                }[skill.trigger]
              : __t("꺼짐")
          }}</span>
        </div>
        <CwButton
          action="instruction-edit"
          data-kind="skills"
          :data-id="skill.id"
          class="small ghost"
          :disabled="!canEdit"
          >{{ __t("편집") }}</CwButton
        >
      </div>
      <h3>{{ skill.name }}</h3>
      <p class="muted">{{ skill.description }}</p>
      <details>
        <summary>{{ __t("지침 내용") }}</summary>
        <MarkdownContent :text="skill.content" />
      </details>
      <small v-if="skill.trigger === 'auto'"
        >{{ __t("자동 선택 키워드:") }} {{ skill.keywords.join(", ") }}</small
      >
    </article>
    <div
      v-if="!project.skills.length"
      class="empty"
    >
      {{ __t("반복해서 사용할 검토·작성 절차를 추가하세요.") }}
    </div>
  </div>
</template>

<style scoped>
.workspace-evaluation {
  margin-block: 28px;
  display: grid;
  gap: 12px;
}
.workspace-evaluation .section-title {
  margin: 0;
  flex-wrap: wrap;
  gap: 12px;
}
.workspace-evaluation h2 {
  margin: 0;
}
.workspace-evaluation p {
  margin: 8px 0;
}
.evaluation-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
