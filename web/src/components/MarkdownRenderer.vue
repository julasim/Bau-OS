<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";

const props = defineProps<{ content: string }>();

marked.setOptions({
  breaks: true,
  gfm: true,
});

const html = computed(() => marked.parse(props.content) as string);
</script>

<template>
  <div class="prose prose-sm max-w-none" v-html="html"></div>
</template>

<style scoped>
.prose :deep(h1) { font-size: 1.5rem; font-weight: 700; margin: 1rem 0 0.5rem; }
.prose :deep(h2) { font-size: 1.25rem; font-weight: 600; margin: 0.8rem 0 0.4rem; }
.prose :deep(h3) { font-size: 1.1rem; font-weight: 600; margin: 0.6rem 0 0.3rem; }
.prose :deep(p) { margin: 0.4rem 0; line-height: 1.6; }
.prose :deep(ul), .prose :deep(ol) { padding-left: 1.5rem; margin: 0.4rem 0; }
.prose :deep(li) { margin: 0.2rem 0; }
.prose :deep(code) { background: #f3f4f6; padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.85em; }
.prose :deep(pre) { background: #1f2937; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.5rem 0; }
.prose :deep(pre code) { background: none; padding: 0; color: inherit; }
.prose :deep(blockquote) { border-left: 3px solid #d1d5db; padding-left: 1rem; color: #6b7280; margin: 0.5rem 0; }
.prose :deep(a) { color: #2563eb; text-decoration: underline; }
.prose :deep(table) { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
.prose :deep(th), .prose :deep(td) { border: 1px solid #e5e7eb; padding: 0.4rem 0.8rem; text-align: left; }
.prose :deep(th) { background: #f9fafb; font-weight: 600; }
.prose :deep(hr) { border: none; border-top: 1px solid #e5e7eb; margin: 1rem 0; }
.prose :deep(img) { max-width: 100%; border-radius: 0.5rem; }
.prose :deep(input[type="checkbox"]) { margin-right: 0.4rem; }
</style>
