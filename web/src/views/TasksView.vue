<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";

interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  assignee: string | null;
  date: string | null;
  location: string | null;
  project: string | null;
}

const tasks = ref<Task[]>([]);
const team = ref<string[]>([]);
const editing = ref<Task | null>(null);
const newText = ref("");
const filter = ref<"all" | "open" | "in_progress" | "done">("all");

const filtered = computed(() => {
  if (filter.value === "all") return tasks.value;
  return tasks.value.filter(t => t.status === filter.value);
});

async function load() {
  [tasks.value, team.value] = await Promise.all([
    api.get<Task[]>("/tasks"),
    api.get<string[]>("/team"),
  ]);
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

function cancel() {
  editing.value = null;
}

const statusLabel: Record<string, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};

const statusColor: Record<string, string> = {
  open: "text-gray-500",
  in_progress: "text-amber-600",
  done: "text-green-600",
};

onMounted(load);
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Aufgaben</h2>

    <!-- Neue Aufgabe -->
    <div class="flex gap-2 mb-6">
      <input
        v-model="newText"
        placeholder="Neue Aufgabe..."
        @keyup.enter="create"
        class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
      />
      <button @click="create" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Hinzufuegen</button>
    </div>

    <!-- Filter -->
    <div class="flex gap-3 mb-4 text-sm">
      <button
        v-for="f in (['all', 'open', 'in_progress', 'done'] as const)"
        :key="f"
        @click="filter = f"
        :class="filter === f ? 'text-gray-900 font-medium' : 'text-gray-400'"
        class="hover:text-gray-600 transition"
      >
        {{ f === 'all' ? 'Alle' : statusLabel[f] }}
      </button>
    </div>

    <!-- Edit Modal -->
    <div v-if="editing" class="border border-gray-200 rounded p-5 mb-6 space-y-3">
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
        <button @click="cancel" class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition">Abbrechen</button>
      </div>
    </div>

    <!-- Task List -->
    <div class="divide-y divide-gray-100">
      <div
        v-for="task in filtered"
        :key="task.id"
        class="flex items-start gap-3 py-3 group"
      >
        <!-- Status Toggle -->
        <button
          @click="setStatus(task, task.status === 'done' ? 'open' : task.status === 'open' ? 'in_progress' : 'done')"
          :class="task.status === 'done' ? 'bg-green-500 border-green-500' : task.status === 'in_progress' ? 'bg-amber-500 border-amber-500' : 'border-gray-300'"
          class="mt-0.5 w-4 h-4 rounded border flex-shrink-0 transition"
        ></button>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <p :class="{ 'line-through text-gray-300': task.status === 'done' }" class="text-sm text-gray-700">{{ task.text }}</p>
          <div class="flex gap-3 mt-0.5 text-xs text-gray-400">
            <span v-if="task.assignee">{{ task.assignee }}</span>
            <span v-if="task.date">{{ task.date }}</span>
            <span v-if="task.location">{{ task.location }}</span>
            <span :class="statusColor[task.status]">{{ statusLabel[task.status] }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button @click="edit(task)" class="text-xs text-gray-400 hover:text-gray-600">Bearbeiten</button>
          <button @click="remove(task.id)" class="text-xs text-gray-400 hover:text-red-500">Loeschen</button>
        </div>
      </div>
      <p v-if="filtered.length === 0" class="text-gray-400 text-sm py-4">Keine Aufgaben.</p>
    </div>
  </div>
</template>
