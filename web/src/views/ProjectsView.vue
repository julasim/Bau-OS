<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

interface ProjectInfo {
  name: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  notes: number;
  openTasks: number;
  termine: number;
  createdAt?: string;
  updatedAt?: string;
}

const router = useRouter();
const projects = ref<ProjectInfo[]>([]);
const searchQuery = ref("");
const viewMode = ref<"grid" | "list">("grid");

const filtered = computed(() => {
  if (!searchQuery.value) return projects.value;
  const q = searchQuery.value.toLowerCase();
  return projects.value.filter((p) => p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q));
});

function formatDate(iso?: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function relativeTime(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vor ${hrs} Std`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `vor ${days} Tagen`;
  return formatDate(iso);
}

function statusLabel(s?: string) {
  if (!s) return "";
  const map: Record<string, string> = { aktiv: "Aktiv", archiviert: "Archiviert", pausiert: "Pausiert" };
  return map[s] || s;
}

function statusColor(s?: string) {
  const map: Record<string, string> = { aktiv: "bg-green-50 text-green-700", archiviert: "bg-gray-100 text-gray-500", pausiert: "bg-amber-50 text-amber-700" };
  return map[s || ""] || "bg-gray-100 text-gray-500";
}

function totalItems(p: ProjectInfo) {
  return p.notes + p.openTasks + p.termine;
}

onMounted(async () => {
  projects.value = await api.get<ProjectInfo[]>("/projects");
});
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-xl font-semibold">Projekte</h2>
      <button @click="viewMode = viewMode === 'grid' ? 'list' : 'grid'" class="p-1.5 rounded hover:bg-gray-100 transition" title="Ansicht wechseln">
        <svg v-if="viewMode === 'grid'" class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        <svg v-else class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </button>
    </div>

    <!-- Search -->
    <div class="flex items-center gap-3 mb-4" v-if="projects.length > 3">
      <input v-model="searchQuery" placeholder="Projekte filtern..." class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      <span class="text-xs text-gray-400 flex-shrink-0">{{ filtered.length }} von {{ projects.length }}</span>
    </div>

    <!-- Grid View -->
    <div v-if="viewMode === 'grid'" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="p in filtered"
        :key="p.name"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
        class="border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-gray-300 transition group"
      >
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            <span class="text-sm font-medium text-gray-900">{{ p.name }}</span>
          </div>
          <span v-if="p.status" :class="statusColor(p.status)" class="px-1.5 py-0.5 text-[10px] rounded font-medium">{{ statusLabel(p.status) }}</span>
        </div>
        <p v-if="p.description" class="text-xs text-gray-400 mb-3 line-clamp-2">{{ p.description }}</p>
        <div class="flex gap-4 text-xs text-gray-400 mb-2">
          <span>{{ p.notes }} Notizen</span>
          <span :class="p.openTasks > 0 ? 'text-amber-600' : ''">{{ p.openTasks }} Aufgaben</span>
          <span>{{ p.termine }} Termine</span>
        </div>
        <div class="flex items-center justify-between text-[11px] text-gray-300 pt-2 border-t border-gray-50">
          <span v-if="p.createdAt">Erstellt {{ formatDate(p.createdAt) }}</span>
          <span v-if="p.updatedAt">{{ relativeTime(p.updatedAt) }}</span>
        </div>
      </div>
    </div>

    <!-- List View -->
    <div v-else>
      <div class="flex items-center gap-3 px-3 py-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
        <span class="flex-1 text-left">Projekt</span>
        <span class="w-16 text-left">Status</span>
        <span class="w-16 text-center">Notizen</span>
        <span class="w-16 text-center">Aufgaben</span>
        <span class="w-16 text-center">Termine</span>
        <span class="w-28 text-right">Erstellt</span>
        <span class="w-28 text-right">Geaendert</span>
      </div>
      <div
        v-for="p in filtered"
        :key="p.name"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
        class="flex items-center gap-3 px-3 py-2.5 rounded hover:bg-gray-50 cursor-pointer transition group"
      >
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <svg class="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span class="text-sm text-gray-700 truncate">{{ p.name }}</span>
        </div>
        <span class="w-16 flex-shrink-0">
          <span v-if="p.status" :class="statusColor(p.status)" class="px-1.5 py-0.5 text-[10px] rounded font-medium">{{ statusLabel(p.status) }}</span>
        </span>
        <span class="w-16 text-[11px] text-gray-400 text-center flex-shrink-0">{{ p.notes }}</span>
        <span class="w-16 text-[11px] text-center flex-shrink-0" :class="p.openTasks > 0 ? 'text-amber-600' : 'text-gray-400'">{{ p.openTasks }}</span>
        <span class="w-16 text-[11px] text-gray-400 text-center flex-shrink-0">{{ p.termine }}</span>
        <span class="w-28 text-[11px] text-gray-400 text-right flex-shrink-0">{{ formatDate(p.createdAt) }}</span>
        <span class="w-28 text-[11px] text-gray-400 text-right flex-shrink-0">{{ formatDate(p.updatedAt) }}</span>
      </div>
    </div>

    <p v-if="filtered.length === 0" class="text-gray-400 text-sm py-6 text-center">
      {{ searchQuery ? "Keine Treffer." : "Keine Projekte vorhanden." }}
    </p>
  </div>
</template>
