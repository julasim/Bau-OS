<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

const currentPath = ref("");
const items = ref<string[]>([]);
const fileContent = ref<string | null>(null);
const fileName = ref("");

const isMarkdown = computed(() => fileName.value.endsWith(".md"));

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
    <div class="flex items-center gap-2 mb-6">
      <h2 class="text-lg font-semibold">Dateien</h2>
      <span class="text-sm text-gray-400 font-mono">/ {{ currentPath || "Vault" }}</span>
    </div>

    <div v-if="fileContent !== null">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-mono text-gray-500">{{ fileName }}</span>
        <button @click="fileContent = null" class="text-sm text-gray-400 hover:text-gray-600 transition">Schliessen</button>
      </div>
      <div v-if="isMarkdown" class="border border-gray-100 rounded p-5 overflow-auto max-h-[600px]">
        <MarkdownRenderer :content="fileContent" />
      </div>
      <pre v-else class="p-4 border border-gray-100 rounded text-sm font-mono whitespace-pre-wrap overflow-auto max-h-[600px] text-gray-700">{{ fileContent }}</pre>
    </div>

    <div v-else class="divide-y divide-gray-100">
      <button
        v-if="currentPath"
        @click="goUp"
        class="block w-full text-left py-2.5 text-sm text-gray-400 hover:text-gray-600 transition"
      >
        ../
      </button>
      <button
        v-for="item in items"
        :key="item"
        @click="openItem(item)"
        class="block w-full text-left py-2.5 text-sm font-mono text-gray-700 hover:text-gray-900 transition"
      >
        {{ item }}
      </button>
      <p v-if="items.length === 0" class="text-gray-400 text-sm py-4">Ordner ist leer.</p>
    </div>
  </div>
</template>
