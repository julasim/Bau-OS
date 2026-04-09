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
      <h2 class="text-xl font-bold">{{ name }}</h2>
      <div class="flex gap-2">
        <button
          @click="preview = !preview"
          :class="preview ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'"
          class="px-4 py-2 text-sm rounded-lg transition"
        >
          {{ preview ? "Bearbeiten" : "Vorschau" }}
        </button>
        <button
          @click="save"
          :disabled="saving"
          class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {{ saving ? "Speichert..." : "Speichern" }}
        </button>
        <button
          @click="router.back()"
          class="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition"
        >
          Zurueck
        </button>
      </div>
    </div>

    <div v-if="preview" class="bg-white p-6 rounded-xl border min-h-[400px]">
      <MarkdownRenderer :content="content" />
    </div>

    <textarea
      v-else
      v-model="content"
      rows="25"
      class="w-full px-4 py-3 border border-gray-300 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y bg-white"
    ></textarea>
  </div>
</template>
