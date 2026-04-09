<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";

const currentPath = ref("");
const items = ref<string[]>([]);
const fileContent = ref<string | null>(null);
const fileName = ref("");

async function loadFolder(p = "") {
  currentPath.value = p;
  fileContent.value = null;
  items.value = await api.get<string[]>(`/files?path=${encodeURIComponent(p)}`);
}

async function openItem(item: string) {
  const fullPath = currentPath.value ? `${currentPath.value}/${item}` : item;

  if (item.endsWith(".md") || item.endsWith(".txt") || item.endsWith(".json")) {
    const file = await api.get<{ path: string; content: string }>(`/files/read?path=${encodeURIComponent(fullPath)}`);
    fileContent.value = file.content;
    fileName.value = item;
  } else {
    await loadFolder(fullPath);
  }
}

function goUp() {
  const parts = currentPath.value.split("/").filter(Boolean);
  parts.pop();
  loadFolder(parts.join("/"));
}

onMounted(() => loadFolder());
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-4">
      <h2 class="text-xl font-bold">Dateien</h2>
      <span class="text-sm text-gray-500 font-mono">/ {{ currentPath || "Vault" }}</span>
    </div>

    <div v-if="fileContent !== null" class="mb-4">
      <div class="flex items-center justify-between mb-2">
        <span class="font-mono text-sm font-medium">{{ fileName }}</span>
        <button @click="fileContent = null" class="text-sm text-blue-600 hover:underline">Schliessen</button>
      </div>
      <pre class="bg-white p-4 rounded-xl border text-sm font-mono whitespace-pre-wrap overflow-auto max-h-[600px]">{{ fileContent }}</pre>
    </div>

    <div v-else class="space-y-1">
      <button
        v-if="currentPath"
        @click="goUp"
        class="bg-white p-3 rounded-lg border w-full text-left text-sm text-gray-500 hover:bg-gray-50"
      >
        ../ (zurueck)
      </button>
      <button
        v-for="item in items"
        :key="item"
        @click="openItem(item)"
        class="bg-white p-3 rounded-lg border w-full text-left text-sm hover:bg-gray-50 font-mono"
      >
        {{ item }}
      </button>
      <p v-if="items.length === 0" class="text-gray-500 text-sm">Ordner ist leer.</p>
    </div>
  </div>
</template>
