<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { api } from "../api";
import BIcon from "./BIcon.vue";

interface DbStatus {
  enabled: boolean;
  healthy?: boolean;
  error?: string;
}

const status = ref<DbStatus | null>(null);
const backendDown = ref(false);
const dismissed = ref<string | null>(null); // key des dismissed Banners in dieser Session
let timer: number | null = null;

async function load() {
  try {
    status.value = await api.get<DbStatus>("/dashboard/db-status");
    backendDown.value = false;
  } catch (err) {
    // Netzwerkfehler (TypeError: Failed to fetch) → Backend nicht erreichbar.
    // HTTP-Fehler (4xx/5xx) werden von api.get() bereits als Error geworfen,
    // aber der /dashboard/db-status-Endpunkt sollte bei 401 eh auf /login umleiten.
    if (err instanceof TypeError || (err instanceof Error && err.message.includes("fetch"))) {
      backendDown.value = true;
    }
    status.value = null;
  }
}

const banner = computed<{ key: string; level: "warn" | "error"; text: string } | null>(() => {
  if (backendDown.value) {
    return {
      key: "backend-down",
      level: "error",
      text: "Server nicht erreichbar — bitte Netzwerkverbindung und Server-Status prüfen. Die Seite wird automatisch aktualisiert.",
    };
  }

  const s = status.value;
  if (!s) return null;

  // DB komplett aus → der Server kann fast nichts
  if (!s.enabled) {
    return {
      key: "db-off",
      level: "warn",
      text: "Datenbank nicht konfiguriert — Datei-Upload und Suche sind deaktiviert. Setze DATABASE_URL in der .env um sie zu aktivieren.",
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
      @click="dismiss"
      class="shrink-0"
      style="font-size: 11px; opacity: 0.5; background: transparent; border: none; cursor: pointer; color: inherit"
      title="Für diese Session ausblenden"
    >
      <BIcon name="x" :size="12" />
    </button>
  </div>
</template>
