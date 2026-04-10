<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";

interface TextResult {
  file: string;
  line: string;
}

interface SemanticResult {
  id: string;
  type: "note" | "file";
  title: string;
  snippet: string;
  score: number;
  project?: string | null;
}

type SearchResponse =
  | { mode: "text"; results: TextResult[] }
  | { mode: "semantic"; results: SemanticResult[] };

const query = ref("");
const mode = ref<"hybrid" | "semantic" | "text">("hybrid");
const searched = ref(false);
const loading = ref(false);
const responseMode = ref<"text" | "semantic">("text");
const textResults = ref<TextResult[]>([]);
const semanticResults = ref<SemanticResult[]>([]);

async function search() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  textResults.value = [];
  semanticResults.value = [];

  try {
    const res = await api.get<SearchResponse>(
      `/search?q=${encodeURIComponent(query.value)}&mode=${mode.value}`
    );
    responseMode.value = res.mode;
    if (res.mode === "text") {
      textResults.value = res.results as TextResult[];
    } else {
      semanticResults.value = res.results as SemanticResult[];
    }
  } catch {
    // Fehler ignorieren
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Suche</h2>

    <div class="flex gap-2 mb-4">
      <input
        v-model="query"
        placeholder="Suchbegriff oder Frage..."
        @keyup.enter="search"
        class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
      />
      <button @click="search" :disabled="loading" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition disabled:opacity-50">
        {{ loading ? '...' : 'Suchen' }}
      </button>
    </div>

    <!-- Mode Toggle -->
    <div class="flex gap-3 mb-6 text-sm">
      <button
        v-for="m in (['hybrid', 'semantic', 'text'] as const)"
        :key="m"
        @click="mode = m"
        :class="mode === m ? 'text-gray-900 font-medium' : 'text-gray-400'"
        class="hover:text-gray-600 transition"
      >
        {{ m === 'hybrid' ? 'Hybrid' : m === 'semantic' ? 'Semantisch' : 'Text' }}
      </button>
      <span class="text-xs text-gray-300 ml-auto self-center">
        {{ responseMode === 'semantic' ? 'KI-Suche' : 'Textsuche' }}
      </span>
    </div>

    <!-- Semantic Results -->
    <div v-if="responseMode === 'semantic' && semanticResults.length > 0" class="divide-y divide-gray-100">
      <div v-for="r in semanticResults" :key="r.id" class="py-3">
        <div class="flex items-center gap-2">
          <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{{ r.type === 'note' ? 'Notiz' : 'Datei' }}</span>
          <span class="text-sm font-medium text-gray-800">{{ r.title }}</span>
          <span v-if="r.project" class="text-xs text-gray-400">{{ r.project }}</span>
          <span class="text-xs text-gray-300 ml-auto">{{ (r.score * 100).toFixed(0) }}%</span>
        </div>
        <p class="text-xs text-gray-500 mt-1 line-clamp-2">{{ r.snippet }}</p>
      </div>
    </div>

    <!-- Text Results -->
    <div v-if="responseMode === 'text' && textResults.length > 0" class="divide-y divide-gray-100">
      <div v-for="r in textResults" :key="r.file" class="py-2.5">
        <p class="text-xs text-gray-400 font-mono">{{ r.file }}</p>
        <p class="text-sm text-gray-700 mt-0.5">{{ r.line }}</p>
      </div>
    </div>

    <p v-if="searched && !loading && textResults.length === 0 && semanticResults.length === 0" class="text-gray-400 text-sm py-4">
      Keine Ergebnisse.
    </p>
  </div>
</template>
