<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — Avatar (Initialen-Bubble)
// ============================================================

import { computed } from "vue";

const props = defineProps<{
  name?: string | null;
  initials?: string | null;
  color?: string | null;
  size?: 20 | 24 | 36;
}>();

const computedInitials = computed(() => {
  if (props.initials) return props.initials;
  if (!props.name) return "?";
  const parts = props.name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
});

const sizeClass = computed(() => {
  if (props.size === 20) return "v2-avatar v2-avatar-sm";
  if (props.size === 36) return "v2-avatar v2-avatar-lg";
  return "v2-avatar";
});
</script>

<template>
  <span :class="sizeClass" :style="{ background: color ?? '#3F3F46' }" :title="name ?? ''">
    {{ computedInitials }}
  </span>
</template>
