<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

interface ProjectInfo {
  name: string;
  notes: number;
  openTasks: number;
  termine: number;
}

const route = useRoute();
const router = useRouter();
const projectName = ref("");
const info = ref<ProjectInfo | null>(null);
const notes = ref<string[]>([]);
const tasks = ref<string[]>([]);
const termine = ref<string[]>([]);

// Note viewer
const viewingNote = ref<string | null>(null);
const noteContent = ref("");

// New task/termin
const newTask = ref("");
const newDatum = ref("");
const newUhrzeit = ref("");
const newTerminText = ref("");

const tab = ref<"notes" | "tasks" | "termine">("notes");

onMounted(async () => {
  projectName.value = route.params.name as string;
  await loadAll();
});

async function loadAll() {
  const n = encodeURIComponent(projectName.value);
  const [i, no, ta, te] = await Promise.all([
    api.get<ProjectInfo>(`/projects/${n}`),
    api.get<string[]>(`/projects/${n}/notes`),
    api.get<string[]>(`/projects/${n}/tasks`),
    api.get<string[]>(`/projects/${n}/termine`),
  ]);
  info.value = i;
  notes.value = no;
  tasks.value = ta;
  termine.value = te;
}

async function openNote(name: string) {
  const n = encodeURIComponent(projectName.value);
  const note = await api.get<{ name: string; content: string }>(`/projects/${n}/notes/${encodeURIComponent(name)}`);
  viewingNote.value = name;
  noteContent.value = note.content;
}

async function addTask() {
  if (!newTask.value.trim()) return;
  const n = encodeURIComponent(projectName.value);
  await api.post(`/projects/${n}/tasks`, { text: newTask.value });
  newTask.value = "";
  tasks.value = await api.get<string[]>(`/projects/${n}/tasks`);
}

async function completeTask(text: string) {
  const n = encodeURIComponent(projectName.value);
  await api.patch(`/projects/${n}/tasks`, { text });
  tasks.value = await api.get<string[]>(`/projects/${n}/tasks`);
}

async function addTermin() {
  if (!newDatum.value || !newTerminText.value) return;
  const n = encodeURIComponent(projectName.value);
  await api.post(`/projects/${n}/termine`, {
    datum: newDatum.value,
    text: newTerminText.value,
    uhrzeit: newUhrzeit.value || undefined,
  });
  newDatum.value = "";
  newUhrzeit.value = "";
  newTerminText.value = "";
  termine.value = await api.get<string[]>(`/projects/${n}/termine`);
}

async function removeTermin(text: string) {
  const n = encodeURIComponent(projectName.value);
  await api.delete(`/projects/${n}/termine`, { text });
  termine.value = await api.get<string[]>(`/projects/${n}/termine`);
}
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-4">
      <button @click="router.push('/projects')" class="text-sm text-blue-600 hover:underline">Projekte</button>
      <span class="text-gray-400">/</span>
      <h2 class="text-xl font-bold">{{ projectName }}</h2>
    </div>

    <!-- Stats -->
    <div v-if="info" class="grid grid-cols-3 gap-4 mb-6">
      <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
        <p class="text-2xl font-bold text-blue-600">{{ info.notes }}</p>
        <p class="text-sm text-gray-500">Notizen</p>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
        <p class="text-2xl font-bold text-amber-600">{{ info.openTasks }}</p>
        <p class="text-sm text-gray-500">Offene Aufgaben</p>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm border text-center">
        <p class="text-2xl font-bold text-green-600">{{ info.termine }}</p>
        <p class="text-sm text-gray-500">Termine</p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
      <button
        v-for="t in (['notes', 'tasks', 'termine'] as const)"
        :key="t"
        @click="tab = t; viewingNote = null"
        :class="tab === t ? 'bg-white shadow-sm font-medium' : 'text-gray-500'"
        class="px-4 py-2 text-sm rounded-md transition"
      >
        {{ t === 'notes' ? 'Notizen' : t === 'tasks' ? 'Aufgaben' : 'Termine' }}
      </button>
    </div>

    <!-- Notes Tab -->
    <div v-if="tab === 'notes'">
      <div v-if="viewingNote" class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <span class="font-mono text-sm font-medium">{{ viewingNote }}</span>
          <button @click="viewingNote = null" class="text-sm text-blue-600 hover:underline">Schliessen</button>
        </div>
        <div class="bg-white p-6 rounded-xl border overflow-auto max-h-[500px]">
          <MarkdownRenderer :content="noteContent" />
        </div>
      </div>
      <div v-else class="space-y-1">
        <button
          v-for="n in notes"
          :key="n"
          @click="openNote(n)"
          class="bg-white p-3 rounded-lg border w-full text-left text-sm hover:bg-gray-50 font-mono"
        >
          {{ n }}
        </button>
        <p v-if="notes.length === 0" class="text-gray-500 text-sm">Keine Notizen in diesem Projekt.</p>
      </div>
    </div>

    <!-- Tasks Tab -->
    <div v-if="tab === 'tasks'">
      <div class="flex gap-2 mb-4">
        <input
          v-model="newTask"
          placeholder="Neue Aufgabe..."
          @keyup.enter="addTask"
          class="flex-1 px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <button @click="addTask" class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">Hinzufuegen</button>
      </div>
      <div class="space-y-1">
        <div v-for="t in tasks" :key="t" class="bg-white p-3 rounded-lg border flex items-center gap-3">
          <input type="checkbox" @change="completeTask(t)" class="w-4 h-4 rounded" />
          <span class="text-sm">{{ t }}</span>
        </div>
        <p v-if="tasks.length === 0" class="text-gray-500 text-sm">Keine offenen Aufgaben.</p>
      </div>
    </div>

    <!-- Termine Tab -->
    <div v-if="tab === 'termine'">
      <div class="flex gap-2 mb-4">
        <input v-model="newDatum" placeholder="TT.MM.JJJJ" class="px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm w-36" />
        <input v-model="newUhrzeit" placeholder="HH:MM" class="px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm w-28" />
        <input v-model="newTerminText" placeholder="Beschreibung..." @keyup.enter="addTermin" class="flex-1 px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm" />
        <button @click="addTermin" class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">Erstellen</button>
      </div>
      <div class="space-y-1">
        <div v-for="t in termine" :key="t" class="bg-white p-3 rounded-lg border flex items-center justify-between">
          <span class="text-sm">{{ t }}</span>
          <button @click="removeTermin(t)" class="text-xs text-red-500 hover:text-red-700">Loeschen</button>
        </div>
        <p v-if="termine.length === 0" class="text-gray-500 text-sm">Keine Termine.</p>
      </div>
    </div>
  </div>
</template>
