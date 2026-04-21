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
  embeddingCoverage?: {
    ok: boolean;
    notes: { total: number; embedded: number };
    files: { total: number; embedded: number };
  };
  realtime?: { enabled?: boolean; active?: boolean; lastError?: string | null };
  error?: string;
}

const status = ref<DbStatus | null>(null);
const dismissed = ref<string | null>(null); // key des dismissed Banners in dieser Session
const reindexing = ref(false);
let timer: number | null = null;

async function load() {
  try {
    status.value = await api.get<DbStatus>("/dashboard/db-status");
  } catch {
    status.value = null;
  }
}

async function runReindex() {
  if (reindexing.value) return;
  reindexing.value = true;
  try {
    await api.post("/search/reindex", {});
    await load(); // Status neu laden → Banner verschwindet wenn Coverage=100%
  } catch (e) {
    console.error("[Reindex]", e);
  } finally {
    reindexing.value = false;
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

  // Embedding-Coverage-Luecke: Notizen/Dateien ohne Embedding werden von
  // semantisch_suchen komplett ignoriert (WHERE embedding IS NOT NULL).
  // Typische Ursache: Embedding-Provider war bei der Erstellung offline.
  // Fix: /api/search/reindex triggern — der Button im Banner macht das.
  if (s.embeddingCoverage && s.embeddingCoverage.ok === false) {
    const { notes, files } = s.embeddingCoverage;
    const noteGap = notes.total - notes.embedded;
    const fileGap = files.total - files.embedded;
    const parts: string[] = [];
    if (noteGap > 0) parts.push(`${noteGap} Notiz(en) (${notes.embedded}/${notes.total})`);
    if (fileGap > 0) parts.push(`${fileGap} Datei(en) (${files.embedded}/${files.total})`);
    return {
      key: "embed-coverage-gap",
      level: "warn",
      text: `Semantische Suche unvollständig: ${parts.join(
        ", ",
      )} haben kein Embedding. Diese Inhalte werden von der Dateisuche im Chat NICHT gefunden. Klick rechts auf „Neu indexieren" um die fehlenden Embeddings zu erzeugen.`,
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
    class="flex items-start gap-3"
    :style="
      banner.level === 'error'
        ? {
            background: 'var(--color-danger-bg)',
            borderBottom: '1px solid var(--color-danger-border)',
            color: 'var(--color-danger-text)',
          }
        : {
            background: 'var(--color-warning-bg)',
            borderBottom: '1px solid var(--color-warning-border)',
            color: 'var(--color-warning-text)',
          }
    "
    style="padding: 8px 24px; font-size: 12px; flex-shrink: 0"
  >
    <span
      class="shrink-0"
      style="
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background: currentColor;
        margin-top: 6px;
        opacity: 0.7;
      "
    />
    <span class="flex-1">{{ banner.text }}</span>
    <button
      v-if="banner.key === 'embed-coverage-gap'"
      @click="runReindex"
      :disabled="reindexing"
      class="shrink-0"
      style="
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid currentColor;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      "
    >
      {{ reindexing ? "Indexiere…" : "Neu indexieren" }}
    </button>
    <button
      @click="dismiss"
      class="shrink-0"
      style="font-size: 11px; opacity: 0.5; background: transparent; border: none; cursor: pointer; color: inherit"
      title="Für diese Session ausblenden"
    >
      ✕
    </button>
  </div>
</template>
