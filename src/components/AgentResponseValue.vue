<script setup>
import { t as __t } from "../i18n/index.js";

import { responseLabels, codeMarkdown } from "../../shared/agent-response.mjs";
import MarkdownContent from "./MarkdownContent.vue";
defineProps({
  value: { type: [String, Number, Boolean, Object, Array], default: null },
  field: { type: String, default: "" },
  depth: { type: Number, default: 0 },
});
</script>
<template>
  <pre v-if="depth > 16">{{ JSON.stringify(value, null, 2) }}</pre>
  <MarkdownContent
    v-else-if="typeof value === 'string'"
    :text="field === 'mockup' ? codeMarkdown(value, 'html') : value"
  />
  <ol
    v-else-if="Array.isArray(value) && value.length"
    class="agent-value-list"
  >
    <li
      v-for="(item, index) in value"
      :key="index"
    >
      <AgentResponseValue
        :value="item"
        :depth="depth + 1"
      />
    </li>
  </ol>
  <p v-else-if="Array.isArray(value)">{{ __t("없음") }}</p>
  <dl
    v-else-if="value && typeof value === 'object'"
    class="agent-value-fields"
  >
    <template
      v-for="(item, key) in value"
      :key="key"
    >
      <dt>{{ responseLabels[key] || key }}</dt>
      <dd>
        <AgentResponseValue
          :value="item"
          :field="key"
          :depth="depth + 1"
        />
      </dd>
    </template>
  </dl>
  <p v-else>{{ value == null ? __t("없음") : value }}</p>
</template>
<style scoped>
.agent-value-fields {
  margin: 0;
}
.agent-value-fields > dt {
  font-weight: 700;
  margin: 20px 0 8px;
}
.agent-value-fields > dd {
  margin: 0;
  min-width: 0;
}
.agent-value-list {
  padding-left: 22px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
