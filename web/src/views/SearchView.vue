<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";

const EXAMPLE_CHIPS = ["Bautagebuch", "Offene Aufgaben", "Aktuell"];

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

type SearchResponse = { mode: "text"; results: TextResult[] } | { mode: "semantic"; results: SemanticResult[] };

const query = ref("");
const searched = ref(false);
const loading = ref(false);
const responseMode = ref<"text" | "semantic">("text");
const textResults = ref<TextResult[]>([]);
const semanticResults = ref<SemanticResult[]>([]);

function fillAndSearch(term: string) {
  query.value = term;
  search();
}

async function search() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  textResults.value = [];
  semanticResults.value = [];

  try {
    const res = await api.get<SearchResponse>(`/search?q=${encodeURIComponent(query.value)}`);
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
  <div style="padding: 24px 32px 32px; color: var(--color-text)">
    <div class="eyebrow" style="margin-bottom: 6px; text-align: center">Inhalte</div>
    <h1
      style="
        font-size: 24px;
        font-weight: 600;
        margin: 0;
        letter-spacing: -0.01em;
        text-align: center;
        margin-bottom: 6px;
      "
    >
      Suche
    </h1>
    <p style="font-size: 13px; color: var(--color-text-muted); text-align: center; margin-bottom: 24px">
      Hybrid-Suche über Notizen, Dateien und Projekte.
    </p>

    <div
      class="flex items-center"
      style="
        gap: 8px;
        padding: 10px 14px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg);
        margin-bottom: 20px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
      "
    >
      <BIcon name="search" :size="16" style="color: var(--color-text-muted)" />
      <input
        v-model="query"
        placeholder="Suchbegriff oder Frage…"
        @keyup.enter="search"
        style="flex: 1; border: none; outline: none; background: transparent; font-size: 14px; color: var(--color-text)"
      />
      <button @click="search" :disabled="loading" class="patio-btn solid" style="padding: 4px 12px; font-size: 12px">
        {{ loading ? "…" : "Suchen" }}
      </button>
    </div>

    <!-- Startscreen — vor der ersten Suche -->
    <div v-if="!searched" class="search-start">
      <BIcon name="search" :size="36" class="search-start-icon" />
      <p class="search-start-hint">Suche nach Projekten, Notizen, Aufgaben, Dateien…</p>
      <div class="search-start-chips">
        <button v-for="chip in EXAMPLE_CHIPS" :key="chip" class="search-chip" @click="fillAndSearch(chip)">
          {{ chip }}
        </button>
      </div>
    </div>

    <p v-if="searched" style="font-size: 11px; color: var(--color-text-tertiary); margin-bottom: 12px">
      {{ responseMode === "semantic" ? semanticResults.length : textResults.length }} Treffer für „{{ query }}" ·
      {{ responseMode === "semantic" ? "Hybrid-Suche (Keyword + Embedding)" : "Text-Suche" }}
    </p>

    <!-- Semantic Results -->
    <div v-if="responseMode === 'semantic' && semanticResults.length > 0" class="flex flex-col" style="gap: 12px">
      <div
        v-for="r in semanticResults"
        :key="r.id"
        style="
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 14px 16px;
          background: var(--color-bg);
          transition: border-color 180ms ease;
        "
        class="search-card"
      >
        <div class="flex items-center" style="gap: 10px; margin-bottom: 6px">
          <span
            style="
              font-size: 10px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              padding: 2px 8px;
              border-radius: 4px;
              background: var(--color-primary);
              color: var(--color-bg);
            "
          >
            {{ r.type === "note" ? "Notiz" : "Datei" }}
          </span>
          <span style="font-size: 13px; font-weight: 500; color: var(--color-text)">
            {{ r.title }}
          </span>
          <span v-if="r.project" class="font-mono" style="font-size: 11px; color: var(--color-text-tertiary)">
            {{ r.project }}
          </span>
        </div>
        <p style="font-size: 12px; color: var(--color-text-muted); line-height: 1.5; margin: 0">
          {{ r.snippet }}
        </p>
      </div>
    </div>

    <!-- Text Results -->
    <div v-if="responseMode === 'text' && textResults.length > 0" class="flex flex-col" style="gap: 8px">
      <div
        v-for="r in textResults"
        :key="r.file + r.line"
        style="
          border: 1px solid var(--color-border-subtle);
          border-radius: 6px;
          padding: 10px 14px;
          background: var(--color-bg);
        "
      >
        <div class="font-mono" style="font-size: 11px; color: var(--color-text-tertiary); margin-bottom: 4px">
          {{ r.file }}
        </div>
        <div style="font-size: 13px; color: var(--color-text-secondary)">
          {{ r.line }}
        </div>
      </div>
    </div>

    <p
      v-if="searched && !loading && textResults.length === 0 && semanticResults.length === 0"
      style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 32px 0"
    >
      Keine Ergebnisse.
    </p>
  </div>
</template>

<style scoped>
.search-card:hover {
  border-color: var(--color-text-faint);
}

/* ── Startscreen (vor erster Suche) ────────────────────── */
.search-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 24px 32px;
  text-align: center;
}
.search-start-icon {
  color: var(--color-text-tertiary);
  opacity: 0.6;
}
.search-start-hint {
  font-size: 14px;
  color: var(--color-text-muted);
  margin: 0;
  max-width: 360px;
  line-height: 1.5;
}
.search-start-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}
.search-chip {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    color 180ms ease,
    background 180ms ease;
}
.search-chip:hover {
  border-color: var(--color-text-faint);
  color: var(--color-text);
  background: var(--color-bg-subtle);
}
</style>
