<script setup>
import { progressDeltaText } from "../i18n/plan-progress.js";
import { t as __t } from "../i18n/index.js";

import { planStopLabels } from "../../shared/plan-loop.mjs";
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import PlanProgressDetails from "./PlanProgressDetails.vue";
import PlanCriteriaStatus from "./PlanCriteriaStatus.vue";
import { useWorkspace } from "../composables/useWorkspace.js";
const { plans, S, canEdit } = useWorkspace();
const task = plans.execution;
const now = ref(Date.now());
let timer;
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));
const seconds = (at) =>
  Math.max(0, Math.floor(((task.value?.endedAt || now.value) - at) / 1000));
const elapsed = computed(() =>
  task.value ? seconds(task.value.startedAt) : 0,
);
const duration = (s) => __t("{0}분 {1}초", [Math.floor(s / 60), s % 60]);
const stateLabel = (step) =>
  ({
    running: __t("진행 중"),
    paused: __t("정지 · 재시작 가능"),
    repairing: __t("검사 실패 · 자동 수정"),
    completed: __t("응답 완료"),
    stopped: __t("함께 중지됨"),
    failed: task.value?.active
      ? __t("실패 · 재시작 대기")
      : __t("실패 · 중단 원인"),
    waiting: __t("답변 대기"),
    unknown: __t("연결 끊김 · 상태 확인 필요"),
  })[step.status];
</script>
<template>
  <section
    v-if="task"
    id="plan-progress"
    class="plan-chat-progress"
    :aria-label="__t('계획 진행 대화')"
  >
    <div class="bubble user">
      <div class="byline">{{ __t("계획 요청 ·") }} {{ task.title }}</div>
      <MarkdownContent
        :text="task.request || __t('요구사항을 바탕으로 계획 작성')"
      />
    </div>
    <div class="bubble assistant">
      <div class="row between plan-progress-heading">
        <b>{{
          task.phase === "disconnected"
            ? __t("계획 서버 연결 끊김")
            : task.phase === "questions"
              ? __t("계획 확인 질문")
              : task.active
                ? __t("계획 생성 중")
                : task.phase === "cancelled"
                  ? __t("계획 중지됨")
                  : task.error
                    ? __t("계획 생성 중단")
                    : task.loop?.stopReason === "target_met"
                      ? __t("목표 달성 · 승인 대기")
                      : __t(planStopLabels[task.loop?.stopReason]) ||
                        __t("목표 미달 · 결과 저장")
        }}</b>
        <CwButton
          v-if="task.active || task.phase === 'questions'"
          class="ghost small"
          data-action="stop-plan"
          :aria-label="__t('계획 중지')"
          :title="__t('계획 중지')"
          :disabled="task.phase === 'preparing'"
          @click="plans.stop"
          ><CwIcon name="stop"
        /></CwButton>
        <CwButton
          v-else
          class="ghost small"
          data-action="restart-plan"
          :aria-label="
            task.phase === 'disconnected' && task.job
              ? __t('계획 다시 연결')
              : __t('계획 다시 시작')
          "
          :title="
            task.phase === 'disconnected' && task.job
              ? __t('계획 다시 연결')
              : __t('계획 다시 시작')
          "
          :disabled="S.busy || !canEdit"
          @click="plans.restart"
          ><CwIcon name="refresh"
        /></CwButton>
      </div>
      <template v-if="task.phase === 'questions'">
        <p
          class="question-position"
          role="status"
        >
          <template v-if="task.currentQuestion"
            >{{ task.currentQuestion.stage }} {{ __t("· 확인 질문") }}</template
          >
          <template v-else
            >{{ __t("질문") }} {{ task.questionIndex + 1 }} /
            {{ task.questions.length }}</template
          >
        </p>
        <p class="plan-question-text">
          {{ task.questions[task.questionIndex] }}
        </p>
        <p class="muted">{{ __t("아래 입력창에 답변을 작성해 주세요.") }}</p>
        <p
          v-if="task.answerError"
          role="alert"
        >
          {{ task.answerError }}
        </p>
        <div class="row between">
          <CwButton
            v-if="task.questionIndex > 0"
            class="small"
            @click="
              task.questionIndex--;
              task.answerError = '';
            "
            >{{ __t("이전 질문") }}</CwButton
          >
          <CwButton
            class="small primary plan-question-next"
            :disabled="
              task.answerSubmitting || (S.busy && !task.currentQuestion)
            "
            @click="plans.answerCurrentQuestion"
            >{{
              task.currentQuestion
                ? __t("답변 보내기")
                : task.questionIndex < task.questions.length - 1
                  ? __t("다음 질문")
                  : __t("답변하고 계획 생성")
            }}</CwButton
          >
        </div>
      </template>
      <PlanProgressDetails
        v-if="task.questionQueue?.some((q) => q.answered)"
        :title="__t('전달한 질문·답변')"
      >
        <div
          v-for="question in task.questionQueue.filter((q) => q.answered)"
          :key="question.id"
        >
          <p>
            <b>{{ question.stage }}</b> · {{ question.question }}
          </p>
          <MarkdownContent :text="question.answer" />
        </div>
      </PlanProgressDetails>
      <template v-if="task.phase !== 'questions' || task.currentQuestion">
        <p
          :role="task.error ? 'alert' : 'status'"
          style="white-space: pre-wrap"
        >
          {{ task.message }}
        </p>
        <p
          v-if="task.error && task.failure?.stage"
          class="muted"
        >
          {{
            __t(
              "이 단계의 오류로 나머지 진행 중인 에이전트도 함께 중지했습니다. 완료된 응답이 있어도 이번 실행의 새 계획은 저장하지 않았습니다.",
            )
          }}
        </p>
        <p
          v-if="
            task.active && Object.values(task.agents || {}).includes('failed')
          "
          role="alert"
        >
          {{
            __t(
              "실패한 세션은 재시작을 기다리고 있습니다. 해당 항목을 눌러 오류를 확인하고 재시작하세요. 다른 세션은 계속 진행합니다.",
            )
          }}
        </p>
        <v-progress-linear
          v-if="task.active"
          indeterminate
          color="primary"
          :aria-label="__t('계획 생성 중')"
        />
        <section
          v-if="task.loop"
          class="plan-progress-evaluation"
          :aria-label="__t('계획 평가 결과')"
        >
          <div class="byline">{{ __t("계획 평가 결과") }}</div>
          <PlanCriteriaStatus :summary="task.loop" />
          <p v-if="task.loop?.delta">
            {{ __t("최선의 이전 평가 대비:") }}
            {{ progressDeltaText(task.loop.delta) }}
          </p>
          <p v-if="task.loop?.nextAction">
            {{ __t("다음 행동:") }} {{ task.loop.nextAction }}
          </p>
        </section>
        <PlanProgressDetails
          class="plan-execution-details"
          :title="__t('실행 상세')"
        >
          <div class="plan-progress-metrics">
            <span>{{ __t("경과") }} {{ duration(elapsed) }}</span
            ><span v-if="task.total"
              >{{ __t("AI 응답") }} {{ task.completed
              }}{{ __t("회 · 요청 상한") }} {{ task.total
              }}{{ __t("회") }}</span
            >
            <span
              >{{ __t("응답 수신") }} {{ task.chars.toLocaleString()
              }}{{ __t("자") }}</span
            >
            <span v-if="task.active && task.lastSignalAt"
              >{{ __t("서버 신호") }} {{ seconds(task.lastSignalAt)
              }}{{ __t("초 전") }}</span
            >
            <span v-if="task.active && task.lastOutputAt"
              >{{ __t("응답 수신") }} {{ seconds(task.lastOutputAt)
              }}{{ __t("초 전") }}</span
            >
          </div>
        </PlanProgressDetails>
        <p
          v-if="task.active"
          class="muted"
        >
          {{
            __t(
              "다른 에이전트의 작업은 계속됩니다. 새로고침 후에도 서버 작업에 다시 연결합니다. 수신 글자 수는 완성률이 아닙니다.",
            )
          }}
        </p>
        <p
          v-if="
            task.active && task.lastSignalAt && seconds(task.lastSignalAt) > 35
          "
          role="status"
        >
          {{ __t("서버 신호가 지연되고 있습니다. 연결 상태를 확인해 주세요.") }}
        </p>
        <PlanProgressDetails
          v-if="task.steps.length"
          :title="__t('단계별 실행 기록')"
        >
          <ol class="plan-progress-steps">
            <li
              v-for="step in task.steps"
              :key="step.call"
            >
              <CwButton
                class="ghost small agent-step"
                :aria-label="step.stage + __t(' 응답 보기')"
                @click="plans.inspectStep(step)"
                >{{ step.stage }} · {{ stateLabel(step) }}
                <CwIcon name="chevronRight" /></CwButton
              ><span>{{ step.provider }} / {{ step.model }}</span
              ><span
                >{{ step.chars.toLocaleString() }}{{ __t("자 ·") }}
                {{
                  duration(
                    step.durationMs != null
                      ? Math.floor(step.durationMs / 1000)
                      : seconds(step.startedAt),
                  )
                }}</span
              >
            </li>
          </ol>
        </PlanProgressDetails>
      </template>
    </div>
  </section>
</template>
<style scoped>
.agent-step {
  align-self: flex-start;
  text-align: left;
  height: auto;
}
.agent-step :deep(.v-btn__content) {
  white-space: normal;
}
.plan-question-next {
  margin-left: auto;
}
.plan-chat-progress {
  font-size: 16px;
  line-height: 1.65;
  display: grid;
  gap: 18px;
}
.plan-chat-progress :deep(.markdown),
.plan-question-text {
  font-size: 16px;
}
.plan-chat-progress .bubble {
  max-width: 100%;
  margin: 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 16px;
}
.plan-chat-progress .row > b {
  flex: 1;
  min-width: 0;
}
.plan-chat-progress p {
  margin: 12px 0;
}
.plan-progress-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 12px;
  font-size: 14px;
}
.plan-progress-steps {
  margin: 12px 0;
  padding-left: 22px;
}
.plan-progress-steps li {
  margin: 10px 0;
  overflow-wrap: anywhere;
}
.plan-progress-steps span {
  display: block;
  color: var(--muted);
  font-size: 14px;
}
.plan-chat-progress .muted {
  font-size: 14px;
}

.plan-chat-progress .bubble.user {
  border-left: 3px solid var(--green);
  background: color-mix(in srgb, var(--green) 7%, var(--bg));
}
.plan-chat-progress .bubble.assistant {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg);
}
.plan-progress-heading {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.plan-chat-progress .bubble.assistant p {
  margin: 0;
}
.plan-progress-evaluation {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.plan-chat-progress .byline {
  color: var(--green);
  font-weight: 600;
}
.plan-chat-progress :deep(.v-progress-linear) {
  flex: 0 0 auto;
  border-radius: 4px;
}
.plan-progress-steps li + li {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
@media (max-width: 600px) {
  .plan-chat-progress .bubble {
    padding: 14px;
  }
}
</style>
