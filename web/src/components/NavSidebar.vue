<script setup lang="ts">
import { useRouter } from "vue-router";
import { clearToken } from "../api";
import { useTheme } from "../composables/useTheme";

const router = useRouter();
const { theme, toggle } = useTheme();

const sections = [
  {
    items: [
      { to: "/", label: "Dashboard", icon: "grid" },
      { to: "/chat", label: "Chat", icon: "message" },
    ],
  },
  {
    title: "Arbeit",
    items: [
      { to: "/tasks", label: "Aufgaben", icon: "check" },
      { to: "/termine", label: "Termine", icon: "clock" },
      { to: "/calendar", label: "Kalender", icon: "calendar" },
      { to: "/projects", label: "Projekte", icon: "folder" },
    ],
  },
  {
    title: "Inhalte",
    items: [
      { to: "/notes", label: "Notizen", icon: "file" },
      { to: "/files", label: "Dateien", icon: "archive" },
      { to: "/search", label: "Suche", icon: "search" },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/agents", label: "Agenten", icon: "cpu" },
      { to: "/settings", label: "Einstellungen", icon: "settings" },
    ],
  },
];

function logout() {
  clearToken();
  router.push("/login");
}
</script>

<template>
  <aside
    class="w-60 flex flex-col flex-shrink-0 bg-zinc-950 text-zinc-300 border-r border-white/5"
  >
    <!-- ── Header ─────────────────────────────────────────────── -->
    <div class="px-5 py-4 border-b border-white/5 flex items-center gap-2.5">
      <div class="w-7 h-7 rounded-md bg-white/10 flex items-center justify-center text-white text-[13px] font-semibold">B</div>
      <div class="leading-tight">
        <h1 class="text-sm font-semibold text-white">Bau-OS</h1>
        <p class="text-[10px] text-zinc-500">Workspace</p>
      </div>
    </div>

    <!-- ── Navigation ─────────────────────────────────────────── -->
    <nav class="flex-1 px-2 py-3 overflow-y-auto">
      <div v-for="(section, si) in sections" :key="si" :class="si > 0 ? 'mt-5' : ''">
        <p
          v-if="section.title"
          class="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
        >{{ section.title }}</p>
        <router-link
          v-for="link in section.items"
          :key="link.to"
          :to="link.to"
          class="group flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-zinc-400 hover:text-white hover:bg-white/5 transition"
          active-class="!text-white !bg-white/10"
        >
          <!-- Icons -->
          <svg v-if="link.icon === 'grid'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <svg v-else-if="link.icon === 'message'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <svg v-else-if="link.icon === 'check'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <svg v-else-if="link.icon === 'clock'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <svg v-else-if="link.icon === 'calendar'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <svg v-else-if="link.icon === 'folder'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <svg v-else-if="link.icon === 'file'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
          <svg v-else-if="link.icon === 'archive'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>
          <svg v-else-if="link.icon === 'search'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <svg v-else-if="link.icon === 'cpu'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
          <svg v-else-if="link.icon === 'settings'" class="w-4 h-4 flex-shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          {{ link.label }}
        </router-link>
      </div>
    </nav>

    <!-- ── Footer: Theme-Toggle + Abmelden ────────────────────── -->
    <div class="px-2 py-2 border-t border-white/5 flex items-center gap-1">
      <button
        @click="toggle"
        :title="theme === 'dark' ? 'Hellen Modus aktivieren' : 'Dunklen Modus aktivieren'"
        class="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition"
      >
        <svg v-if="theme === 'dark'" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        {{ theme === 'dark' ? 'Hell' : 'Dunkel' }}
      </button>

      <div class="flex-1" />

      <button
        @click="logout"
        title="Abmelden"
        class="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      </button>
    </div>
  </aside>
</template>
