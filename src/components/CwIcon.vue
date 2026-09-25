<script setup>
import { icon } from "../services/icons.js";
defineProps({ name: String });
</script>
<template>
  <span
    class="cw-icon"
    aria-hidden="true"
    v-html="icon(name)"
  />
</template>
