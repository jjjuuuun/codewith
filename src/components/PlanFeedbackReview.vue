<script setup>
import { t as __t } from "../i18n/index.js";

import { reactive, ref } from "vue";
const props = defineProps({
  issues: { type: Array, required: true },
  notes: { type: Array, default: () => [] },
  disabled: Boolean,
  saveNote: { type: Function, required: true },
});
const emit = defineEmits(["revise"]);
const drafts = reactive({});
const pending = ref("");
const error = ref("");
function draft(issue) {
  return (drafts[issue] ||= { stance: __t("의견"), text: "" });
}
async function submit(issue, revise = false) {
  const value = draft(issue);
  if (!value.text.trim() || pending.value) return;
  pending.value = issue;
  error.value = "";
  try {
    await props.saveNote({
      issue,
      stance: value.stance,
      text: value.text.trim(),
    });
    const request = __t(
      "평가 지적: {0}\n사용자 {1}: {2}\n이 의견과 현재 계획 내용을 함께 검토해 필요한 부분을 수정하세요. 지적을 무조건 수용하거나 삭제하지 말고 판단 근거를 설명하세요.",
      [issue, value.stance, value.text.trim()],
    );
    value.text = "";
    if (revise) emit("revise", request);
  } catch (e) {
    error.value = e.message;
  } finally {
    pending.value = "";
  }
}
</script>
<template>
  <div class="feedback-body">
    <p class="muted">
      {{
        __t(
          "평가 지적에 동의하거나 이견을 남기세요. 의견 저장은 현재 편집 내용도 함께 저장하며, 승인이나 문제 해결을 의미하지 않습니다.",
        )
      }}
    </p>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <ol class="feedback-issues">
      <li
        v-for="(issue, index) in issues"
        :key="issue"
      >
        <p class="feedback-issue">{{ issue.replace(/^\[차단\]\s*/, "") }}</p>
        <div
          v-for="(note, noteIndex) in notes.filter(
            (note) => note.issue === issue,
          )"
          :key="noteIndex"
          class="feedback-note"
        >
          <strong>{{ note.stance }} · {{ note.author }}</strong>
          <p>{{ note.text }}</p>
        </div>
        <div class="feedback-form">
          <label :for="'review-stance-' + index">{{ __t("검토 의견") }}</label>
          <select
            :id="'review-stance-' + index"
            v-model="draft(issue).stance"
            :disabled="disabled || !!pending"
          >
            <option>{{ __t("의견") }}</option>
            <option>{{ __t("동의") }}</option>
            <option>{{ __t("이견") }}</option>
            <option>{{ __t("수정 내용 설명") }}</option>
          </select>
          <textarea
            v-model="draft(issue).text"
            :aria-label="__t('평가 지적 ') + (index + 1) + __t('에 대한 의견')"
            :placeholder="__t('동의·이견의 이유나 수정 방향을 적어 주세요.')"
            rows="3"
            maxlength="5000"
            :disabled="disabled || !!pending"
          />
          <div class="feedback-actions">
            <CwButton
              :disabled="disabled || !!pending || !draft(issue).text.trim()"
              @click="submit(issue)"
              >{{ __t("의견 저장") }}</CwButton
            >
            <CwButton
              :disabled="disabled || !!pending || !draft(issue).text.trim()"
              @click="submit(issue, true)"
              >{{ __t("의견 반영해 AI 수정") }}</CwButton
            >
          </div>
        </div>
      </li>
    </ol>
  </div>
</template>
<style scoped>
.feedback-body {
  padding: 20px 24px;
  background: var(--bg);
}
.feedback-body > p {
  margin: 0 0 20px;
  line-height: 1.8;
}
.feedback-issues {
  margin: 0;
  padding-left: 26px;
}
.feedback-issues > li {
  padding: 20px 12px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.feedback-issues > li + li {
  border-top: 1px solid var(--line);
}
.feedback-issues > li::marker {
  color: rgb(var(--v-theme-error));
  font-weight: 700;
}
.feedback-issue {
  margin: 0 0 20px;
  white-space: pre-wrap;
}
.feedback-note {
  padding: 16px;
  background: var(--paper);
  border-left: 3px solid var(--green);
  margin: 12px 0;
}
.feedback-note p {
  margin: 8px 0 0;
  white-space: pre-wrap;
}
.feedback-form {
  display: grid;
  grid-template-columns: auto minmax(100px, 180px);
  gap: 10px;
  align-items: center;
}
.feedback-form textarea,
.feedback-actions {
  grid-column: 1 / -1;
}
.feedback-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}
@media (max-width: 600px) {
  .feedback-body {
    padding: 12px;
  }
  .feedback-issues > li {
    padding: 16px 4px;
  }
}
</style>
