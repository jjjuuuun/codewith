<script setup>
import { t as __t } from "../i18n/index.js";

import ResourceContent from "./ResourceContent.vue";
import InlineEditor from "./forms/InlineEditor.vue";
import { useWorkspace } from "../composables/useWorkspace.js";
import { statusLabel } from "../../shared/completion.mjs";
import { date } from "../services/format.js";
defineOptions({ inheritAttrs: false });
defineProps({
  requirement: { type: Object, required: true },
  spec: { type: Object, required: true },
});
const { canEdit } = useWorkspace();
</script>
<template>
  <article
    v-bind="$attrs"
    :data-requirement-card="requirement.id"
    :data-spec-card="spec.id"
    class="card requirement-card"
    :data-search="
      `${spec.title} ${spec.id} ${requirement.id} ${requirement.title} ${requirement.body}`.toLowerCase()
    "
  >
    <div class="row between">
      <div class="row">
        <code
          class="muted"
          style="font-size: 11px"
          >{{ requirement.id }}</code
        ><span
          class="pill"
          :class="requirement.status"
          >{{ __t(statusLabel(requirement.status)) }}</span
        >
      </div>
      <div class="row">
        <CwButton
          v-if="requirement.status !== 'completed'"
          action="complete-requirement"
          class="small"
          :data-id="requirement.id"
          :data-spec="spec.id"
          :disabled="!canEdit || !spec.plans?.finalVersionId"
          :title="
            !spec.plans?.finalVersionId
              ? __t('최종 계획을 먼저 승인하세요.')
              : __t('구현 완료 기록')
          "
          >{{ __t("구현 완료 기록") }}</CwButton
        >
        <CwButton
          action="edit-requirement"
          class="small ghost"
          :data-id="requirement.id"
          :data-spec="spec.id"
          :disabled="!canEdit"
          >{{ __t("편집") }}</CwButton
        ><CwButton
          action="remove-requirement"
          class="danger small ghost"
          :data-id="requirement.id"
          :data-spec="spec.id"
          :disabled="!canEdit"
          >{{ __t("삭제") }}</CwButton
        >
      </div>
    </div>
    <h3 style="margin-top: 10px">{{ requirement.title }}</h3>
    <MarkdownContent :text="requirement.body" />
    <div
      class="eyebrow"
      style="margin-top: 18px"
    >
      {{ __t("완료 기준 ·") }} {{ requirement.criteria.length }}
    </div>
    <ul class="criteria">
      <li
        v-for="c in requirement.criteria"
        :key="c.id"
      >
        <span
          ><code>{{ c.id }}</code
          >{{ c.text }}</span
        >
      </li>
    </ul>
    <p
      v-if="requirement.completion && requirement.status === 'completed'"
      class="completion-note"
    >
      {{ requirement.completion.by.name }} ·
      {{ date(requirement.completion.at) }} {{ __t("구현 완료")
      }}{{
        requirement.completion.codeRevision
          ? " · " + requirement.completion.codeRevision
          : ""
      }}
    </p>
    <p
      v-if="
        requirement.status === 'completed' && requirement.completion?.summary
      "
      class="muted"
    >
      {{ requirement.completion.summary }}
    </p>
    <div
      class="resource-section"
      :data-requirement="requirement.id"
      :data-spec="spec.id"
    >
      <div class="row between">
        <span class="eyebrow"
          >{{ __t("참고 자료 ·") }}
          {{ requirement.resources?.length || 0 }}</span
        ><CwButton
          action="resources"
          class="small ghost"
          :data-id="requirement.id"
          :data-spec="spec.id"
          :disabled="!canEdit"
          >{{ __t("자료 추가 · 편집") }}</CwButton
        >
      </div>
      <details
        v-for="resource in requirement.resources || []"
        :key="resource.id"
        class="resource"
      >
        <summary>
          {{ resource.title }}
          <small>{{
            {
              image: "이미지",
              table: "표",
              chart: "막대그래프",
              flow: "흐름도",
              note: "메모",
            }[resource.type]
          }}</small>
        </summary>
        <ResourceContent :resource="resource" />
      </details>
      <InlineEditor
        :resource-requirement="requirement.id"
        :resource-spec="spec.id"
      />
    </div>
    <div class="meta">
      {{ __t("작성") }} {{ requirement.createdBy?.name || "—" }}
      {{ __t("· 최근 수정") }} {{ requirement.updatedBy?.name || "—" }}
    </div>
  </article>
  <InlineEditor
    :requirement-id="requirement.id"
    :requirement-spec="spec.id"
  />
</template>
