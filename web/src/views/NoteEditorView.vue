<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

const route = useRoute();
const router = useRouter();
const content = ref("");
const saving = ref(false);
const name = ref("");
const preview = ref(false);

onMounted(async () => {
  name.value = route.params.name as string;
  const note = await api.get<{ name: string; content: string }>(`/notes/${encodeURIComponent(name.value)}`);
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
  <div>
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold">{{ name }}</h2>
      <div class="flex gap-2">
        <button
          @click="preview = !preview"
          :class="preview ? 'text-gray-900' : 'text-gray-400'"
          class="px-3 py-1.5 text-sm hover:text-gray-700 transition"
        >
          {{ preview ? "Bearbeiten" : "Vorschau" }}
        </button>
        <button
          @click="save"
          :disabled="saving"
          class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50 transition"
        >
          {{ saving ? "Speichert..." : "Speichern" }}
        </button>
        <button
          @click="router.back()"
          class="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition"
        >
          Zurueck
        </button>
      </div>
    </div>

    <div v-if="preview" class="border border-gray-100 rounded p-5 min-h-[400px]">
      <MarkdownRenderer :content="content" />
    </div>

    <textarea
      v-else
      v-model="content"
      rows="25"
      class="w-full px-4 py-3 border border-gray-200 rounded font-mono text-sm outline-none focus:ring-1 focus:ring-gray-400 resize-y"
    ></textarea>
  </div>
</template>
