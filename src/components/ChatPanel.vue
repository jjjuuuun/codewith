<script setup>
import { t as __t } from "../i18n/index.js";

import { computed, ref, watch, nextTick } from "vue";
import { webSources } from "../../shared/web-research.mjs";
import { useWorkspace } from "../composables/useWorkspace.js";
import { date } from "../services/format.js";
import ToolApprovalDialog from "./ToolApprovalDialog.vue";
import AiResponseContent from "./AiResponseContent.vue";
import PlanProgress from "./PlanProgress.vue";
import RichTextInput from "./RichTextInput.vue";
import { useComposerResize } from "../composables/useComposerResize.js";
const chatPanel = ref();
const uploadInput = ref();
const resize = useComposerResize(chatPanel);
const {
  panel,
  attachmentUI,
  editMessage,
  continueAnswer,
  plans,
  S,
  currentSpec,
  canEdit,
  sendChat,
  cancelQueued,
  resumeQueue,
  setModel,
  setEffort,
} = useWorkspace();
const spec = computed(() => (S.view === "spec" ? currentSpec.value : null));
const planMode = computed(() => S.chatMode === "plan");
const planTask = computed(() =>
  plans.execution.value?.workspaceId === S.w?.id &&
  plans.execution.value?.specId === spec.value?.id
    ? plans.execution.value
    : null,
);
const answering = computed(() => plans.acceptingAnswer());
const draft = computed({
  get: () =>
    answering.value
      ? planTask.value.answers[planTask.value.questionIndex]
      : planMode.value
        ? S.planDraft
        : S.draft,
  set: (value) => {
    if (answering.value)
      planTask.value.answers[planTask.value.questionIndex] = value;
    else if (planMode.value) S.planDraft = value;
    else S.draft = value;
  },
});
const sendLabel = computed(() =>
  answering.value
    ? planTask.value.currentQuestion
      ? __t("답변 보내기")
      : planTask.value.questionIndex < planTask.value.questions.length - 1
        ? __t("답변하고 다음 질문")
        : __t("답변하고 계획 생성")
    : planMode.value
      ? S.busy
        ? __t("다음 메시지 예약 전송")
        : __t("계획 질문·변경 요청")
      : S.busy
        ? __t("다음 메시지 예약 전송")
        : __t("메시지 보내기"),
);
const queued = computed(() =>
  S.chatQueue.filter(
    (item) =>
      item.userId === S.user?.id &&
      item.workspaceId === S.w?.id &&
      item.specId === (spec.value?.id || null) &&
      item.threadId === (S.chatThread?.id || null),
  ),
);
const modelItems = computed(() => [
  { title: __t("모델 선택"), value: "" },
  ...S.models.map((m) => ({
    title: m.displayName || m.model || m.id,
    value: m.model || m.id,
  })),
]);
const effortItems = computed(() => [
  { title: __t("기본 강도"), value: "auto" },
  ...(
    S.models.find((m) => (m.model || m.id) === S.settings.model)
      ?.supportedReasoningEfforts || []
  ).map((e) => ({ title: e.reasoningEffort, value: e.reasoningEffort })),
]);
const list = ref();
const composer = ref();
const following = ref(true);
const unread = ref(false);
function trackScroll() {
  const element = list.value;
  if (!element) return;
  following.value =
    element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  if (following.value) unread.value = false;
}
function jumpBottom() {
  following.value = true;
  unread.value = false;
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
}
watch(
  () => S.chatSendVersion,
  async () => {
    following.value = true;
    await nextTick();
    jumpBottom();
  },
);
watch(
  () => S.chatThread?.id,
  async () => {
    await nextTick();
    jumpBottom();
  },
);
watch(
  () => [
    S.chatMode,
    S.messages.length,
    S.chatProgress,
    S.chatPreview,
    S.chatLoading,
    queued.value.length,
    planTask.value?.message,
    planTask.value?.questionIndex,
    planTask.value?.phase,
  ],
  async () => {
    await nextTick();
    if (following.value) jumpBottom();
    else unread.value = true;
  },
  { flush: "post" },
);
</script>
<template>
  <ToolApprovalDialog
    v-if="S.toolApprovals?.length"
    :key="S.toolApprovals[0].id"
    :request="S.toolApprovals[0]"
  />
  <aside
    ref="chatPanel"
    @paste.capture="attachmentUI.fromEvent"
    @drop.capture="attachmentUI.fromEvent"
    @dragover.prevent
    class="assistant"
    id="assistant"
  >
    <div
      id="chat-resizer"
      @pointerdown="panel.start"
      @pointermove="panel.move"
      @pointerup="panel.end"
      @pointercancel="panel.end"
      @lostpointercapture="panel.end"
      @keydown="panel.key"
      :aria-valuemax="panel.max.value"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="__t('대화창 너비 조절')"
      :aria-valuemin="panel.min.value"
      :aria-valuenow="panel.width.value"
    />
    <div class="assistant-head">
      <div class="row between">
        <h2><CwIcon name="chat" /> {{ __t("AI 대화") }}</h2>
        <CwButton
          v-if="!planMode"
          action="new-chat"
          class="small ghost"
          :aria-label="__t('새 대화')"
          :title="__t('새 대화')"
          :disabled="S.busy || S.chatLoading"
        >
          <CwIcon name="plus" />
        </CwButton>
        <CwButton
          v-if="!planMode"
          action="chat-history"
          class="small ghost"
          :aria-label="__t('이전 대화')"
          :title="__t('이전 대화')"
        >
          <CwIcon name="history" />
        </CwButton>
        <CwButton
          action="ai-settings"
          class="small ghost connection-status"
          :title="
            S.connected
              ? S.settings.provider + __t(' · 연결 관리')
              : __t('개인 AI 연결')
          "
          ><span
            v-if="S.connected"
            class="connection-light"
            aria-hidden="true"
          />{{ S.connected ? __t("연결됨") : __t("연결 설정") }}</CwButton
        >
      </div>
      <p class="chat-context">
        <span>{{
          planMode
            ? __t("계획 대화")
            : spec
              ? __t("명세 대화")
              : __t("워크스페이스 전체")
        }}</span
        ><b>{{
          spec ? spec.id + " · " + spec.title : S.w?.document.project || ""
        }}</b>
      </p>
      <div
        v-if="S.chatThread && !planMode"
        class="chat-thread-title"
        :title="S.chatThread.title"
      >
        {{ S.chatThread.title }}
      </div>
    </div>
    <div
      class="chat-list"
      id="chat-list"
      ref="list"
      @scroll="trackScroll"
    >
      <div
        v-if="!S.messages.length && !planMode"
        class="chat-empty"
      >
        <img
          src="/logo.svg"
          alt=""
        />
        <h3>{{ __t("생각을 한 단계 더 구체적으로.") }}</h3>
        <p v-if="spec">
          {{ __t("선택한 명세와 공통 설정을 바탕으로") }}<br />{{
            __t("요구사항과 계획을 구체화하세요.")
          }}
        </p>
        <p v-else>
          {{ __t("명세가 없어도 대화를 시작할 수 있어요.") }}<br />{{
            __t("프로젝트 방향, 공통 기준, 개발 단위를 함께 정해 보세요.")
          }}
        </p>
        <p>
          {{ __t("AI가 변경을 제안하면 내용을 확인한 후") }}<br />{{
            __t("프로젝트에 반영할 수 있습니다.")
          }}
        </p>
      </div>
      <div
        v-for="(message, index) in S.messages"
        :key="message.id || index"
        class="bubble"
        :class="message.role"
      >
        <div class="byline">
          {{
            message.role === "user"
              ? __t("나")
              : __t("명세 AI · ") + (message.model || "AI")
          }}
          · {{ date(message.at) }}
          {{ message.regeneratedFrom ? __t(" · 다시 생성") : "" }}
        </div>
        <div
          v-if="message.attachments?.length"
          class="chat-attachments"
        >
          <a
            v-for="attachment in message.attachments"
            :key="attachment.id"
            :href="
              '/api/ai/attachments/' + attachment.id + '?workspace=' + S.w.id
            "
            target="_blank"
            rel="noopener noreferrer"
            >{{ attachment.name }}</a
          >
        </div>
        <p
          v-if="message.partial"
          class="muted"
          role="status"
        >
          {{ message.error || __t("중단된 부분 응답") }}
        </p>
        <AiResponseContent
          v-if="
            !message.specProposal &&
            !(message.proposal && message.specId === spec?.id)
          "
          :response="{ message: message.text, files: [] }"
        />
        <section
          v-if="message.specProposal"
          class="proposal spec-proposal"
        >
          <div class="row between">
            <b>{{ __t("명세 제안 ·") }} {{ message.specProposal.title }}</b>
            <CwButton
              action="add-spec-proposal"
              class="small"
              :data-id="message.id"
              :disabled="!canEdit || S.busy || !!message.addedSpecId"
              >{{
                message.addedSpecId ? __t("추가됨") : __t("명세로 추가")
              }}</CwButton
            >
          </div>
          <section
            v-for="(requirement, i) in message.specProposal.requirements"
            :key="i"
          >
            <h4>{{ i + 1 }}. {{ requirement.title }}</h4>
            <MarkdownContent :text="requirement.body" />
            <b>{{ __t("완료 기준") }}</b>
            <ul>
              <li
                v-for="(criterion, j) in requirement.criteria"
                :key="j"
              >
                {{ criterion }}
              </li>
            </ul>
          </section>
        </section>
        <div
          v-if="webSources(message.sources).length"
          class="chat-sources"
        >
          <b>{{ __t("참고 출처") }}</b>
          <ul>
            <li
              v-for="source in webSources(message.sources)"
              :key="source.url"
            >
              <a
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ source.title }}</a
              >
            </li>
          </ul>
        </div>
        <details
          v-if="message.appliedInstructions?.length"
          class="applied-instructions"
        >
          <summary>
            {{ __t("적용된 스킬") }} {{ message.appliedInstructions.length
            }}{{ __t("개") }}
          </summary>
          <p
            v-for="skill in message.appliedInstructions"
            :key="skill.id"
          >
            <code>${{ skill.id }}</code> · {{ skill.reason }}
          </p>
        </details>
        <div
          v-if="message.proposal && message.specId === spec?.id"
          class="proposal"
        >
          <b>{{ __t("요구사항 제안 ·") }} {{ message.proposal.title }}</b>
          <MarkdownContent :text="message.proposal.body" />
          <b>{{ __t("완료 기준") }}</b>
          <ul>
            <li
              v-for="(criterion, i) in message.proposal.criteria"
              :key="i"
            >
              {{ criterion }}
            </li>
          </ul>
          <small v-if="message.applied">{{ __t("프로젝트에 반영됨") }}</small
          ><CwButton
            v-else
            action="review-proposal"
            class="small"
            :data-id="message.id"
            :disabled="!canEdit"
            >{{ __t("편집 후 반영") }}</CwButton
          >
        </div>
        <div
          v-if="message.files?.length"
          class="proposal"
        >
          <b
            >{{ __t("코드 파일") }} {{ message.files.length }}{{ __t("개") }}</b
          >
          <details
            v-for="file in message.files"
            :key="file.path"
          >
            <summary class="file-path">{{ file.path }}</summary>
            <pre>{{ file.content }}</pre>
          </details>
          <small v-if="message.applied">{{ __t("프로젝트에 반영됨") }}</small
          ><CwButton
            v-else
            action="apply-answer"
            class="small"
            :data-id="message.id"
            :disabled="!canEdit"
            >{{ __t("변경 검토 · 반영") }}</CwButton
          >
        </div>
        <div
          v-if="message.id"
          class="chat-message-actions"
        >
          <CwButton
            action="copy-chat"
            class="small ghost"
            :data-id="message.id"
            :aria-label="__t('메시지 복사')"
            :title="__t('메시지 복사')"
            ><CwIcon name="copy"
          /></CwButton>
          <CwButton
            v-if="message.role === 'user'"
            class="small ghost"
            :aria-label="__t('메시지 수정')"
            :title="__t('메시지 수정 · 새 대화로 이어가기')"
            :disabled="S.busy"
            @click="editMessage(message)"
            ><CwIcon name="edit"
          /></CwButton>
          <CwButton
            v-if="message.partial && index === S.messages.length - 1"
            class="small"
            :disabled="S.busy"
            @click="continueAnswer"
            >{{ __t("이어서 작성") }}</CwButton
          >
          <CwButton
            v-if="index === S.messages.length - 1"
            action="regenerate-chat"
            class="small ghost"
            :disabled="S.busy || S.chatLoading || !!queued.length"
            :aria-label="
              message.role === 'assistant'
                ? __t('답변 다시 생성')
                : __t('다시 요청')
            "
            :title="
              message.role === 'assistant'
                ? __t('답변 다시 생성')
                : __t('다시 요청')
            "
            ><CwIcon name="refresh"
          /></CwButton>
        </div>
      </div>
      <PlanProgress v-if="planMode && planTask" />
      <div
        v-if="S.chatPreview"
        class="bubble assistant chat-preview"
        :aria-label="__t('작성 중인 응답')"
      >
        <AiResponseContent :response="{ message: S.chatPreview, files: [] }" />
      </div>
      <div
        v-if="S.chatProgress"
        class="note"
        role="status"
      >
        {{ S.chatProgress }}
      </div>
      <section
        v-if="queued.length"
        class="chat-queue"
        :aria-label="__t('전송 대기 메시지')"
      >
        <div class="row between">
          <small
            >{{
              S.chatQueuePaused ? __t("전송 보류") : __t("응답 완료 후 전송")
            }}
            · {{ queued.length }}{{ __t("개") }}</small
          >
          <CwButton
            v-if="S.chatQueuePaused && !S.busy"
            class="small"
            @click="resumeQueue"
            >{{ __t("전송 재개") }}</CwButton
          >
        </div>
        <div
          v-for="item in queued"
          :key="item.id"
          class="row between queued-message"
        >
          <span>{{ item.text }}</span>
          <CwButton
            class="ghost small"
            :aria-label="__t('예약 전송 취소')"
            :title="__t('예약 전송 취소')"
            @click="cancelQueued(item.id)"
            >×</CwButton
          >
        </div>
      </section>
    </div>
    <CwButton
      v-if="!following || unread"
      class="chat-jump small"
      :style="{ bottom: resize.height.value + 12 + 'px' }"
      :aria-label="__t('최신 메시지로 이동')"
      :title="__t('최신 메시지로 이동')"
      @click="jumpBottom"
      ><CwIcon name="arrowDown"
    /></CwButton>
    <div
      class="composer"
      :style="{ height: resize.height.value + 'px' }"
    >
      <div
        id="composer-resizer"
        role="separator"
        tabindex="0"
        :aria-label="__t('메시지 입력창 높이 조절')"
        aria-orientation="horizontal"
        aria-controls="chat-input"
        :aria-valuemin="resize.minimum.value"
        :aria-valuemax="resize.maximum.value"
        :aria-valuenow="resize.height.value"
        :title="__t('드래그하거나 위·아래 방향키로 입력창 높이 조절')"
        @pointerdown="resize.start"
        @pointermove="resize.move"
        @pointerup="resize.end"
        @pointercancel="resize.end"
        @lostpointercapture="resize.end"
        @keydown="resize.key"
      />
      <div
        class="compose-box"
        :class="{ 'plan-compose': planMode }"
      >
        <input
          ref="uploadInput"
          type="file"
          hidden
          multiple
          accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.vue,.java,.py,.sql,.yaml,.yml,.log"
          @change="
            attachmentUI.add([...$event.target.files]);
            $event.target.value = '';
          "
        />
        <div
          v-if="S.chatAttachments?.length || S.chatUploading"
          class="chat-attachments"
        >
          <span
            v-for="file in S.chatAttachments"
            :key="file.id"
            >{{ file.name
            }}<CwButton
              class="small ghost"
              :aria-label="file.name + __t(' 첨부 취소')"
              @click="attachmentUI.remove(file.id)"
              ><CwIcon name="close" /></CwButton
          ></span>
          <span
            v-if="S.chatUploading"
            role="status"
            >{{ __t("파일을 읽고 있습니다…") }}</span
          >
        </div>
        <RichTextInput
          ref="composer"
          v-model="draft"
          id="chat-input"
          maxlength="16000"
          :placeholder="
            answering
              ? __t('이 질문의 답변을 입력하세요…')
              : planMode
                ? __t('계획에 관해 질문하거나 변경을 요청하세요…')
                : spec
                  ? __t('이 명세의 요구사항과 계획을 이야기해 보세요…')
                  : __t('프로젝트 방향이나 궁금한 점을 이야기해 보세요…')
          "
          :aria-label="__t('AI에게 보낼 메시지')"
          :disabled="!S.w || S.chatLoading"
          :skills="S.w?.document.projectSpec.skills"
          @send="sendChat"
        />
        <div class="compose-foot">
          <div class="rich-chat-actions">
            <CwButton
              class="small ghost"
              :aria-label="__t('파일 첨부')"
              :title="__t('이미지·PDF·문서 첨부')"
              :disabled="!S.w || S.chatUploading || answering"
              @click="uploadInput.click()"
              ><CwIcon name="attachment"
            /></CwButton>
            <CwButton
              data-action="command-menu"
              @click="composer?.command('skills')"
              class="ghost small"
              :disabled="!S.w"
              >{{ __t("$ 스킬") }}</CwButton
            >
          </div>
          <div class="model-controls composer-models">
            <v-select
              id="model-select"
              :data-value="S.settings.model"
              :aria-label="__t('모델')"
              :items="modelItems"
              :model-value="S.settings.model"
              @update:model-value="setModel"
              :disabled="S.busy"
            /><v-select
              id="effort-select"
              :data-value="S.settings.effort"
              :aria-label="__t('추론 강도')"
              :items="effortItems"
              :model-value="S.settings.effort"
              @update:model-value="setEffort"
              :disabled="S.busy"
            /><CwButton
              action="ai-options"
              class="ghost"
              :aria-label="__t('AI 세부 설정')"
              ><CwIcon name="settings"
            /></CwButton>
          </div>
          <CwButton
            v-if="S.busy && !plans.execution.value?.active"
            action="cancel-chat"
            class="small"
            >{{ __t("중지") }}</CwButton
          ><CwButton
            action="send-chat"
            class="primary send-button"
            :aria-label="sendLabel"
            :title="sendLabel"
            :disabled="!S.w || S.chatLoading"
            ><CwIcon name="arrowUp"
          /></CwButton>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.chat-attachments {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.chat-attachments > span {
  display: flex;
  align-items: center;
  min-width: 0;
}

.chat-sources {
  margin-top: 12px;
  overflow-wrap: anywhere;
}

.plan-compose :deep(.ProseMirror) {
  font-size: 16px;
  line-height: 1.65;
}
</style>
