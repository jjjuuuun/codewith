<script setup>
import { t as __t } from "../i18n/index.js";

import { codeMarkdown } from "../../shared/agent-response.mjs";
import AgentResponseValue from "./AgentResponseValue.vue";
import MarkdownContent from "./MarkdownContent.vue";
defineProps({ response: { type: Object, required: true } });
</script>
<template>
  <div class="response-content">
    <MarkdownContent
      v-if="response.message"
      :text="response.message"
    />
    <section
      v-for="(file, index) in response.files"
      :key="index"
      class="agent-response-file"
    >
      <h3>{{ file.path }}</h3>
      <p v-if="file.incomplete">
        {{ __t("본문 형식 오류로 표시할 수 없습니다.") }}
      </p>
      <MarkdownContent
        v-else-if="
          typeof file.content === 'string' && /\.html?$/.test(file.path)
        "
        :text="codeMarkdown(file.content, 'html')"
      />
      <AgentResponseValue
        v-else
        :value="file.content"
      />
    </section>
    <AgentResponseValue
      v-if="response.extra && Object.keys(response.extra).length"
      :value="response.extra"
    />
    <p v-if="!response.message && !response.files.length && !response.extra">
      {{ __t("응답 내용을 정리하고 있습니다…") }}
    </p>
  </div>
</template>
<style scoped>
.response-content {
  overflow-wrap: anywhere;
}
.agent-response-file {
  border-top: 1px solid var(--line);
  margin-top: 20px;
  padding-top: 12px;
}
</style>
