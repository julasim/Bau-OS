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
    <h2 class="text-xl font-bold mb-4">Vault durchsuchen</h2>

    <div class="flex gap-2 mb-4">
      <input
        v-model="query"
        placeholder="Suchbegriff..."
        @keyup.enter="search"
        class="flex-1 px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      />
      <button @click="search" class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">Suchen</button>
    </div>

    <div class="space-y-2">
      <div v-for="r in results" :key="r.file + r.lineNumber" class="bg-white p-3 rounded-lg border">
        <p class="text-xs text-gray-500 font-mono">{{ r.file }}:{{ r.lineNumber }}</p>
        <p class="text-sm mt-1">{{ r.line }}</p>
      </div>
      <p v-if="searched && results.length === 0" class="text-gray-500 text-sm">Keine Ergebnisse.</p>
    </div>
  </div>
</template>
