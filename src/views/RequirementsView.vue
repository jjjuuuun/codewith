<script setup>
import { t as __t } from "../i18n/index.js";

import { ref, computed } from "vue";
import { useWorkspace } from "../composables/useWorkspace.js";
import RequirementCard from "../components/RequirementCard.vue";
const { S } = useWorkspace();
const query = ref("");
const all = computed(() => S.w.document.specs.flatMap((s) => s.requirements));
const matches = (r, s) =>
  `${s.title} ${s.id} ${r.id} ${r.title} ${r.body}`
    .toLowerCase()
    .includes(query.value.toLowerCase());
</script>
<template>
  <PageHeading
    :label="__t('프로젝트 요구사항')"
    :title="__t('전체 요구사항')"
    :description="
      __t(
        '각 개발 단위의 요구사항을 모았습니다. 편집하면 해당 명세의 원본이 변경됩니다.',
      )
    "
  />
  <div class="metrics">
    <div class="metric">
      <small>{{ __t("개발 단위") }}</small
      ><strong>{{ S.w.document.specs.length }}</strong>
    </div>
    <div class="metric">
      <small>{{ __t("전체 요구사항") }}</small
      ><strong>{{ all.length }}</strong>
    </div>
    <div class="metric">
      <small>{{ __t("구현 완료") }}</small
      ><strong>{{ all.filter((r) => r.status === "completed").length }}</strong>
    </div>
  </div>
  <input
    v-model="query"
    class="filter"
    id="requirement-filter"
    :placeholder="__t('식별번호 · 요구사항 · 명세 검색')"
    :aria-label="__t('요구사항 검색')"
  />
  <div id="aggregate">
    <section
      v-for="spec in S.w.document.specs"
      :key="spec.id"
      data-aggregate-section
      :hidden="!!query && !spec.requirements.some((r) => matches(r, spec))"
    >
      <div class="section-title">
        <h3>
          <CwButton
            action="spec"
            :data-id="spec.id"
            class="ghost"
            >{{ spec.title }}</CwButton
          >
          <small>{{ spec.id }}</small>
        </h3>
      </div>
      <RequirementCard
        v-for="r in spec.requirements"
        :key="r.id"
        :requirement="r"
        :spec="spec"
        :hidden="!matches(r, spec)"
      />
      <p
        v-if="!spec.requirements.length"
        class="muted"
      >
        {{ __t("요구사항이 없습니다.") }}
      </p>
    </section>
  </div>
</template>
