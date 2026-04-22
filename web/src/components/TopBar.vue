<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSidebar } from "../composables/useSidebar";
import BIcon from "./BIcon.vue";

const route = useRoute();
const router = useRouter();
const { toggle: toggleSidebar } = useSidebar();

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
    <!-- Hamburger (nur auf Mobile sichtbar) -->
    <button
      type="button"
      class="topbar-hamburger"
      @click="toggleSidebar"
      aria-label="Menu oeffnen"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>

    <!-- Breadcrumb -->
    <nav class="flex items-center gap-1.5 flex-1 min-w-0" style="font-size: 12px">
      <span style="color: var(--color-text); font-weight: 500">{{ current }}</span>
    </nav>

    <!-- Search button -->
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

<!-- Unscoped, damit Media-Query zuverlaessig greift. -->
<style>
.topbar-hamburger {
  display: none;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.topbar-hamburger:hover {
  color: var(--color-text);
  background: var(--color-border-subtle);
}
@media (max-width: 1023.98px) {
  .topbar-hamburger {
    display: inline-flex;
  }
}
</style>
