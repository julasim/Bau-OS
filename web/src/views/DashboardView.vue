<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";

interface DashboardData {
  notes: number;
  openTasks: number;
  totalTasks: number;
  todayTermine: string[];
  termine: number;
  projects: number;
  agents: string[];
}

interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  assignee: string | null;
  date: string | null;
}

interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
}

interface DbStatus {
  enabled: boolean;
  mode?: string;
  healthy?: boolean;
  pgvector?: boolean;
}

const router = useRouter();
const data = ref<DashboardData | null>(null);
const tasks = ref<Task[]>([]);
const termine = ref<Termin[]>([]);
const dbStatus = ref<DbStatus | null>(null);
const newTaskText = ref("");

const today = new Date().toISOString().slice(0, 10);
const todayDE = new Date().toLocaleDateString("de-AT", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const openTasks = computed(() => tasks.value.filter((t) => t.status !== "done").slice(0, 8));
const todayTermine = computed(() =>
  termine.value.filter((t) => {
    // Match both ISO (2026-04-11) and German (11.04.2026) formats
    if (t.datum === today) return true;
    const parts = t.datum.split(".");
    if (parts.length === 3) {
      const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
      return iso === today;
    }
    return false;
  }),
);
const upcomingTermine = computed(() =>
  termine.value
    .filter((t) => {
      const d = t.datum.includes(".") ? t.datum.split(".").reverse().join("-") : t.datum;
      return d >= today;
    })
    .slice(0, 6),
);

async function load() {
  const [d, t, te, db] = await Promise.all([
    api.get<DashboardData>("/dashboard"),
    api.get<Task[]>("/tasks"),
    api.get<Termin[]>("/termine"),
    api.get<DbStatus>("/dashboard/db-status").catch(() => null),
  ]);
  data.value = d;
  tasks.value = t;
  termine.value = te;
  dbStatus.value = db;
}

async function addTask() {
  if (!newTaskText.value.trim()) return;
  await api.post("/tasks", { text: newTaskText.value });
  newTaskText.value = "";
  await load();
}

async function toggleTask(task: Task) {
  const next = task.status === "done" ? "open" : "done";
  await api.put(`/tasks/${task.id}`, { status: next });
  await load();
}

function formatDate(d: string) {
  if (d.includes(".")) return d;
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

onMounted(load);
useEvents(["task", "termin", "note", "project"], () => load());
</script>

<template>
  <div>
    <!-- Header -->
    <div class="mb-8">
      <h2 class="text-xl font-semibold text-gray-900">Dashboard</h2>
      <p class="text-sm text-gray-400 mt-0.5">{{ todayDE }}</p>
    </div>

    <!-- Stats -->
    <div v-if="data" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <router-link to="/tasks" class="border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 transition">
        <p class="text-2xl font-semibold text-gray-900">{{ data.openTasks }}</p>
        <p class="text-xs text-gray-400 mt-0.5">Offene Aufgaben</p>
      </router-link>
      <router-link to="/termine" class="border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 transition">
        <p class="text-2xl font-semibold text-gray-900">{{ data.termine }}</p>
        <p class="text-xs text-gray-400 mt-0.5">Termine</p>
      </router-link>
      <router-link to="/notes" class="border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 transition">
        <p class="text-2xl font-semibold text-gray-900">{{ data.notes }}</p>
        <p class="text-xs text-gray-400 mt-0.5">Notizen</p>
      </router-link>
      <router-link to="/projects" class="border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 transition">
        <p class="text-2xl font-semibold text-gray-900">{{ data.projects }}</p>
        <p class="text-xs text-gray-400 mt-0.5">Projekte</p>
      </router-link>
    </div>

    <!-- Two-Column Layout -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Left: Aufgaben -->
      <div>
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-gray-900">Offene Aufgaben</h3>
          <router-link to="/tasks" class="text-xs text-gray-400 hover:text-gray-600 transition">Alle anzeigen</router-link>
        </div>

        <!-- Quick-Add -->
        <div class="flex gap-2 mb-3">
          <input
            v-model="newTaskText"
            placeholder="Neue Aufgabe..."
            @keyup.enter="addTask"
            class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
          />
          <button @click="addTask" class="px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">+</button>
        </div>

        <div class="divide-y divide-gray-100">
          <div v-for="task in openTasks" :key="task.id" class="flex items-center gap-3 py-2">
            <button
              @click="toggleTask(task)"
              :class="task.status === 'in_progress' ? 'bg-amber-500 border-amber-500' : 'border-gray-300'"
              class="w-4 h-4 rounded border flex-shrink-0 transition hover:border-green-400"
            ></button>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-gray-700 truncate">{{ task.text }}</p>
              <div class="flex gap-2 text-[11px] text-gray-400">
                <span v-if="task.assignee">{{ task.assignee }}</span>
                <span v-if="task.date">{{ formatDate(task.date) }}</span>
              </div>
            </div>
          </div>
          <p v-if="openTasks.length === 0" class="text-gray-400 text-sm py-3">Keine offenen Aufgaben.</p>
        </div>
      </div>

      <!-- Right: Termine -->
      <div>
        <!-- Heute -->
        <div class="mb-6">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-900">Heute</h3>
            <router-link to="/calendar" class="text-xs text-gray-400 hover:text-gray-600 transition">Kalender</router-link>
          </div>
          <div v-if="todayTermine.length > 0" class="space-y-2">
            <div v-for="t in todayTermine" :key="t.id" class="flex items-start gap-3 py-1.5">
              <span class="w-1 h-1 rounded-full bg-gray-900 mt-2 flex-shrink-0"></span>
              <div>
                <p class="text-sm text-gray-700">{{ t.text }}</p>
                <div class="flex gap-2 text-[11px] text-gray-400">
                  <span v-if="t.uhrzeit">{{ t.uhrzeit }}{{ t.endzeit ? ` – ${t.endzeit}` : '' }}</span>
                  <span v-if="t.location">{{ t.location }}</span>
                </div>
              </div>
            </div>
          </div>
          <p v-else class="text-gray-400 text-sm py-1">Keine Termine heute.</p>
        </div>

        <!-- Naechste Termine -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-gray-900">Naechste Termine</h3>
            <router-link to="/termine" class="text-xs text-gray-400 hover:text-gray-600 transition">Alle anzeigen</router-link>
          </div>
          <div class="divide-y divide-gray-100">
            <div v-for="t in upcomingTermine" :key="t.id" class="flex items-start gap-3 py-2">
              <span class="text-[11px] text-gray-400 font-mono w-16 flex-shrink-0 pt-0.5">{{ formatDate(t.datum) }}</span>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-gray-700 truncate">{{ t.text }}</p>
                <div class="flex gap-2 text-[11px] text-gray-400">
                  <span v-if="t.uhrzeit">{{ t.uhrzeit }}</span>
                  <span v-if="t.location">{{ t.location }}</span>
                </div>
              </div>
            </div>
            <p v-if="upcomingTermine.length === 0" class="text-gray-400 text-sm py-3">Keine anstehenden Termine.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- System Footer -->
    <div v-if="dbStatus || data" class="mt-8 pt-6 border-t border-gray-100">
      <div class="flex flex-wrap gap-6 text-xs text-gray-400">
        <div v-if="dbStatus" class="flex items-center gap-1.5">
          <span :class="dbStatus.enabled && dbStatus.healthy ? 'bg-green-400' : dbStatus.enabled ? 'bg-red-400' : 'bg-gray-300'" class="w-1.5 h-1.5 rounded-full"></span>
          {{ dbStatus.mode === 'database' ? 'PostgreSQL' : 'Filesystem' }}
        </div>
        <div v-if="data" class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
          {{ data.agents.length }} Agent{{ data.agents.length !== 1 ? 'en' : '' }}
        </div>
        <div v-if="data">{{ data.totalTasks }} Aufgaben gesamt</div>
      </div>
    </div>
  </div>
</template>
