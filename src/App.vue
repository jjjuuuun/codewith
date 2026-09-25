<script setup>
import { defineAsyncComponent } from "vue";
import { guideForPath } from "../shared/guides.mjs";
const guide = guideForPath(window.location.pathname);
const screen = defineAsyncComponent(
  guide
    ? () => import("./views/GuideView.vue")
    : () => import("./WorkspaceApp.vue"),
);
</script>
<template>
  <component
    :is="screen"
    v-bind="guide ? { guide } : {}"
  />
</template>
