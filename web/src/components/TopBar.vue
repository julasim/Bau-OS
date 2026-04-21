<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import BIcon from "./BIcon.vue";

const route = useRoute();
const router = useRouter();

// Mapping Route-Name → lesbarer Titel (Breadcrumb + window.title).
const titles: Record<string, string> = {
  dashboard: "Dashboard",
  chat: "Chat",
  tasks: "Aufgaben",
  calendar: "Kalender",
  projects: "Projekte",
  "project-detail": "Projekt",
  notes: "Notizen",
  "note-editor": "Notiz",
  files: "Dateien",
  search: "Suche",
  agents: "Agenten",
  "agent-editor": "Agent",
  settings: "Einstellungen",
  login: "Anmelden",
};

const current = computed(() => titles[String(route.name ?? "")] ?? "Bau-OS");

function openPalette() {
  // Command-Palette ist noch nicht gebaut — Suche-Button navigiert zur Such-Seite.
  router.push("/search");
}
</script>

<template>
  <header
    class="flex items-center gap-4"
    style="
      height: 52px;
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border-subtle);
      padding: 0 24px;
      flex-shrink: 0;
    "
  >
    <!-- Breadcrumb -->
    <nav class="flex items-center gap-1.5 flex-1 min-w-0" style="font-size: 12px">
      <span style="color: var(--color-text-tertiary)">Sima Architektur</span>
      <BIcon name="chevronRight" :size="12" style="color: var(--color-text-faint)" />
      <span style="color: var(--color-text); font-weight: 500">{{ current }}</span>
    </nav>

    <!-- Search button (⌘K) -->
    <button
      @click="openPalette"
      class="flex items-center gap-2"
      style="
        width: 240px;
        padding: 6px 10px 6px 12px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-subtle);
        font-size: 12px;
        cursor: pointer;
      "
      aria-label="Suche oeffnen"
    >
      <BIcon name="search" :size="14" style="color: var(--color-text-muted)" />
      <span class="flex-1 text-left" style="color: var(--color-text-muted)">Suchen…</span>
      <span class="kbd">⌘K</span>
    </button>

    <!-- Bell -->
    <button
      class="relative"
      style="
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--color-text-muted);
      "
      aria-label="Benachrichtigungen"
    >
      <BIcon name="bell" :size="16" />
    </button>
  </header>
</template>
