<script setup lang="ts">
import { useRouter } from "vue-router";
import { clearToken } from "../api";

const router = useRouter();

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
    ],
  },
];

function logout() {
  clearToken();
  router.push("/login");
}
</script>

<template>
  <aside class="w-56 border-r border-gray-200 flex flex-col bg-white flex-shrink-0">
    <div class="px-5 py-4 border-b border-gray-200">
      <h1 class="text-base font-semibold text-gray-900">Bau-OS</h1>
      <p class="text-[11px] text-gray-400 mt-0.5">Workspace</p>
    </div>

    <nav class="flex-1 px-3 py-2 overflow-y-auto">
      <div v-for="(section, si) in sections" :key="si" :class="si > 0 ? 'mt-4' : ''">
        <p v-if="section.title" class="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{{ section.title }}</p>
        <router-link
          v-for="link in section.items"
          :key="link.to"
          :to="link.to"
          class="flex items-center gap-2.5 px-3 py-1.5 rounded text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition"
          active-class="!text-gray-900 !font-medium !bg-gray-100"
        >
          <!-- Icons -->
          <svg v-if="link.icon === 'grid'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <svg v-else-if="link.icon === 'message'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <svg v-else-if="link.icon === 'check'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          <svg v-else-if="link.icon === 'clock'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          <svg v-else-if="link.icon === 'calendar'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <svg v-else-if="link.icon === 'folder'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <svg v-else-if="link.icon === 'file'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
          <svg v-else-if="link.icon === 'archive'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>
          <svg v-else-if="link.icon === 'search'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <svg v-else-if="link.icon === 'cpu'" class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
          {{ link.label }}
        </router-link>
      </div>
    </nav>

    <div class="px-3 py-3 border-t border-gray-200">
      <button
        @click="logout"
        class="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 rounded transition text-left"
      >
        <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        Abmelden
      </button>
    </div>
  </aside>
</template>
