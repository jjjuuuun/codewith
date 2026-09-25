<script setup>
import { t as __t } from "../i18n/index.js";

import { computed, ref, watch, onBeforeUnmount } from "vue";
import ThemeControl from "./ThemeControl.vue";
import PlanFeedbackReview from "./PlanFeedbackReview.vue";
import {
  readPlanNotes,
  appendPlanNote,
} from "../services/plan-review-notes.js";
import PlanProgress from "./PlanProgress.vue";
import { useTheme } from "vuetify";
import { useWorkspace } from "../composables/useWorkspace.js";
import { api } from "../services/api.js";
import { field } from "../services/form-fields.js";
import { securePlanHTML, priorPlanEvaluation } from "../../shared/plans.mjs";
import { themedPlanPreview } from "../../shared/plan-preview.mjs";
import { planEvaluationSummary } from "../../shared/plan-workflow.mjs";
import {
  attachPlanEditor,
  planTabLabel,
  updatePlanApprovals,
} from "../services/plan-editor.js";
const menuMedia = window.matchMedia("(min-width: 900px)");
const menuOpen = ref(menuMedia.matches);
const syncMenu = () => {
  menuOpen.value = menuMedia.matches;
};
menuMedia.addEventListener("change", syncMenu);
onBeforeUnmount(() => menuMedia.removeEventListener("change", syncMenu));
const dismissMenu = (event) => {
  if (
    event.key === "Escape" &&
    menuOpen.value &&
    !document.querySelector("dialog[open]")
  ) {
    menuOpen.value = false;
    document.querySelector(".review-menu-toggle")?.focus();
  }
};
window.addEventListener("keydown", dismissMenu);
onBeforeUnmount(() => window.removeEventListener("keydown", dismissMenu));
const props = defineProps({ versionId: { type: String, required: true } });
const {
  S,
  currentSpec: spec,
  plans,
  canEdit,
  openDialog,
  toast,
} = useWorkspace();
const theme = useTheme();
const syncTheme = () => theme.change(window.CodeWithTheme.resolved);
syncTheme();
document.addEventListener("codewith:controls-sync", syncTheme);
onBeforeUnmount(() =>
  document.removeEventListener("codewith:controls-sync", syncTheme),
);
const task = computed(() =>
  plans.execution.value?.workspaceId === S.w?.id &&
  plans.execution.value?.specId === spec.value?.id
    ? plans.execution.value
    : null,
);
const answer = computed({
  get: () =>
    task.value?.answers[
      task.value.currentQuestion ? 0 : task.value.questionIndex
    ] || "",
  set: (value) => {
    if (task.value)
      task.value.answers[
        task.value.currentQuestion ? 0 : task.value.questionIndex
      ] = value;
  },
});
const workspaceId = S.w.id,
  specId = spec.value.id,
  userId = S.user.id;
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
});
function acceptWorkspace(workspace) {
  if (disposed || S.w?.id !== workspaceId || S.specId !== specId) return false;
  S.w = workspace;
  return true;
}
const selectedId = ref(props.versionId);
const version = computed(() =>
  spec.value?.plans.versions.find(
    (item) => item.id === selectedId.value && !item.deletedAt,
  ),
);
const html = ref("");
const title = ref("");
const showFeedback = ref(false);
const showProgress = ref(false);
watch(
  () => task.value?.active || task.value?.phase === "questions",
  (value) => {
    if (value) showProgress.value = true;
  },
  { immediate: true },
);
const reviewNotes = computed(() => readPlanNotes(html.value));
async function saveReviewNote(note) {
  if (!enabled.value) throw Error(__t("현재 의견을 저장할 수 없습니다."));
  html.value = appendPlanNote(html.value, {
    ...note,
    author: S.user.name,
    at: new Date().toISOString(),
  });
  preview();
  await save();
  toast(__t("계획서와 검토 의견을 함께 저장했습니다."));
}
const source = ref("");
const base = ref(S.w.head);
const frame = ref();
const saving = ref(false);
const dirty = computed(
  () =>
    html.value !== version.value?.html || title.value !== version.value?.title,
);
const enabled = computed(() => canEdit.value && !S.busy && !saving.value);
const evaluation = computed(() => planEvaluationSummary(version.value));
const feedback = computed(() =>
  planEvaluationSummary({
    evaluation: priorPlanEvaluation(spec.value, version.value),
  }),
);
plans.setReviewContext(() => ({
  workspaceId,
  specId,
  versionId: selectedId.value,
  html: html.value,
  base: base.value,
}));
onBeforeUnmount(() => plans.setReviewContext(null));
const draftKey = () =>
  `codewith.plan-review:${userId}:${workspaceId}:${specId}:${selectedId.value}`;
function preview() {
  source.value = themedPlanPreview(
    securePlanHTML(html.value),
    theme.global.name.value,
  );
}
function load() {
  if (!version.value) return;
  html.value = version.value.html;
  title.value = version.value.title;
  base.value = S.w.head;
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey()) || "null");
    if (draft) {
      html.value = draft.html;
      title.value = draft.title;
      base.value = draft.base;
    }
  } catch {}
  preview();
}
watch(
  () => props.versionId,
  (id) => {
    selectedId.value = id;
    load();
  },
  { immediate: true },
);
watch([html, title], () => {
  if (!version.value) return;
  try {
    if (dirty.value)
      localStorage.setItem(
        draftKey(),
        JSON.stringify({
          html: html.value,
          title: title.value,
          base: base.value,
        }),
      );
    else localStorage.removeItem(draftKey());
  } catch {}
});
watch(() => theme.global.name.value, preview);
watch(dirty, (changed) =>
  updatePlanApprovals(
    frame.value?.contentDocument,
    changed ? {} : version.value?.stepApprovals,
  ),
);
watch(enabled, (value) => {
  const document = frame.value?.contentDocument;
  document?.querySelectorAll("[data-codewith-editable]").forEach((node) => {
    node.contentEditable = String(value);
  });
  document
    ?.querySelectorAll(
      '.cw-review-actions button, .plan-card input[type="checkbox"]',
    )
    .forEach((node) => {
      node.disabled = !value;
    });
});
const specTabs = ref([]);
const selectedTab = ref(0);
const frameHeight = ref(600);
const fontSizes = [12, 14, 16, 18, 20, 22, 24];
const fontKey = `codewith.plan-font:${userId}`;
const fontSize = ref(14);
try {
  const saved = Number(localStorage.getItem(fontKey));
  if (fontSizes.includes(saved)) fontSize.value = saved;
} catch {}
function applyFontSize() {
  const doc = frame.value?.contentDocument;
  if (!doc?.head) return;
  let style = doc.querySelector("[data-codewith-reader-font]");
  if (!style) {
    style = doc.createElement("style");
    style.dataset.codewithEditorUi = "";
    style.dataset.codewithReaderFont = "";
    doc.head.append(style);
  }
  style.textContent = `body{font-size:${fontSize.value}px!important}.plan-card table{font-size:inherit}.plan-card code{font-size:.9em}.plan-card h2{font-size:1.3em}.plan-card h3{font-size:1.1em}.plan-title h1{font-size:1.85em}.requirement-id{font-size:.85em}`;
  resizeDocument();
}
watch(fontSize, () => {
  try {
    localStorage.setItem(fontKey, String(fontSize.value));
  } catch {}
  applyFontSize();
});

let frameObserver;
let resizeFrameId;
let tabInputs = [];
function resizeDocument() {
  cancelAnimationFrame(resizeFrameId);
  resizeFrameId = requestAnimationFrame(() => {
    const document = frame.value?.contentDocument;
    if (!document?.body) return;
    const style = document.defaultView.getComputedStyle(document.body);
    frameHeight.value = Math.max(
      200,
      Math.ceil(
        document.body.getBoundingClientRect().height +
          parseFloat(style.marginTop || 0) +
          parseFloat(style.marginBottom || 0),
      ) + 2,
    );
  });
}
function selectSpec(index) {
  if (!tabInputs[index]) return;
  selectedTab.value = index;
  tabInputs[index].checked = true;
  tabInputs[index].dispatchEvent(
    new tabInputs[index].ownerDocument.defaultView.Event("change", {
      bubbles: true,
    }),
  );
  resizeDocument();
  window.scrollTo({ top: 0 });
  if (!menuMedia.matches) menuOpen.value = false;
}
onBeforeUnmount(() => {
  frameObserver?.disconnect();
  cancelAnimationFrame(resizeFrameId);
});
function loaded() {
  frameObserver?.disconnect();
  const document = frame.value?.contentDocument;
  if (!document) return;
  tabInputs = attachPlanEditor(document, {
    externalTabs: true,
    editable: enabled.value,
    approvals: dirty.value ? {} : version.value?.stepApprovals,
    onChange: (value) => {
      html.value = value;
    },
    onApprove: (step) => void approveStep(step).catch((e) => toast(e.message)),
    onRevise: (step, heading) => revise(step, heading),
  });
  specTabs.value = tabInputs.map((tab) => ({
    id: tab.id,
    title: planTabLabel(tab),
  }));
  if (tabInputs.length) {
    selectedTab.value = Math.min(selectedTab.value, tabInputs.length - 1);
    tabInputs[selectedTab.value].checked = true;
  }
  applyFontSize();
  frameObserver = new ResizeObserver(resizeDocument);
  frameObserver.observe(document.body);
  resizeDocument();
}
function useVersion(id) {
  selectedId.value = id;
  history.replaceState(history.state, "", location.pathname + "#review=" + id);
  load();
}
async function save() {
  if (disposed) return null;
  if (!enabled.value) throw Error(__t("현재 편집 내용을 저장할 수 없습니다."));
  if (!dirty.value) return version.value;
  saving.value = true;
  const oldKey = draftKey();
  try {
    const workspace = await api(`/workspaces/${workspaceId}/plans/${specId}`, {
      method: "POST",
      body: {
        base: base.value,
        parentVersionId: selectedId.value,
        title: title.value,
        html: html.value,
      },
    });
    if (!acceptWorkspace(workspace)) return null;
    localStorage.removeItem(oldKey);
    const saved = spec.value.plans.versions.at(-1);
    useVersion(saved.id);
    return saved;
  } finally {
    saving.value = false;
  }
}
async function approveStep(step) {
  if (!enabled.value) return;
  const saved = await save();
  if (!saved || disposed) return;
  const workspace = await api(
    `/workspaces/${workspaceId}/plans/${specId}/review`,
    {
      method: "POST",
      body: {
        base: base.value,
        versionId: saved.id,
        step,
        approved: !saved.stepApprovals?.[step],
      },
    },
  );
  if (!acceptWorkspace(workspace)) return;
  base.value = S.w.head;
  updatePlanApprovals(
    frame.value?.contentDocument,
    version.value.stepApprovals,
  );
  preview();
  toast(__t("단계 검토를 저장했습니다."));
}
async function reevaluate() {
  try {
    const saved = await save();
    if (!saved) return;
    const done = await plans.generate(spec.value, {
      parentVersionId: saved.id,
      evaluateOnly: true,
      message: __t("내용을 변경하지 않고 현재 계획을 독립 평가하세요."),
    });
    if (done && !disposed) useVersion(spec.value.plans.versions.at(-1).id);
  } catch (e) {
    toast(e.message);
  }
}
function approveAll() {
  if (
    !enabled.value ||
    dirty.value ||
    evaluation.value?.passed !== true ||
    !version.value.evaluation?.criteria?.length
  )
    return;
  openDialog(
    __t("전체 계획 승인"),
    [
      __t(
        "현재 편집한 내용을 포함한 전체 계획을 구현 기준으로 승인하고 검토 탭을 닫습니다.",
      ),
    ],
    async () => {
      const saved = await save();
      if (!saved || disposed) return;
      const workspace = await api(
        `/workspaces/${workspaceId}/plans/${specId}/final`,
        {
          method: "POST",
          body: { base: base.value, versionId: saved.id },
        },
      );
      if (!acceptWorkspace(workspace)) return;
      base.value = S.w.head;
      toast(__t("전체 계획을 승인했습니다."));
      window.close();
      // 직접 주소로 연 탭은 브라우저가 닫기를 제한할 수 있습니다.
      setTimeout(() => {
        if (!disposed) location.replace(location.pathname);
      }, 150);
    },
    { save: __t("승인하고 닫기") },
  );
}
function revise(step = "", heading = "", initialRequest = "") {
  if (!enabled.value) return;
  const snapshot = html.value,
    requestBase = base.value,
    parentVersionId = selectedId.value;
  openDialog(
    heading ? heading + __t(" · 수정 요청") : __t("계획 수정 요청"),
    [
      field(
        __t("AI에 요청할 내용"),
        "planRequest",
        initialRequest,
        "textarea",
        {
          required: true,
        },
      ),
    ],
    async (form) => {
      const request = String(form.get("planRequest"));
      void plans
        .generate(spec.value, {
          base: requestBase,
          parentVersionId,
          draftHtml: snapshot,
          message: `${step ? __t("수정 대상: {0} · {1}. 다른 단계는 유지하세요.\n", [step, heading]) : ""}${request}`,
        })
        .then((done) => {
          if (disposed) return;
          const next = spec.value.plans.versions.at(-1);
          if (done && next.id !== parentVersionId) {
            localStorage.removeItem(draftKey());
            useVersion(next.id);
          }
        })
        .catch((e) => toast(e.message));
    },
    { save: __t("현재 내용으로 AI 수정 요청") },
  );
}
const unload = (event) => {
  if (version.value && dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
};
window.addEventListener("beforeunload", unload);
onBeforeUnmount(() => window.removeEventListener("beforeunload", unload));
</script>
<template>
  <section
    v-if="version"
    class="plan-review-editor"
    :class="{ 'menu-open': menuOpen }"
  >
    <CwButton
      class="review-menu-toggle"
      :aria-label="menuOpen ? __t('계획 메뉴 닫기') : __t('계획 메뉴 열기')"
      :title="menuOpen ? __t('계획 메뉴 닫기') : __t('계획 메뉴 열기')"
      :aria-expanded="menuOpen"
      aria-controls="plan-review-menu"
      @click="menuOpen = !menuOpen"
      ><CwIcon :name="menuOpen ? 'chevronLeft' : 'chevronRight'"
    /></CwButton>
    <button
      v-if="menuOpen"
      class="review-menu-backdrop"
      :aria-label="__t('계획 메뉴 닫기')"
      @click="menuOpen = false"
    />
    <section
      class="review-center"
      :aria-label="__t('계획 검토 및 의견')"
    >
      <aside
        id="plan-review-menu"
        class="review-fixed"
        v-show="menuOpen"
        :aria-label="__t('계획서 메뉴')"
      >
        <h2 class="review-menu-heading">{{ __t("계획 검토") }}</h2>
        <header class="review-toolbar">
          <div class="review-heading">
            <div class="review-context">
              <span class="review-version"
                >v{{
                  spec.plans.versions.findIndex(
                    (item) => item.id === version.id,
                  ) + 1
                }}</span
              ><span>{{ spec.title }}</span>
            </div>
            <input
              v-model="title"
              :aria-label="__t('계획 제목')"
              :disabled="!enabled"
              maxlength="160"
            />
          </div>
          <div
            class="review-display-controls"
            role="group"
            :aria-label="__t('화면 설정')"
          >
            <ThemeControl />
          </div>
          <div class="review-font-control">
            <label for="plan-font-size">{{ __t("본문 글자 크기") }}</label>
            <select
              id="plan-font-size"
              v-model.number="fontSize"
            >
              <option
                v-for="size in fontSizes"
                :key="size"
                :value="size"
              >
                {{ size }}px
              </option>
            </select>
          </div>
          <div class="review-actions">
            <CwButton
              :disabled="!enabled || !dirty"
              @click="save().catch((e) => toast(e.message))"
              >{{ __t("변경 저장") }}</CwButton
            >
            <CwButton
              :disabled="!enabled"
              @click="revise()"
              >{{ __t("AI 수정 요청") }}</CwButton
            >
            <CwButton
              :disabled="!enabled"
              @click="reevaluate"
              >{{ __t("수정본 평가하기") }}</CwButton
            >
            <CwButton
              class="primary"
              :disabled="
                !enabled ||
                dirty ||
                evaluation?.passed !== true ||
                !version.evaluation?.criteria?.length
              "
              @click="approveAll"
              >{{ __t("전체 승인") }}</CwButton
            >
          </div>
          <div
            class="review-status"
            role="status"
          >
            <span :class="{ 'is-dirty': dirty }">{{
              dirty ? __t("편집 중 · 미저장 변경 있음") : __t("저장된 버전")
            }}</span>
            <span
              >{{ dirty ? 0 : Object.keys(version.stepApprovals || {}).length
              }}{{ __t("개 단계 검토함") }}</span
            >
            <CwButton
              v-if="feedback?.blockingIssues.length"
              class="small review-feedback-toggle"
              :aria-expanded="showFeedback"
              aria-controls="review-feedback"
              @click="showFeedback = !showFeedback"
              >{{ __t("평가 지적") }} {{ feedback.blockingIssues.length
              }}{{ __t("건 · 의견") }} {{ reviewNotes.length }}</CwButton
            >
            <CwButton
              v-if="task"
              class="small"
              :aria-expanded="showProgress"
              aria-controls="review-progress"
              @click="showProgress = !showProgress"
              >{{ __t("AI 수정") }}
              {{
                task.active
                  ? __t("진행 중")
                  : task.phase === "questions"
                    ? __t("답변 필요")
                    : __t("결과")
              }}</CwButton
            >
            <span
              v-if="!dirty && spec.plans.finalVersionId === version.id"
              class="review-approved"
              >{{ __t("전체 승인됨") }}</span
            >
          </div>
        </header>
        <h3
          v-if="specTabs.length"
          class="review-nav-heading"
        >
          {{ __t("스펙") }}
        </h3>
        <nav
          v-if="specTabs.length"
          class="review-specs"
          :aria-label="__t('계획 요구사항 선택')"
        >
          <button
            v-for="(tab, index) in specTabs"
            :key="tab.id"
            type="button"
            :aria-pressed="selectedTab === index"
            @click="selectSpec(index)"
          >
            {{ tab.title }}
          </button>
        </nav>
      </aside>
      <section
        v-if="feedback?.blockingIssues.length"
        v-show="showFeedback"
        id="review-feedback"
        class="review-feedback"
        :aria-label="__t('평가 지적과 검토 의견')"
      >
        <PlanFeedbackReview
          :issues="feedback.blockingIssues"
          :notes="reviewNotes"
          :disabled="!enabled"
          :save-note="saveReviewNote"
          @revise="revise('', '', $event)"
        />
      </section>
      <section
        v-if="task"
        v-show="showProgress"
        id="review-progress"
        class="review-progress"
        :aria-label="__t('AI 수정 진행')"
      >
        <PlanProgress />
        <label
          v-if="plans.acceptingAnswer()"
          class="review-answer"
        >
          {{ __t("질문에 대한 답변") }}
          <textarea
            v-model="answer"
            rows="3"
            :disabled="task.answerSubmitting"
          />
        </label>
      </section>
    </section>
    <iframe
      ref="frame"
      class="review-document"
      :title="__t('계획서 직접 편집')"
      sandbox="allow-same-origin"
      referrerpolicy="no-referrer"
      :srcdoc="source"
      :style="{ height: frameHeight + 'px' }"
      @load="loaded"
    />
  </section>
  <p
    v-else
    role="alert"
  >
    {{ __t("이 계획 버전을 찾을 수 없습니다.") }}
  </p>
</template>
<style scoped>
.plan-review-editor {
  min-height: 100dvh;
  padding-left: 52px;
}
.plan-review-editor.menu-open {
  padding-left: 280px;
}
.review-center {
  display: contents;
}
.review-fixed {
  position: fixed;
  inset: 0 auto 0 0;
  width: 280px;
  z-index: 8;
  overflow-y: auto;
  padding-top: 60px;
  border-right: 1px solid var(--line);
  background: var(--paper);
}
.review-menu-toggle {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 10;
  background: var(--paper);
}
.review-menu-heading {
  margin: 0;
  padding: 0 20px 20px;
  font-size: 18px;
}
.review-menu-backdrop {
  display: none;
}
.review-toolbar {
  display: grid;
  gap: 18px;
  padding: 0 20px 20px;
  border-bottom: 1px solid var(--line);
}
.review-heading {
  min-width: 0;
}
.review-context {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 12px;
}
.review-context > span:last-child {
  overflow-wrap: anywhere;
}
.review-version {
  background: var(--soft);
  color: var(--green);
  border-radius: 6px;
  padding: 2px 8px;
  flex-shrink: 0;
  font-weight: 600;
}
.review-toolbar input {
  width: 100%;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  padding: 10px;
}
.review-display-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.review-display-controls :deep(.theme-control .v-input) {
  width: 120px;
}
.review-font-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.review-font-control select {
  width: 90px;
  padding: 8px;
}
.review-actions {
  display: grid;
  gap: 10px;
}
.review-actions > :last-child {
  margin-top: 4px;
}
.review-status {
  display: grid;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}
.review-status .is-dirty {
  color: var(--green);
  font-weight: 600;
}
.review-approved {
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}
.review-nav-heading {
  margin: 0;
  padding: 20px 20px 8px;
  font-size: 13px;
  color: var(--muted);
}
.review-specs {
  display: grid;
  gap: 8px;
  padding: 0 12px 20px;
}
.review-specs button {
  width: 100%;
  text-align: left;
  padding: 12px;
  line-height: 1.7;
  white-space: normal;
  overflow-wrap: anywhere;
}
.review-specs button[aria-pressed="true"] {
  background: var(--soft);
  border-color: var(--green);
  color: var(--ink);
}
.review-progress {
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
}
.review-feedback {
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}
.review-answer {
  display: grid;
  gap: 8px;
}
.review-document {
  width: 100%;
  display: block;
  border: 0;
  background: var(--paper);
}
@media (max-width: 899px) {
  .plan-review-editor,
  .plan-review-editor.menu-open {
    padding-left: 0;
    padding-top: 52px;
  }
  .review-fixed {
    width: min(320px, calc(100vw - 48px));
  }
  .review-menu-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 7;
    border: 0;
    border-radius: 0;
    background: #0006;
  }
}
</style>
