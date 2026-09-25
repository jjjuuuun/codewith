<script setup>
import { t as __t } from "../i18n/index.js";

import { computed, defineAsyncComponent, nextTick, onMounted } from "vue";
import { guides } from "../../shared/guides.mjs";
import ThemeControl from "../components/ThemeControl.vue";
const props = defineProps({ guide: { type: Object, required: true } });
const pages = {
  usage: defineAsyncComponent(() => import("./guides/UsageGuide.vue")),
  deployment: defineAsyncComponent(
    () => import("./guides/DeploymentGuide.vue"),
  ),
  ai: defineAsyncComponent(() => import("./guides/AIGuide.vue")),
};
const page = computed(() => pages[props.guide.id]);
async function scrollToSection() {
  await nextTick();
  if (location.hash) {
    try {
      document
        .getElementById(decodeURIComponent(location.hash.slice(1)))
        ?.scrollIntoView();
    } catch {
      /* A malformed fragment must not prevent reading the guide. */
    }
  }
}
onMounted(() => {
  document.title = `${__t(props.guide.title)} · CodeWith`;
});
</script>
<template>
  <v-app>
    <div class="guide-layout">
      <header class="guide-header">
        <a
          class="brand"
          href="/"
          ><img
            src="/logo.svg"
            alt=""
          />codewith</a
        >
        <div class="row">
          <ThemeControl /><a
            href="/"
            class="button-link"
            >{{ __t("앱으로 돌아가기") }}</a
          >
        </div>
      </header>
      <div class="guide-container">
        <nav
          class="guide-navigation"
          :aria-label="__t('안내 페이지')"
        >
          <a
            v-for="item in guides"
            :key="item.id"
            :href="item.path"
            :aria-current="guide.id === item.id ? 'page' : undefined"
            >{{ __t(item.title) }}</a
          >
        </nav>
        <main
          class="guide-content"
          id="guide-content"
        >
          <Suspense @resolve="scrollToSection">
            <component :is="page" />
            <template #fallback
              ><p role="status">
                {{ __t("안내를 불러오고 있습니다…") }}
              </p></template
            >
          </Suspense>
        </main>
      </div>
    </div>
  </v-app>
</template>
<style scoped>
.guide-layout {
  min-height: 100dvh;
  background: var(--bg);
  color: var(--ink);
}
.guide-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 32px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
}
.guide-container {
  max-width: 1120px;
  margin: auto;
  padding: 32px 32px 80px;
}
.guide-navigation {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--line);
}
.guide-navigation a {
  padding: 8px 16px;
  border-radius: 10px;
  text-decoration: none;
  color: var(--muted);
}
.guide-navigation a[aria-current="page"] {
  background: var(--soft);
  color: var(--green);
  font-weight: 600;
}
.guide-content {
  padding-top: 32px;
  font-size: 15px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.guide-content :deep(h1) {
  font-size: 34px;
  line-height: 1.4;
  margin-bottom: 20px;
}
.guide-content :deep(h2) {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
  font-size: 23px;
}
.guide-content :deep(h3) {
  margin-top: 28px;
}
.guide-content :deep([id]) {
  scroll-margin-top: 24px;
}
.guide-content :deep(nav) {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 16px 0;
}
.guide-content :deep(pre) {
  max-height: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 20px;
  border: 1px solid var(--line);
  background: var(--theme-code);
  color: var(--ink);
  font:
    13px/1.8 ui-monospace,
    Consolas,
    monospace;
}
.guide-content :deep(table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  font-size: 13px;
  margin: 20px 0;
}
.guide-content :deep(:is(th, td)) {
  padding: 12px;
  vertical-align: top;
  border-color: var(--line);
}
.guide-content :deep(th) {
  background: var(--soft);
}
.guide-content :deep(:is(ul, ol)) {
  padding-left: 24px;
}
.guide-content :deep(li) {
  margin: 8px 0;
}
.guide-content :deep(.grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.guide-content :deep(.card) {
  background: var(--paper);
  border-color: var(--line);
}
.guide-content :deep(.note) {
  padding: 20px;
  background: var(--soft);
  color: var(--ink);
  border-left: 4px solid var(--green);
}
.guide-content :deep(.tag) {
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 1px;
}
@media (max-width: 600px) {
  .guide-header {
    padding: 14px 16px;
    flex-wrap: wrap;
  }
  .guide-header .row {
    gap: 10px;
  }
  .guide-container {
    padding: 20px 16px 60px;
  }
  .guide-content :deep(h1) {
    font-size: 28px;
  }
  .guide-content :deep(.grid) {
    grid-template-columns: 1fr;
  }
  .guide-navigation a {
    padding: 8px 12px;
  }
}
</style>
