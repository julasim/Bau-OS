<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";

interface NoteSummary {
  title: string;
  project: string | null;
  createdAt: string;
  updatedAt: string;
  size: number;
}

const router = useRouter();
const notes = ref<NoteSummary[]>([]);
const newContent = ref("");
const searchQuery = ref("");
const showCreate = ref(false);
const viewMode = ref<"list" | "grid">("list");
const sortBy = ref<"updatedAt" | "title" | "size">("updatedAt");
const sortAsc = ref(false);

const filtered = computed(() => {
  let result = notes.value;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter((n) => n.title.toLowerCase().includes(q) || n.project?.toLowerCase().includes(q));
  }
  return result.sort((a, b) => {
    let cmp = 0;
    if (sortBy.value === "title") cmp = a.title.localeCompare(b.title);
    else if (sortBy.value === "updatedAt") cmp = a.updatedAt.localeCompare(b.updatedAt);
    else if (sortBy.value === "size") cmp = a.size - b.size;
    return sortAsc.value ? cmp : -cmp;
  });
});

async function load() {
  try {
    notes.value = await api.get<NoteSummary[]>("/notes?detailed=1");
  } catch {
    // Fallback: alte API gibt nur strings zurueck
    const names = await api.get<string[]>("/notes");
    notes.value = names.map((n) => ({ title: n, project: null, createdAt: "", updatedAt: "", size: 0 }));
  }
}

async function create() {
  if (!newContent.value.trim()) return;
  await api.post("/notes", { content: newContent.value });
  newContent.value = "";
  showCreate.value = false;
  await load();
}

async function remove(name: string) {
  if (!confirm(`Notiz "${name}" wirklich loeschen?`)) return;
  await api.delete(`/notes/${encodeURIComponent(name)}`);
  await load();
}

function formatDate(iso: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number) {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function relativeTime(iso: string) {
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

function toggleSort(col: typeof sortBy.value) {
  if (sortBy.value === col) sortAsc.value = !sortAsc.value;
  else { sortBy.value = col; sortAsc.value = col === "title"; }
}

function sortIcon(col: string) {
  if (sortBy.value !== col) return "";
  return sortAsc.value ? "\u25B2" : "\u25BC";
}

onMounted(load);
useEvents(["note"], () => load());
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-xl font-semibold">Notizen</h2>
      <div class="flex items-center gap-2">
        <button @click="viewMode = viewMode === 'list' ? 'grid' : 'list'" class="p-1.5 rounded hover:bg-gray-100 transition" title="Ansicht wechseln">
          <svg v-if="viewMode === 'list'" class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <svg v-else class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        </button>
        <button
          @click="showCreate = !showCreate"
          class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition"
        >{{ showCreate ? "Abbrechen" : "Neue Notiz" }}</button>
      </div>
    </div>

    <!-- Create -->
    <div v-if="showCreate" class="mb-6 border border-gray-200 rounded-lg p-4">
      <textarea v-model="newContent" placeholder="Markdown-Inhalt..." rows="5" class="w-full px-3 py-2 border border-gray-200 rounded text-sm font-mono outline-none focus:ring-1 focus:ring-gray-400 resize-y mb-3"></textarea>
      <button @click="create" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Speichern</button>
    </div>

    <!-- Search + Count -->
    <div class="flex items-center gap-3 mb-4">
      <input v-model="searchQuery" placeholder="Notizen filtern..." class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      <span class="text-xs text-gray-400 flex-shrink-0">{{ filtered.length }} von {{ notes.length }}</span>
    </div>

    <!-- Grid View -->
    <div v-if="viewMode === 'grid'" class="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div
        v-for="note in filtered"
        :key="note.title"
        @click="router.push(`/notes/${encodeURIComponent(note.title)}`)"
        class="border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-gray-300 transition group"
      >
        <div class="flex items-start justify-between mb-2">
          <svg class="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
          <button @click.stop="remove(note.title)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <p class="text-sm font-medium text-gray-700 truncate mb-1">{{ note.title }}</p>
        <div class="flex items-center gap-2 text-[11px] text-gray-400">
          <span v-if="note.project" class="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">{{ note.project }}</span>
          <span>{{ relativeTime(note.updatedAt) }}</span>
          <span>{{ formatSize(note.size) }}</span>
        </div>
      </div>
      <p v-if="filtered.length === 0" class="col-span-full text-gray-400 text-sm py-6 text-center">
        {{ searchQuery ? "Keine Treffer." : "Keine Notizen vorhanden." }}
      </p>
    </div>

    <!-- List View -->
    <div v-else>
      <!-- Column Headers -->
      <div class="flex items-center gap-3 px-3 py-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
        <button @click="toggleSort('title')" class="flex-1 text-left hover:text-gray-600 transition">Name {{ sortIcon("title") }}</button>
        <span class="w-24 text-left">Projekt</span>
        <button @click="toggleSort('size')" class="w-16 text-right hover:text-gray-600 transition">Groesse {{ sortIcon("size") }}</button>
        <button @click="toggleSort('updatedAt')" class="w-36 text-right hover:text-gray-600 transition">Geaendert {{ sortIcon("updatedAt") }}</button>
        <span class="w-6"></span>
      </div>

      <div
        v-for="note in filtered"
        :key="note.title"
        class="flex items-center gap-3 px-3 py-2.5 rounded hover:bg-gray-50 cursor-pointer transition group"
        @click="router.push(`/notes/${encodeURIComponent(note.title)}`)"
      >
        <svg class="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
        <span class="flex-1 text-sm text-gray-700 truncate">{{ note.title }}</span>
        <span class="w-24 text-[11px] text-gray-400 truncate">
          <span v-if="note.project" class="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">{{ note.project }}</span>
        </span>
        <span class="w-16 text-[11px] text-gray-400 text-right font-mono">{{ formatSize(note.size) }}</span>
        <span class="w-36 text-[11px] text-gray-400 text-right">{{ formatDate(note.updatedAt) }}</span>
        <button @click.stop="remove(note.title)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <p v-if="filtered.length === 0" class="text-gray-400 text-sm py-6 text-center">
        {{ searchQuery ? "Keine Treffer." : "Keine Notizen vorhanden." }}
      </p>
    </div>
  </div>
</template>
