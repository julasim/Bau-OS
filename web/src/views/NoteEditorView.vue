<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import BIcon from "../components/BIcon.vue";

const route = useRoute();
const router = useRouter();
const content = ref("");
const saving = ref(false);
const name = ref("");
const preview = ref(false);

onMounted(async () => {
  name.value = route.params.name as string;
  const note = await api.get<{ name: string; content: string }>(
    `/notes/${encodeURIComponent(name.value)}`,
  );
  content.value = note.content;
});

async function save() {
  saving.value = true;
  try {
    await api.put(`/notes/${encodeURIComponent(name.value)}`, { content: content.value });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div style="max-width: 760px; margin: 0 auto; padding: 40px 48px; color: var(--color-text)">
    <button
      @click="router.back()"
      class="flex items-center"
      style="
        gap: 4px;
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        font-size: 12px;
        cursor: pointer;
        margin-bottom: 16px;
      "
    >
      <BIcon name="arrowLeft" :size="12" />
      Alle Notizen
    </button>

    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Notiz</div>
        <h1 style="font-size: 28px; font-weight: 600; margin: 0; letter-spacing: -0.01em">
          {{ name }}
        </h1>
      </div>
      <div class="flex" style="gap: 8px">
        <button
          @click="preview = !preview"
          class="bauos-btn ghost"
        >
          {{ preview ? "Bearbeiten" : "Vorschau" }}
        </button>
        <button @click="save" :disabled="saving" class="bauos-btn solid">
          {{ saving ? "Speichert…" : "Speichern" }}
        </button>
      </div>
    </div>

    <div
      v-if="preview"
      style="
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 24px 28px;
        min-height: 400px;
        background: var(--color-bg);
        font-size: 14px;
        line-height: 1.7;
        color: var(--color-text-secondary);
      "
    >
      <MarkdownRenderer :content="content" />
    </div>

    <textarea
      v-else
      v-model="content"
      rows="28"
      class="font-mono"
      style="
        width: 100%;
        padding: 16px 20px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        outline: none;
        background: var(--color-bg);
        color: var(--color-text);
        font-size: 14px;
        line-height: 1.6;
        resize: vertical;
      "
    />
  </div>
</template>

