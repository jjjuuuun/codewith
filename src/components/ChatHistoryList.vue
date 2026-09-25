<script setup>
import { t as __t } from "../i18n/index.js";

import { ref } from "vue";
import { date } from "../services/format.js";
defineProps({ threads: { type: Array, required: true } });
const search = ref("");
const matches = (thread) =>
  [thread.title, thread.scope, thread.preview, thread.searchText]
    .join(" ")
    .toLocaleLowerCase()
    .includes((search.value || "").trim().toLocaleLowerCase());
</script>
<template>
  <input
    id="chat-history-search"
    v-model="search"
    type="search"
    :aria-label="__t('대화 검색')"
    :placeholder="__t('대화 검색')"
  />
  <p
    v-if="!threads.some(matches)"
    class="muted"
  >
    {{ __t("표시할 대화가 없습니다.") }}
  </p>
  <section
    v-for="thread in threads.filter(matches)"
    :key="thread.id"
    class="chat-history-entry"
  >
    <div class="row between">
      <b>{{ thread.title }}</b>
      <div class="row">
        <CwButton
          v-if="!thread.unavailable"
          action="load-chat-history"
          class="small"
          :data-spec="thread.specId || ''"
          :data-thread="thread.id"
          >{{ __t("불러오기") }}</CwButton
        >
        <CwButton
          action="rename-chat"
          class="small ghost"
          :data-id="thread.id"
          :aria-label="__t('대화 이름 변경')"
          :title="__t('대화 이름 변경')"
          ><CwIcon name="edit"
        /></CwButton>
        <CwButton
          action="delete-chat"
          class="small ghost"
          :data-id="thread.id"
          :aria-label="__t('대화 삭제')"
          :title="__t('대화 삭제')"
          ><CwIcon name="trash"
        /></CwButton>
      </div>
    </div>
    <small class="muted"
      >{{ thread.scope }} · {{ thread.count }}{{ __t("개 메시지 ·") }}
      {{ date(thread.updatedAt) }}</small
    >
    <p>{{ thread.preview || __t("아직 메시지가 없습니다.") }}</p>
    <CwButton
      action="preview-chat"
      class="small ghost"
      :data-id="thread.id"
      >{{ __t("대화 내용 보기") }}</CwButton
    >
  </section>
</template>
