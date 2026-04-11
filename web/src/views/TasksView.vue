<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";

interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  priority?: string;
  assignee: string | null;
  date: string | null;
  location: string | null;
  project: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

const tasks = ref<Task[]>([]);
const team = ref<string[]>([]);
const editing = ref<Task | null>(null);
const newText = ref("");
const filter = ref<"all" | "open" | "in_progress" | "done">("all");
const viewMode = ref<"list" | "grid">("list");
const sortBy = ref<"updatedAt" | "text" | "status">("updatedAt");
const sortAsc = ref(false);

const filtered = computed(() => {
  let result = tasks.value;
  if (filter.value !== "all") result = result.filter((t) => t.status === filter.value);
  return result.sort((a, b) => {
    let cmp = 0;
    if (sortBy.value === "text") cmp = a.text.localeCompare(b.text);
    else if (sortBy.value === "status") cmp = a.status.localeCompare(b.status);
    else if (sortBy.value === "updatedAt") cmp = a.updatedAt.localeCompare(b.updatedAt);
    return sortAsc.value ? cmp : -cmp;
  });
});

const counts = computed(() => ({
  all: tasks.value.length,
  open: tasks.value.filter((t) => t.status === "open").length,
  in_progress: tasks.value.filter((t) => t.status === "in_progress").length,
  done: tasks.value.filter((t) => t.status === "done").length,
}));

async function load() {
  [tasks.value, team.value] = await Promise.all([api.get<Task[]>("/tasks"), api.get<string[]>("/team")]);
}

async function create() {
  if (!newText.value.trim()) return;
  await api.post("/tasks", { text: newText.value });
  newText.value = "";
  await load();
}

async function save(task: Task) {
  await api.put(`/tasks/${task.id}`, {
    text: task.text,
    status: task.status,
    assignee: task.assignee,
    date: task.date,
    location: task.location,
  });
  editing.value = null;
  await load();
}

async function setStatus(task: Task, status: Task["status"]) {
  await api.put(`/tasks/${task.id}`, { status });
  await load();
}

async function remove(id: string) {
  await api.delete(`/tasks/${id}`);
  await load();
}

function edit(task: Task) {
  editing.value = { ...task };
}

const statusLabel: Record<string, string> = { open: "Offen", in_progress: "In Arbeit", done: "Erledigt" };
const statusColor: Record<string, string> = { open: "text-gray-500", in_progress: "text-amber-600", done: "text-green-600" };
const statusDot: Record<string, string> = { open: "border-gray-300", in_progress: "bg-amber-500 border-amber-500", done: "bg-green-500 border-green-500" };
const statusBg: Record<string, string> = { open: "bg-gray-100 text-gray-600", in_progress: "bg-amber-50 text-amber-700", done: "bg-green-50 text-green-700" };

function formatDate(d: string) {
  if (!d) return "–";
  if (d.includes(".")) return d;
  const date = new Date(d);
  return date.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(iso: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
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
  return formatDateTime(iso);
}

function toggleSort(col: typeof sortBy.value) {
  if (sortBy.value === col) sortAsc.value = !sortAsc.value;
  else { sortBy.value = col; sortAsc.value = col === "text"; }
}

function sortIcon(col: string) {
  if (sortBy.value !== col) return "";
  return sortAsc.value ? "\u25B2" : "\u25BC";
}

onMounted(load);
useEvents(["task"], () => load());
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-xl font-semibold">Aufgaben</h2>
      <button @click="viewMode = viewMode === 'list' ? 'grid' : 'list'" class="p-1.5 rounded hover:bg-gray-100 transition" title="Ansicht wechseln">
        <svg v-if="viewMode === 'list'" class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        <svg v-else class="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
      </button>
    </div>

    <!-- Neue Aufgabe -->
    <div class="flex gap-2 mb-6">
      <input
        v-model="newText"
        placeholder="Neue Aufgabe..."
        @keyup.enter="create"
        class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
      />
      <button @click="create" class="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">
        Hinzufuegen
      </button>
    </div>

    <!-- Filter Tabs -->
    <div class="flex gap-1 mb-5 border-b border-gray-100 pb-3">
      <button
        v-for="f in (['all', 'open', 'in_progress', 'done'] as const)"
        :key="f"
        @click="filter = f"
        :class="filter === f ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'"
        class="px-3 py-1 rounded text-sm transition"
      >
        {{ f === "all" ? "Alle" : statusLabel[f] }}
        <span
          :class="filter === f ? 'bg-white/20' : 'bg-gray-200'"
          class="ml-1.5 inline-block px-1.5 py-0 text-[11px] rounded-full"
        >{{ counts[f] }}</span>
      </button>
    </div>

    <!-- Edit Form -->
    <div v-if="editing" class="border border-gray-200 rounded-lg p-5 mb-6 space-y-3">
      <div>
        <label class="block text-xs text-gray-400 mb-1">Beschreibung</label>
        <input v-model="editing.text" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-xs text-gray-400 mb-1">Status</label>
          <select v-model="editing.status" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none">
            <option value="open">Offen</option>
            <option value="in_progress">In Arbeit</option>
            <option value="done">Erledigt</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">Person</label>
          <select v-model="editing.assignee" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none">
            <option :value="null">–</option>
            <option v-for="m in team" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">Datum</label>
          <input v-model="editing.date" type="date" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none" />
        </div>
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">Ort</label>
        <input v-model="editing.location" placeholder="z.B. Baustelle Wien" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      </div>
      <div class="flex gap-2 pt-1">
        <button @click="save(editing!)" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Speichern</button>
        <button @click="editing = null" class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition">Abbrechen</button>
      </div>
    </div>

    <!-- Grid View -->
    <div v-if="viewMode === 'grid'" class="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div
        v-for="task in filtered"
        :key="task.id"
        class="border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-gray-300 transition group"
      >
        <div class="flex items-start justify-between mb-2">
          <button
            @click="setStatus(task, task.status === 'done' ? 'open' : task.status === 'open' ? 'in_progress' : 'done')"
            :class="statusDot[task.status]"
            class="mt-0.5 w-4 h-4 rounded border flex-shrink-0 transition hover:border-green-400"
          ></button>
          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
            <button @click="edit(task)" class="text-gray-300 hover:text-gray-600 transition">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button @click="remove(task.id)" class="text-gray-300 hover:text-red-500 transition">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <p :class="{ 'line-through text-gray-300': task.status === 'done' }" class="text-sm font-medium text-gray-700 mb-2">{{ task.text }}</p>
        <div class="flex flex-wrap gap-1.5 mb-2">
          <span :class="statusBg[task.status]" class="px-1.5 py-0.5 text-[10px] rounded font-medium">{{ statusLabel[task.status] }}</span>
          <span v-if="task.project" class="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-500">{{ task.project }}</span>
          <span v-if="task.priority" class="px-1.5 py-0.5 bg-red-50 rounded text-[10px] text-red-600">{{ task.priority }}</span>
        </div>
        <div class="space-y-0.5 text-[11px] text-gray-400">
          <div v-if="task.assignee" class="flex items-center gap-1">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            {{ task.assignee }}
          </div>
          <div v-if="task.date" class="flex items-center gap-1">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            {{ formatDate(task.date) }}
          </div>
          <div v-if="task.location" class="flex items-center gap-1">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {{ task.location }}
          </div>
          <div class="pt-1 text-gray-300">{{ relativeTime(task.updatedAt) }}</div>
        </div>
      </div>
      <p v-if="filtered.length === 0" class="col-span-full text-gray-400 text-sm py-6 text-center">
        Keine Aufgaben in dieser Ansicht.
      </p>
    </div>

    <!-- List View -->
    <div v-else>
      <!-- Column Headers -->
      <div class="flex items-center gap-3 px-3 py-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
        <span class="w-4"></span>
        <button @click="toggleSort('text')" class="flex-1 text-left hover:text-gray-600 transition">Aufgabe {{ sortIcon("text") }}</button>
        <button @click="toggleSort('status')" class="w-20 text-left hover:text-gray-600 transition">Status {{ sortIcon("status") }}</button>
        <span class="w-20 text-left">Person</span>
        <span class="w-20 text-left">Projekt</span>
        <button @click="toggleSort('updatedAt')" class="w-32 text-right hover:text-gray-600 transition">Geaendert {{ sortIcon("updatedAt") }}</button>
        <span class="w-14"></span>
      </div>

      <div class="divide-y divide-gray-100">
        <div v-for="task in filtered" :key="task.id" class="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition group">
          <button
            @click="setStatus(task, task.status === 'done' ? 'open' : task.status === 'open' ? 'in_progress' : 'done')"
            :class="statusDot[task.status]"
            class="w-4 h-4 rounded border flex-shrink-0 transition hover:border-green-400"
          ></button>
          <div class="flex-1 min-w-0">
            <p :class="{ 'line-through text-gray-300': task.status === 'done' }" class="text-sm text-gray-700 truncate">{{ task.text }}</p>
            <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-gray-400">
              <span v-if="task.date">{{ formatDate(task.date) }}</span>
              <span v-if="task.location">{{ task.location }}</span>
            </div>
          </div>
          <span :class="statusBg[task.status]" class="w-20 text-center px-1.5 py-0.5 text-[10px] rounded font-medium flex-shrink-0">{{ statusLabel[task.status] }}</span>
          <span class="w-20 text-[11px] text-gray-400 truncate flex-shrink-0">{{ task.assignee || "–" }}</span>
          <span class="w-20 text-[11px] text-gray-400 truncate flex-shrink-0">
            <span v-if="task.project" class="px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">{{ task.project }}</span>
            <span v-else>–</span>
          </span>
          <span class="w-32 text-[11px] text-gray-400 text-right flex-shrink-0">{{ formatDateTime(task.updatedAt) }}</span>
          <div class="w-14 flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition flex-shrink-0">
            <button @click="edit(task)" class="text-xs text-gray-400 hover:text-gray-600">Bearbeiten</button>
            <button @click="remove(task.id)" class="text-xs text-gray-400 hover:text-red-500">Loeschen</button>
          </div>
        </div>
      </div>
      <p v-if="filtered.length === 0" class="text-gray-400 text-sm py-6 text-center">Keine Aufgaben in dieser Ansicht.</p>
    </div>
  </div>
</template>
