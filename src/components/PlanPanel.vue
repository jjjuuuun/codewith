<script setup>
import { progressDeltaText } from "../i18n/plan-progress.js";
import { t as __t } from "../i18n/index.js";

import { resolvePlanRubric } from "../../shared/plan-evaluation-policy.mjs";
import { planStopLabels } from "../../shared/plan-loop.mjs";
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
import PlanProgressDetails from "./PlanProgressDetails.vue";
import PlanCriteriaStatus from "./PlanCriteriaStatus.vue";
import PlanReviewEditor from "./PlanReviewEditor.vue";
import PlanSkillList from "./PlanSkillList.vue";
import {
  PLAN_RUBRIC,
  planEvaluationSummary,
  planTargetScore,
} from "../../shared/plan-workflow.mjs";
import { planScoreStatus } from "../services/plan-status.js";
import { date } from "../services/format.js";
const { S, currentSpec: spec, canEdit, plans } = useWorkspace();
const reviewId = ref(new URLSearchParams(location.hash.slice(1)).get("review"));
const readReview = () => {
  reviewId.value = new URLSearchParams(location.hash.slice(1)).get("review");
};
onMounted(() => window.addEventListener("hashchange", readReview));
onBeforeUnmount(() => window.removeEventListener("hashchange", readReview));
const reviewURL = computed(
  () =>
    `/workspaces/${S.w.id}/specs/${spec.value.id}/plan#review=${version.value?.id}`,
);
const versions = computed(
  () => spec.value.plans || { versions: [], finalVersionId: null },
);
const visibleVersions = computed(() =>
  versions.value.versions.filter((v) => !v.deletedAt),
);
const version = computed(() => plans.current(spec.value));
const can = computed(() => canEdit.value && !S.busy);
const stale = computed(
  () =>
    version.value &&
    ((version.value.evaluation?.rubric &&
      JSON.stringify(version.value.evaluation.rubric) !==
        JSON.stringify(
          resolvePlanRubric(S.w.document.projectSpec, spec.value),
        )) ||
      S.w.planBases?.[spec.value.id] !== version.value.basis ||
      S.w.planCodeMatches?.[version.value.id] === false),
);
const index = computed(
  () => versions.value.versions.indexOf(version.value) + 1,
);
const final = computed(
  () => versions.value.finalVersionId === version.value?.id,
);
const targetScore = computed(() => planTargetScore(version.value));
const evaluation = computed(() => planEvaluationSummary(version.value));
const scoreStatus = computed(() => planScoreStatus(evaluation.value));
const activeTask = computed(() =>
  plans.execution.value?.workspaceId === S.w?.id &&
  plans.execution.value?.specId === spec.value?.id &&
  plans.execution.value?.active
    ? plans.execution.value
    : null,
);
const approvalReady = computed(
  () =>
    !stale.value &&
    evaluation.value?.passed === true &&
    !!version.value?.evaluation?.criteria?.length,
);
const primaryAction = computed(() => {
  if (final.value) return null;
  if (stale.value)
    return {
      action: "plan-continue",
      label: __t("이어서 개선"),
      description: __t(
        "최신 명세와 코드에 맞춰 계획을 수정하고 다시 평가합니다.",
      ),
    };
  if (!evaluation.value || !version.value?.evaluation?.criteria?.length)
    return null;
  if (approvalReady.value)
    return {
      action: "plan-select",
      label: __t("최종 승인"),
      description: __t(
        "검토한 이 버전을 개발 기준으로 지정합니다. 코드를 실행하거나 배포하지 않습니다.",
      ),
    };
  return {
    action: "plan-continue",
    label: __t("이어서 개선"),
    description: __t(
      "부족한 기준과 평가 지적을 AI가 보완하고, 명세의 목표 점수까지 한도 안에서 재평가합니다.",
    ),
  };
});
const loop = computed(() => version.value?.execution?.loop);
const outcome = computed(() => {
  if (stale.value)
    return {
      tone: "warning",
      title: __t("기준 변경 · 재검토 필요"),
      reason: __t(
        "명세·코드 또는 평가 기준이 변경되어 이전 평가로는 승인할 수 없습니다.",
      ),
      next: __t("최신 기준으로 이어서 개선하세요."),
    };
  if (approvalReady.value)
    return {
      tone: "success",
      title: final.value
        ? __t("목표 달성 · 승인됨")
        : __t("목표 달성 · 승인 대기"),
      reason: __t("목표 점수와 필수 기준을 충족했고 차단 문제가 없습니다."),
      next: final.value
        ? __t("승인된 계획을 구현 기준으로 사용하세요.")
        : __t("계획서 내용을 검토한 뒤 최종 승인하세요."),
    };
  if (!evaluation.value)
    return {
      tone: "neutral",
      title: __t("평가 필요"),
      reason: __t(
        "이 버전에는 AI 평가가 없습니다. 이전 버전의 점수는 이어받지 않습니다.",
      ),
      next: __t("제목 옆 아이콘으로 계획서를 열어 평가하세요."),
    };
  const reason = loop.value?.stopReason;
  const explanations = {
    call_budget: __t(
      "설정한 AI 요청 한도로는 다음 개선과 평가를 진행할 수 없어 멈췄습니다.",
    ),
    time_budget: __t("설정한 실행 시간이 끝나 멈췄습니다."),
    stagnation: __t(
      "접근 방법을 바꾼 뒤에도 최선의 평가 대비 의미 있는 진전이 없어 멈췄습니다.",
    ),
    interrupted: __t("사용자의 중지 요청으로 실행을 끝냈습니다."),
    execution_failed: __t(
      "실행 중 오류로 후속 개선을 진행하지 못했습니다. 오류 상세는 계획 대화의 해당 세션에서 확인하세요.",
    ),
    evaluated: __t("평가만 실행했으므로 계획을 자동으로 수정하지 않았습니다."),
    round_limit: __t("이전 실행 방식의 개선 횟수 한도에 도달했습니다."),
  };
  return {
    tone: reason === "execution_failed" ? "error" : "warning",
    title: __t(planStopLabels[reason]) || __t("목표 미달 · 보완 필요"),
    reason:
      explanations[reason] ||
      __t(
        "목표 점수, 필수 기준 또는 차단 문제 조건이 아직 충족되지 않았습니다.",
      ),
    next:
      loop.value?.nextAction ||
      __t("아래 보완 항목을 확인하고 이어서 개선하세요."),
  };
});
const scoreLabel = (v) => {
  const e = planEvaluationSummary(v);
  return e
    ? __t("{0} / 100점 · {1}명 평가", [(e.score * 10).toFixed(1), e.count])
    : __t("미평가");
};
const legacy = computed(() =>
  [
    spec.value.decisions,
    spec.value.codeScope,
    ...spec.value.tasks.map((x) => x.text),
  ]
    .filter(Boolean)
    .join("\n\n"),
);
</script>
<template>
  <PlanReviewEditor
    v-if="reviewId"
    :version-id="reviewId"
  />
  <div
    v-else
    class="plan-panel"
  >
    <div class="plan-heading">
      <div>
        <h2>{{ __t("구현 계획") }}</h2>
        <p class="muted">
          {{
            __t("명세 기준과 설정한 목표 점수를 충족한 계획을 검토·승인하세요.")
          }}
        </p>
      </div>
      <div class="plan-heading-actions">
        <CwButton
          action="edit-spec-evaluation"
          class="small"
          :disabled="!can"
          >{{ __t("평가 기준") }}</CwButton
        >
        <CwButton
          action="plan-settings"
          class="small"
          :title="__t('계획 실행 설정')"
          :aria-label="__t('계획 실행 설정')"
          :disabled="!can || !S.connected"
          ><CwIcon name="settings"
        /></CwButton>
        <CwButton
          v-if="version"
          action="plan-generate"
          class="small"
          :disabled="!can"
          >{{ __t("새 계획 작성") }}</CwButton
        >
      </div>
    </div>
    <section
      v-if="activeTask"
      class="card"
      :aria-label="__t('계획 개선 상태')"
    >
      <div class="row between">
        <h3>
          {{ __t("계획 개선 중")
          }}{{
            activeTask.loop
              ? __t(" · 평가 {0}회", [activeTask.loop.round + 1])
              : ""
          }}
        </h3>
        <CwButton @click="plans.stop">{{ __t("실행 중지") }}</CwButton>
      </div>
      <p role="status">{{ activeTask.message }}</p>
      <p v-if="activeTask.loop?.delta">
        {{ __t("최선의 이전 평가 대비:") }}
        {{ progressDeltaText(activeTask.loop.delta) }} {{ __t("· 현재 최선") }}
        {{ (activeTask.loop.bestScore * 10).toFixed(1) }}{{ __t("점") }}
      </p>
      <p v-if="activeTask.loop?.nextAction">
        {{ __t("현재 보완:") }} {{ activeTask.loop.nextAction }}
      </p>
      <PlanCriteriaStatus
        v-if="activeTask.loop"
        :summary="activeTask.loop"
      />
      <CwButton
        class="small"
        @click="plans.showProgress"
        >{{ __t("질문 · 실행 상세") }}</CwButton
      >
    </section>
    <section
      v-if="!version"
      class="plan-empty card"
    >
      <CwButton
        action="plan-generate"
        class="primary"
        :disabled="!can || !spec.requirements.length"
        >{{
          plans.execution.value?.active
            ? __t("계획 개선 중…")
            : __t("명세 기반 계획 작성")
        }}</CwButton
      >
    </section>
    <template v-else>
      <section
        class="plan-detail plan-version-history"
        :aria-label="__t('계획 버전 이력')"
      >
        <h3>
          {{ __t("버전 이력 ·") }} {{ visibleVersions.length }}{{ __t("개") }}
        </h3>
        <div
          class="plan-version-list"
          :aria-label="__t('계획 버전')"
        >
          <div
            v-for="v in [...visibleVersions].reverse()"
            :key="v.id"
            class="plan-version-row"
          >
            <CwButton
              action="plan-view"
              class="plan-version"
              :class="{ active: v.id === version.id }"
              :data-id="v.id"
              :aria-pressed="v.id === version.id"
              :disabled="S.busy"
              ><b
                >v{{ versions.versions.indexOf(v) + 1
                }}{{
                  versions.finalVersionId === v.id ? __t(" · 승인") : ""
                }}</b
              ><small>{{ v.title }}</small
              ><small
                class="plan-status-text"
                :data-plan-tone="planScoreStatus(planEvaluationSummary(v)).tone"
                >{{ scoreLabel(v) }}</small
              ></CwButton
            >
            <CwButton
              action="plan-delete"
              :data-id="v.id"
              :disabled="!can"
              :aria-label="
                __t('v{0} 계획 삭제', [versions.versions.indexOf(v) + 1])
              "
              :title="__t('계획 버전 삭제')"
              class="small ghost plan-version-delete"
              ><CwIcon name="trash"
            /></CwButton>
          </div>
        </div>
      </section>
      <section class="plan-view">
        <div class="plan-version-head">
          <div>
            <div class="plan-title-row">
              <h3>v{{ index }} · {{ version.title }}</h3>
              <CwButton
                class="small plan-open"
                data-action="plan-edit"
                :href="reviewURL"
                target="_blank"
                rel="noopener"
                :aria-label="__t('새 탭에서 계획 보기 및 직접 편집')"
                :title="__t('새 탭에서 계획 보기 · 직접 편집')"
                ><CwIcon name="externalLink"
              /></CwButton>
            </div>
            <p>
              {{ version.author.name }} · {{ date(version.createdAt) }} ·
              {{
                version.source === "ai"
                  ? version.model || "AI"
                  : __t("직접 작성")
              }}{{
                version.parentId
                  ? " · v" +
                    (versions.versions.findIndex(
                      (x) => x.id === version.parentId,
                    ) +
                      1) +
                    __t("에서 수정")
                  : ""
              }}
            </p>
          </div>
          <span
            class="pill"
            :class="{ accepted: final }"
            >{{
              final
                ? __t("승인됨")
                : stale
                  ? __t("기준 변경 · 재검토")
                  : !approvalReady
                    ? __t("수정 필요")
                    : __t("검토 대기")
            }}</span
          >
        </div>
        <div
          v-if="primaryAction || final"
          class="plan-action-area"
        >
          <div
            class="plan-actions"
            role="group"
            :aria-label="__t('계획 작업')"
          >
            <CwButton
              v-if="primaryAction"
              :action="primaryAction.action"
              :disabled="!can"
              class="primary small"
              :title="primaryAction.description"
              >{{ primaryAction.label }}</CwButton
            >
            <CwButton
              v-if="final"
              action="plan-select"
              :disabled="!can"
              class="small"
              :title="
                __t(
                  '개발 기준으로 지정한 승인을 해제합니다. 계획은 유지됩니다.',
                )
              "
              >{{ __t("승인 해제") }}</CwButton
            >
          </div>
        </div>
        <section
          class="plan-evaluation"
          :aria-label="__t('계획 평가')"
        >
          <div class="evaluation-heading">
            <div>
              <h3>
                {{ __t("AI 평가 ·") }}
                {{ evaluation ? __t("최종 평가 결과") : __t("미평가") }}
              </h3>
              <p class="muted">
                {{ __t("현재 선택한 v") }}{{ index
                }}{{ __t("에 대한 평가입니다.") }}
              </p>
            </div>
            <div
              v-if="evaluation"
              class="evaluation-score plan-status-surface"
              :data-plan-tone="scoreStatus.tone"
            >
              <b class="score-status-label">{{ scoreStatus.label }}</b>
              <strong
                >{{ (evaluation.score * 10).toFixed(1) }}
                {{ __t("/ 100점") }}</strong
              >
              <span
                >{{
                  evaluation.requirementScores?.length > 1
                    ? __t("요구사항별 목표 평균")
                    : __t("이 버전 목표")
                }}
                {{ targetScore }}{{ __t("점 ·") }} {{ evaluation.count
                }}{{ __t("명 평균") }}</span
              >
            </div>
          </div>
          <PlanCriteriaStatus
            :summary="evaluation"
            :show-score="false"
            show-issues
            group-criteria
          >
            <template #after-metrics>
              <section
                class="plan-outcome plan-status-surface"
                :data-plan-tone="outcome.tone"
                :aria-label="__t('계획 결과와 다음 행동')"
              >
                <h4>{{ outcome.title }}</h4>
                <p>
                  <b>{{ __t("이유") }}</b> · {{ outcome.reason }}
                </p>
                <p>
                  <b>{{ __t("다음 행동") }}</b> · {{ outcome.next }}
                </p>
                <p
                  v-if="loop && !approvalReady && !stale"
                  class="muted"
                >
                  {{
                    __t(
                      "평가를 마친 시도 중 가장 나은 계획을 표시합니다. 개별 AI 응답 완료는 목표 달성을 뜻하지 않습니다.",
                    )
                  }}
                </p>
              </section>
              <details
                v-if="version.execution?.loop?.rounds?.length"
                class="plan-detail plan-improvement-history"
                open
              >
                <summary>{{ __t("개선 이력") }}</summary>
                <p
                  v-for="round in version.execution.loop.rounds"
                  :key="round.round"
                >
                  {{ __t("평가") }} {{ round.round + 1 }}{{ __t("회 ·") }}
                  {{ ((round.latestScore ?? round.score) * 10).toFixed(1)
                  }}{{ __t("점 · 차단") }} {{ round.blockingIssues.length
                  }}{{ __t("건 ·") }}
                  {{
                    round.criteria.filter((c) => c.status === "pass").length
                  }}/{{ round.criteria.length }}{{ __t("개 기준 충족") }}
                  <span v-if="round.delta">
                    · {{ progressDeltaText(round.delta) }} ·
                    {{
                      round.approach === "alternative"
                        ? __t("접근 변경")
                        : __t("기준 보완")
                    }}</span
                  >
                </p>
              </details>
            </template>
          </PlanCriteriaStatus>
          <template v-if="evaluation">
            <PlanProgressDetails
              class="evaluation-candidates"
              :title="__t('점수 산정 근거 · 후보와 평가자')"
            >
              <p class="muted">
                {{
                  __t(
                    "품질 항목별 점수와 평가자의 설명입니다. 위의 명세별 충족 여부와 구분해 볼 수 있습니다.",
                  )
                }}
              </p>
              <p class="muted">
                {{ date(version.evaluation.evaluatedAt) }}
                {{ __t("· 평가 기준") }} {{ version.evaluation.rubricId }}
                {{ __t("· 점수는 성공 확률이 아닙니다.") }}
              </p>
              <PlanProgressDetails
                v-for="candidate in version.evaluation.candidates"
                :key="candidate.id"
                class="evaluation-candidate"
              >
                <template #title>
                  {{ candidate.id
                  }}{{
                    candidate.id === version.evaluation.selectedId
                      ? __t(" · 제시된 후보")
                      : ""
                  }}
                  · {{ candidate.provider }} / {{ candidate.model }}
                </template>
                <div
                  v-for="(review, i) in candidate.reviews"
                  :key="i"
                  class="plan-review"
                >
                  <b
                    >{{ __t("평가자") }} {{ i + 1 }} · {{ review.provider }} /
                    {{ review.model }}</b
                  >
                  <dl>
                    <template
                      v-for="criterion in version.evaluation.rubric?.criteria ||
                      PLAN_RUBRIC.criteria"
                      :key="criterion.id"
                      ><dt>
                        {{
                          criterion.requirementId
                            ? criterion.requirementId + " · "
                            : ""
                        }}{{ criterion.label }} ·
                        {{ (review.scores[criterion.id] * 10).toFixed(1) }} /
                        {{ criterion.max * 10 }}{{ __t("점") }}
                      </dt>
                      <dd>
                        <p
                          v-if="criterion.description"
                          class="muted"
                        >
                          {{ __t("판단 기준:") }} {{ criterion.description }}
                        </p>
                        {{ review.reasons[criterion.id] }}
                      </dd></template
                    >
                  </dl>
                  <template
                    v-if="candidate.id !== version.evaluation.selectedId"
                  >
                    <p
                      v-for="issue in review.blockingIssues"
                      :key="issue"
                    >
                      {{ __t("차단 문제:") }} {{ issue }}
                    </p>
                  </template>
                  <p
                    v-for="suggestion in review.suggestions"
                    :key="suggestion"
                  >
                    {{ __t("제안:") }} {{ suggestion }}
                  </p>
                </div>
              </PlanProgressDetails>
            </PlanProgressDetails>
          </template>
        </section>
      </section>
    </template>
    <details class="plan-detail">
      <summary>{{ __t("계획 작성 지침") }}</summary>
      <PlanSkillList
        :skills="S.w.document.projectSpec.skills"
        :editable="can"
      />
    </details>
    <details
      v-if="versions.approvals?.length"
      class="card"
    >
      <summary>{{ __t("사람의 승인 이력") }}</summary>
      <p
        v-for="(approval, i) in versions.approvals"
        :key="i"
      >
        {{ date(approval.at) }} · {{ approval.by.name }} ·
        {{
          approval.versionId
            ? "v" +
              (versions.versions.findIndex((v) => v.id === approval.versionId) +
                1) +
              __t(" 승인")
            : __t("승인 해제")
        }}
      </p>
    </details>
    <details
      v-if="legacy"
      class="card legacy-plan"
    >
      <summary>{{ __t("이전 계획 기록") }}</summary>
      <p>
        {{ __t("기존 내용을 보관했습니다. AI 계획 생성 시 함께 전달됩니다.") }}
      </p>
      <pre>{{ legacy }}</pre>
    </details>
  </div>
</template>

<style scoped>
.plan-panel {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.plan-panel > .card {
  margin: 0;
}
.plan-version-row {
  position: relative;
  flex: 0 0 230px;
  display: flex;
  min-width: 0;
}
.plan-version-row .plan-version {
  flex: 1;
  min-width: 0;
  max-width: none;
  padding-right: 44px;
}
.plan-version-delete {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 30px;
  width: 30px;
  height: 30px;
  padding: 0;
}
.plan-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.plan-title-row h3 {
  min-width: 0;
}
.plan-heading {
  flex-wrap: wrap;
}
.plan-heading-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.plan-view {
  display: grid;
  gap: 24px;
  padding-top: 24px;
}
.plan-version-head {
  padding: 0 24px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.plan-version-head > div {
  min-width: 0;
  flex: 1 1 240px;
}
.plan-version-head h3 {
  overflow-wrap: anywhere;
}
.plan-version-head p {
  font-size: 13px;
  line-height: 1.8;
}
.plan-version-head .pill {
  flex-shrink: 0;
}
.plan-evaluation {
  margin: 0 24px;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 12px;
  display: grid;
  gap: 20px;
  min-width: 0;
}
.plan-evaluation {
  background: var(--bg);
}
.plan-evaluation :is(h3, h4, p) {
  margin: 0;
}
.plan-evaluation p {
  line-height: 1.8;
}
.evaluation-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
}
.evaluation-heading .muted {
  margin-top: 6px;
}
.evaluation-score {
  display: grid;
  gap: 2px;
  color: var(--plan-tone);
  padding: 12px 16px;
  border-left: 4px solid var(--plan-tone);
}
.evaluation-score strong {
  font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.score-status-label {
  font-size: 12px;
}
.evaluation-score span {
  color: var(--muted);
  font-size: 13px;
}
.plan-outcome {
  display: grid;
  gap: 10px;
  padding: 16px;
  margin: 16px 0;
  border-left: 4px solid var(--plan-tone);
  border-radius: 10px;
  overflow-wrap: anywhere;
}
.plan-improvement-history {
  margin: 16px 0;
}
.plan-improvement-history p + p {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.evaluation-candidate {
  margin-top: 12px;
}
.evaluation-candidates p + p {
  margin-top: 10px;
}
.plan-detail {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 16px;
  min-width: 0;
  background: var(--paper);
}
.plan-version-history {
  padding: 16px;
}
.plan-version-history > h3 {
  margin: 0 0 16px;
  font-size: 14px;
}
.plan-detail > summary {
  padding: 16px 0;
  cursor: pointer;
  font-weight: 600;
  overflow-wrap: anywhere;
  line-height: 1.75;
}
.plan-detail[open] > summary {
  margin-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.plan-detail[open] {
  padding-bottom: 16px;
}
.plan-review {
  margin: 16px 0 0;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.plan-review dl {
  margin-top: 20px;
}
.plan-review dt {
  font-weight: 600;
}
.plan-review dd {
  margin: 6px 0 20px;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.plan-review p + p {
  margin-top: 12px;
}
.plan-evaluation pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 360px;
  overflow: auto;
}
.plan-action-area {
  padding: 0 24px 20px;
}
.plan-actions {
  padding: 0;
  gap: 8px;
  align-items: center;
}
.plan-actions :deep(.v-btn) {
  min-height: 36px;
  height: 36px;
}
.plan-title-row .plan-open {
  flex-shrink: 0;
  height: 36px;
  min-height: 36px;
  min-width: 36px;
  width: 36px;
  padding: 0;
}
@media (max-width: 600px) {
  .plan-view {
    gap: 20px;
    padding-top: 16px;
  }
  .plan-version-head {
    padding: 0 16px;
  }
  .plan-evaluation {
    margin: 0 12px;
    padding: 16px;
  }
  .plan-action-area {
    padding: 0 16px 20px;
  }
  .plan-review {
    padding: 14px;
  }
}
</style>
