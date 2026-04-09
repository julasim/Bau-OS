<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";

interface SearchResult {
  file: string;
  line: string;
  lineNumber: number;
}

const query = ref("");
const results = ref<SearchResult[]>([]);
const searched = ref(false);

async function search() {
  if (!query.value.trim()) return;
  searched.value = true;
  results.value = await api.get<SearchResult[]>(`/search?q=${encodeURIComponent(query.value)}`);
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Vault durchsuchen</h2>

    <div class="flex gap-2 mb-6">
      <input
        v-model="query"
        placeholder="Suchbegriff..."
        @keyup.enter="search"
        class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
      />
      <button @click="search" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Suchen</button>
    </div>

    <div class="divide-y divide-gray-100">
      <div v-for="r in results" :key="r.file + r.lineNumber" class="py-2.5">
        <p class="text-xs text-gray-400 font-mono">{{ r.file }}:{{ r.lineNumber }}</p>
        <p class="text-sm text-gray-700 mt-0.5">{{ r.line }}</p>
      </div>
      <p v-if="searched && results.length === 0" class="text-gray-400 text-sm py-4">Keine Ergebnisse.</p>
    </div>
  </div>
</template>
