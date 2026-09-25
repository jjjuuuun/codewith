<script setup>
import { t as __t } from "../i18n/index.js";

import { computed, onMounted, onBeforeUnmount, ref, useId } from "vue";
import { toolQuestions } from "../../shared/tool-input.mjs";
import { aiAPI } from "../services/api.js";
const props = defineProps({ request: { type: Object, required: true } });
const toolLabel = computed(
  () =>
    ({
      "item/commandExecution/requestApproval": __t("명령 실행"),
      "item/fileChange/requestApproval": __t("파일 변경"),
      "item/permissions/requestApproval": __t("추가 권한 요청"),
      Bash: __t("명령 실행"),
      Edit: __t("파일 수정"),
      Write: __t("파일 작성"),
    })[props.request.detail.tool] || props.request.detail.tool,
);
const questions = computed(() => toolQuestions(props.request.detail));
const questionIndex = ref(0);
const answers = ref({});
const currentQuestion = computed(() => questions.value[questionIndex.value]);
const dialog = ref();
const titleId = useId();
const busy = ref(false);
const error = ref("");
onMounted(() => dialog.value.showModal());
onBeforeUnmount(() => dialog.value?.close());
async function answer(allowed) {
  busy.value = true;
  error.value = "";
  try {
    await aiAPI("/tools/approval", {
      method: "POST",
      body: {
        id: props.request.id,
        jobId: props.request.jobId,
        allowed,
        answers: answers.value,
      },
    });
  } catch (e) {
    error.value = e.message;
    busy.value = false;
  }
}
</script>
<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="tool-approval-dialog"
      :aria-labelledby="titleId"
      @cancel.prevent="answer(false)"
      @keydown.esc.prevent.stop="answer(false)"
    >
      <header class="modal-head">
        <h2 :id="titleId">
          {{ questions.length ? __t("AI 확인 질문") : __t("작업 실행 승인") }}
        </h2>
      </header>
      <div class="modal-body">
        <template v-if="currentQuestion">
          <p>{{ questionIndex + 1 }} / {{ questions.length }}</p>
          <label :for="titleId + '-answer'">{{
            currentQuestion.question
          }}</label>
          <div class="row">
            <CwButton
              v-for="option in currentQuestion.options || []"
              :key="option.label"
              :title="option.description"
              :disabled="busy"
              @click="
                answers[currentQuestion.key] =
                  currentQuestion.multiSelect && answers[currentQuestion.key]
                    ? answers[currentQuestion.key] + ', ' + option.label
                    : option.label
              "
              >{{ option.label }}</CwButton
            >
          </div>
          <textarea
            :id="titleId + '-answer'"
            v-model="answers[currentQuestion.key]"
            :disabled="busy"
            rows="4"
            maxlength="5000"
          />
        </template>
        <template v-else>
          <p>{{ toolLabel }}</p>
          <p v-if="request.detail.cwd">{{ request.detail.cwd }}</p>
          <pre>{{
            request.detail.command ||
            request.detail.input?.command ||
            JSON.stringify(
              request.detail.permissions ||
                request.detail.input ||
                request.detail.changes ||
                request.detail.reason ||
                request.detail.grantRoot ||
                {},
              null,
              2,
            )
          }}</pre>
        </template>
        <p
          v-if="error"
          role="alert"
        >
          {{ error }}
        </p>
      </div>
      <footer class="modal-foot row">
        <CwButton
          :disabled="busy"
          @click="
            aiAPI('/cancel', { method: 'POST' }).catch(
              (e) => (error = e.message),
            )
          "
          >{{ __t("응답 중지") }}</CwButton
        >
        <CwButton
          :disabled="busy"
          autofocus
          @click="answer(false)"
          >{{ __t("거절") }}</CwButton
        >
        <CwButton
          v-if="questionIndex > 0"
          :disabled="busy"
          @click="questionIndex--"
          >{{ __t("이전 질문") }}</CwButton
        >
        <CwButton
          v-if="currentQuestion && questionIndex < questions.length - 1"
          :disabled="busy || !answers[currentQuestion.key]?.trim()"
          @click="questionIndex++"
          >{{ __t("다음 질문") }}</CwButton
        >
        <CwButton
          v-else
          :disabled="
            busy || (currentQuestion && !answers[currentQuestion.key]?.trim())
          "
          @click="answer(true)"
          >{{
            currentQuestion ? __t("답변 보내기") : __t("이번 작업 승인")
          }}</CwButton
        >
      </footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.tool-approval-dialog {
  width: min(720px, calc(100vw - 24px));
  max-height: 85dvh;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 16px;
  color: var(--ink);
  background: var(--paper);
}
.tool-approval-dialog::backdrop {
  background: #0008;
}
.modal-body {
  max-height: 60dvh;
  overflow: auto;
  padding: 16px;
}
textarea {
  width: 100%;
  margin-top: 12px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
footer {
  justify-content: flex-end;
  padding: 16px;
}
</style>
