<script setup>
defineProps({ label: String, title: String, description: String });
</script>
<template>
  <div class="page-head">
    <div class="eyebrow">{{ label }}</div>
    <div class="row between">
      <div class="title-cluster">
        <h1>{{ title }}</h1>
        <slot name="badge" />
      </div>
      <div class="page-actions row"><slot /></div>
    </div>
    <p v-if="description">{{ description }}</p>
  </div>
</template>
