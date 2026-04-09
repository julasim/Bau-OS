<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";

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
    `/agents/${encodeURIComponent(agentName.value)}/files/${encodeURIComponent(filename.value)}`
  );
  content.value = file.content;
});

async function save() {
  saving.value = true;
  try {
    await api.put(
      `/agents/${encodeURIComponent(agentName.value)}/files/${encodeURIComponent(filename.value)}`,
      { content: content.value }
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="text-sm text-gray-400">{{ agentName }}</span>
        <span class="text-gray-300">/</span>
        <h2 class="text-lg font-semibold">{{ filename }}</h2>
      </div>
      <div class="flex gap-2">
        <button
          @click="save"
          :disabled="saving"
          class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50 transition"
        >
          {{ saving ? "Speichert..." : "Speichern" }}
        </button>
        <button
          @click="router.back()"
          class="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition"
        >
          Zurueck
        </button>
      </div>
    </div>

    <textarea
      v-model="content"
      rows="30"
      class="w-full px-4 py-3 border border-gray-200 rounded font-mono text-sm outline-none focus:ring-1 focus:ring-gray-400 resize-y"
    ></textarea>
  </div>
</template>
