<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { api } from "../api";

interface DbStatus {
  enabled: boolean;
  mode?: string;
  healthy?: boolean;
  pgvector?: boolean;
  embedding?: { ok: boolean; model: string; dimensions: number; error?: string };
  embeddingSchema?: {
    ok: boolean;
    configured: number;
    schema: { notes: number | null; files: number | null };
    error?: string;
  };
  realtime?: { enabled?: boolean; active?: boolean; lastError?: string | null };
  error?: string;
}

const status = ref<DbStatus | null>(null);
const dismissed = ref<string | null>(null); // key des dismissed Banners in dieser Session
let timer: number | null = null;

async function load() {
  try {
    status.value = await api.get<DbStatus>("/dashboard/db-status");
  } catch {
    status.value = null;
  }
}

const banner = computed<{ key: string; level: "warn" | "error"; text: string } | null>(() => {
  const s = status.value;
  if (!s) return null;

  // DB komplett aus → Chat + File-Upload deaktiviert
  if (!s.enabled) {
    return {
      key: "db-off",
      level: "warn",
      text: "Datenbank nicht konfiguriert — Chat-Verlauf, Datei-Upload und semantische Suche sind deaktiviert. Setze DATABASE_URL in der .env um sie zu aktivieren.",
    };
  }

  // DB an, aber nicht erreichbar
  if (s.enabled && s.healthy === false) {
    return {
      key: "db-unhealthy",
      level: "error",
      text: `Datenbank nicht erreichbar${s.error ? ` (${s.error})` : ""} — viele Funktionen sind gerade gestört.`,
    };
  }

  // Dimensions-Mismatch → Embeddings crashen
  if (s.embeddingSchema && s.embeddingSchema.ok === false) {
    const { configured, schema } = s.embeddingSchema;
    const schemaDims = [schema.notes, schema.files].filter((d) => d !== null).join("/");
    return {
      key: "embed-dim-mismatch",
      level: "error",
      text: `Embedding-Dimension stimmt nicht: EMBEDDING_DIMENSIONS=${configured}, DB-Schema=${schemaDims || "unbekannt"}. Neue Notizen/Dateien bekommen kein Embedding — Migration erforderlich.`,
    };
  }

  // Embedding-Provider down
  if (s.embedding && s.embedding.ok === false) {
    return {
      key: "embed-unhealthy",
      level: "warn",
      text: `Embedding-Provider nicht erreichbar (Modell: ${s.embedding.model}) — neue Inhalte sind nicht semantisch suchbar, bis der Provider zurück ist. Prüfe: ollama pull ${s.embedding.model}`,
    };
  }

  // pgvector fehlt
  if (s.pgvector === false) {
    return {
      key: "pgvector-missing",
      level: "warn",
      text: "pgvector-Extension nicht aktiv — semantische Suche deaktiviert. CREATE EXTENSION vector; auf der Datenbank ausführen.",
    };
  }

  // Realtime-Bridge down (nur wenn Supabase konfiguriert)
  if (s.realtime && s.realtime.enabled && s.realtime.active === false) {
    return {
      key: "realtime-down",
      level: "warn",
      text: `Realtime-Bridge inaktiv${s.realtime.lastError ? ` (${s.realtime.lastError})` : ""} — Live-Updates in anderen Tabs verzögert.`,
    };
  }

  return null;
});

const visible = computed(() => banner.value && banner.value.key !== dismissed.value);

function dismiss() {
  if (banner.value) dismissed.value = banner.value.key;
}

onMounted(() => {
  load();
  // Alle 60 s neu prüfen — Banner verschwindet automatisch sobald der Zustand gut ist
  timer = window.setInterval(load, 60_000);
});
onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <div
    v-if="visible && banner"
    :class="[
      'border-b px-4 py-2 flex items-start gap-3 text-sm',
      banner.level === 'error'
        ? 'bg-red-50 border-red-200 text-red-900'
        : 'bg-amber-50 border-amber-200 text-amber-900',
    ]"
  >
    <span class="font-medium shrink-0">{{ banner.level === 'error' ? 'Fehler' : 'Hinweis' }}:</span>
    <span class="flex-1">{{ banner.text }}</span>
    <button
      @click="dismiss"
      class="shrink-0 text-xs opacity-60 hover:opacity-100 transition"
      title="Für diese Session ausblenden"
    >
      ✕
    </button>
  </div>
</template>
