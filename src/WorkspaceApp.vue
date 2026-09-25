<script setup>
import { t as __t } from "./i18n/index.js";

import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { provideWorkspace } from "./composables/useWorkspace.js";
import { short } from "./services/format.js";
import ThemeControl from "./components/ThemeControl.vue";
import ToastNotification from "./components/ToastNotification.vue";
import WorkspaceSidebar from "./components/WorkspaceSidebar.vue";
import DialogHost from "./components/forms/DialogHost.vue";
import InlineEditor from "./components/forms/InlineEditor.vue";
import ChatPanel from "./components/ChatPanel.vue";
import AuthView from "./views/AuthView.vue";
import HomeView from "./views/HomeView.vue";
import WorkspaceView from "./views/WorkspaceView.vue";
import ProjectConnectionView from "./views/ProjectConnectionView.vue";
import ProjectView from "./views/ProjectView.vue";
import RequirementsView from "./views/RequirementsView.vue";
import PlanReviewEditor from "./components/PlanReviewEditor.vue";
import SpecView from "./views/SpecView.vue";
import HistoryView from "./views/HistoryView.vue";
import MembersView from "./views/MembersView.vue";
import FilesView from "./views/FilesView.vue";
const {
  currentSpec,
  S,
  ready,
  mode,
  runAction,
  homeClick,
  notification,
  panel,
  editors,
} = provideWorkspace();
const reviewId = ref(new URLSearchParams(location.hash.slice(1)).get("review"));
const readReview = () => {
  reviewId.value = new URLSearchParams(location.hash.slice(1)).get("review");
};
onMounted(() => window.addEventListener("hashchange", readReview));
onBeforeUnmount(() => window.removeEventListener("hashchange", readReview));
const standaloneReview = computed(
  () =>
    S.w &&
    S.view === "spec" &&
    S.tab === "design" &&
    currentSpec.value &&
    reviewId.value,
);
const home = computed(() => !S.w || S.view === "home");
const views = {
  workspace: WorkspaceView,
  project: ProjectView,
  connection: ProjectConnectionView,
  requirements: RequirementsView,
  spec: SpecView,
  history: HistoryView,
  members: MembersView,
  files: FilesView,
};
const topbar = ref(null);
const headerHeight = ref(65);
// Wrapped language/theme controls define the space above mobile overlay panels.
watch(
  topbar,
  (element, _previous, cleanup) => {
    if (!element) return;
    const measure = () => {
      headerHeight.value = Math.ceil(element.getBoundingClientRect().height);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    cleanup(() => observer.disconnect());
  },
  { flush: "post" },
);
const narrow = ref(innerWidth <= 600);
const resize = () => (narrow.value = innerWidth <= 600);
onMounted(() => window.addEventListener("resize", resize));
onBeforeUnmount(() => window.removeEventListener("resize", resize));
</script>
<template>
  <v-app>
    <div
      v-if="!ready"
      class="loading"
    >
      {{ __t("CodeWith를 불러오고 있습니다…")
      }}<v-progress-linear
        indeterminate
        color="primary"
      />
    </div>
    <AuthView v-else-if="!S.user" />
    <main
      v-else-if="standaloneReview"
      class="standalone-plan"
    >
      <PlanReviewEditor
        :key="`${S.w.id}:${S.specId}`"
        :version-id="reviewId"
      />
    </main>
    <div
      v-else
      class="shell"
      :style="{
        '--chat-width': panel.width.value + 'px',
        '--header-height': headerHeight + 'px',
      }"
      :class="{
        'home-layout': home,
        'resizing-chat': panel.resizing.value,
        'nav-hidden': !home && S.navHidden,
        'chat-hidden': !home && !panel.chatVisible.value,
        'workspace-layout': !home && S.view !== 'spec',
        'show-nav': S.showNav,
        'show-ai': S.showAI,
      }"
    >
      <template v-if="!home"
        ><a
          class="brand workspace-brand"
          href="/"
          @click="homeClick"
          ><img
            src="/logo.svg"
            alt=""
          />codewith</a
        ><button
          type="button"
          data-action="toggle-nav"
          @click="runAction('toggle-nav', $event.currentTarget)"
          class="nav-handle"
          :aria-label="__t('좌측 메뉴 열기·닫기')"
          :aria-expanded="narrow ? S.showNav : !S.navHidden"
        >
          <CwIcon
            :name="
              (narrow ? !S.showNav : S.navHidden)
                ? 'chevronRight'
                : 'chevronLeft'
            "
          /></button
        ><WorkspaceSidebar
      /></template>
      <main class="center">
        <header
          ref="topbar"
          class="topbar"
        >
          <a
            v-if="home"
            class="brand"
            href="/"
            @click="homeClick"
            ><img
              src="/logo.svg"
              alt=""
            />codewith</a
          >
          <div
            v-else
            class="row"
          >
            <span class="crumb">{{ S.w.document.project }}</span
            ><span
              class="pill"
              :title="__t('현재 프로젝트 커밋')"
              >{{ short(S.w.head) }}</span
            >
          </div>
          <div class="row">
            <CwButton
              v-if="home"
              action="personal-settings"
              class="ghost profile-name"
              :title="__t('개인 설정')"
              :aria-label="__t('개인 설정 열기')"
              >{{ S.user.name }}</CwButton
            ><template v-else
              ><CwButton
                action="exchange"
                class="small"
                :aria-label="__t('공유 파일')"
                :title="__t('공유 파일')"
                ><CwIcon name="share" /></CwButton
              ><CwButton
                action="toggle-ai"
                class="panel-toggle small"
                :aria-label="__t('AI 대화 열기·닫기')"
                :aria-expanded="panel.chatVisible.value"
                ><CwIcon name="chat" /></CwButton></template
            ><ThemeControl /><a
              class="help-link"
              href="/guide"
              target="_blank"
              rel="noopener"
              :aria-label="__t('사용 안내')"
              ><CwIcon name="help" /></a
            ><template v-if="home && mode !== 'personal'"
              ><CwButton
                action="access-account"
                class="small"
                >{{ __t("계정") }}</CwButton
              ><CwButton
                action="logout"
                class="ghost small"
                :title="__t('로그아웃')"
                >{{ __t("로그아웃") }}</CwButton
              ></template
            >
          </div>
        </header>
        <div
          class="content"
          id="main-content"
        >
          <InlineEditor v-if="!home && S.view !== 'spec'" /><HomeView
            v-if="home"
          /><component
            v-else
            :is="views[S.view] || WorkspaceView"
            :key="`${S.w.id}:${S.view}:${S.view === 'spec' ? S.specId : ''}`"
          />
        </div>
      </main>
      <ChatPanel v-if="!home" />
    </div>
    <DialogHost />
    <ToastNotification
      :message="notification"
      :target="editors.state.dialog ? '#modal' : 'body'"
    />
  </v-app>
</template>

<style scoped>
.standalone-plan {
  min-height: 100dvh;
  width: 100%;
  background: var(--bg);
}
</style>
