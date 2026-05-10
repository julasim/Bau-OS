<script setup lang="ts">
// 32x32 ghost icon button. Wrapper um BIcon + Klick-Handler + a11y.
import BIcon from "../BIcon.vue";

defineProps<{
  icon: string;
  title?: string;
  size?: number;
}>();
</script>

<template>
  <button class="v2-icon-btn" :title="title ?? ''" :aria-label="title ?? ''" type="button">
    <BIcon :name="icon" :size="size ?? 16" />
  </button>
</template>
