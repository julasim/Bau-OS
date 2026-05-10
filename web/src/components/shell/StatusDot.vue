<script setup lang="ts">
// Status-Indikator: open (outline) / doing (amber) / done (green) / blocked (red)
defineProps<{
  status: "open" | "doing" | "done" | "blocked";
}>();
</script>

<template>
  <span :class="`v2-status-dot v2-status-${status}`"></span>
</template>
