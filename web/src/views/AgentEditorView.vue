<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";

const route = useRoute();
const router = useRouter();
const content = ref("");
const saving = ref(false);
const agentName = ref("");
const filename = ref("");

onMounted(async () => {
  agentName.value = route.params.name as string;
  filename.value = route.params.filename as string;
  const file = await api.get<{ name: string; content: string }>(
    `/agents/${encodeURIComponent(agentName.value)}/files/${encodeURIComponent(filename.value)}`,
  );
  content.value = file.content;
});

async function save() {
  saving.value = true;
  try {
    await api.put(
      `/agents/${encodeURIComponent(agentName.value)}/files/${encodeURIComponent(filename.value)}`,
      { content: content.value },
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div style="max-width: 960px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)">
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
      Zurück
    </button>

    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div
          class="font-mono eyebrow"
          style="margin-bottom: 6px"
        >
          {{ agentName }}
        </div>
        <h1
          class="font-mono"
          style="font-size: 20px; font-weight: 600; margin: 0; color: var(--color-text)"
        >
          {{ filename }}
        </h1>
      </div>
      <button
        @click="save"
        :disabled="saving"
        class="bauos-btn solid"
      >
        {{ saving ? "Speichert…" : "Speichern" }}
      </button>
    </div>

    <textarea
      v-model="content"
      rows="32"
      class="font-mono"
      style="
        width: 100%;
        padding: 16px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        outline: none;
        background: var(--color-bg-subtle);
        color: var(--color-text);
        font-size: 13px;
        line-height: 1.55;
        resize: vertical;
      "
    />
  </div>
</template>

<style scoped>
.bauos-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: var(--color-bg);
  transition: opacity 180ms ease;
}
.bauos-btn:hover {
  opacity: 0.9;
}
.bauos-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
