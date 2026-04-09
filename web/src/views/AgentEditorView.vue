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
      <div>
        <h2 class="text-xl font-bold">{{ agentName }} / {{ filename }}</h2>
      </div>
      <div class="flex gap-2">
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

    <textarea
      v-model="content"
      rows="30"
      class="w-full px-4 py-3 border border-gray-300 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y bg-white"
    ></textarea>
  </div>
</template>
