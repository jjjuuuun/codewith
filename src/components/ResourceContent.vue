<script setup>
import { computed } from "vue";
const props = defineProps({ resource: { type: Object, required: true } });
const max = computed(() =>
  Math.max(1, ...(props.resource.values || []).map((x) => x.value)),
);
</script>
<template>
  <img
    v-if="resource.type === 'image'"
    :src="resource.data"
    :alt="resource.title"
    class="resource-image"
  />
  <div
    v-else-if="resource.type === 'table'"
    class="resource-table"
  >
    <table>
      <thead>
        <tr>
          <th
            v-for="(cell, i) in resource.headers"
            :key="i"
          >
            {{ cell }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in resource.rows"
          :key="i"
        >
          <td
            v-for="(cell, j) in row"
            :key="j"
          >
            {{ cell }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <div
    v-else-if="resource.type === 'chart'"
    class="bar-chart"
  >
    <div
      v-for="(item, i) in resource.values"
      :key="i"
      class="bar-row"
    >
      <span>{{ item.label }}</span>
      <div>
        <i :style="{ width: Math.max(0, (item.value / max) * 100) + '%' }" />
      </div>
      <b>{{ item.value }}</b>
    </div>
  </div>
  <div
    v-else-if="resource.type === 'flow'"
    class="flow"
  >
    <template
      v-for="(step, i) in resource.steps"
      :key="i"
      ><span
        v-if="i"
        class="flow-arrow"
        >↓</span
      >
      <div>{{ step }}</div></template
    >
  </div>
  <MarkdownContent
    v-else
    :text="resource.text"
  />
</template>
