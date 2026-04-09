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

const viewingNote = ref<string | null>(null);
const noteContent = ref("");

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
    <div class="flex items-center gap-2 mb-6">
      <button @click="router.push('/projects')" class="text-sm text-gray-400 hover:text-gray-600 transition">Projekte</button>
      <span class="text-gray-300">/</span>
      <h2 class="text-lg font-semibold">{{ projectName }}</h2>
    </div>

    <!-- Stats -->
    <div v-if="info" class="flex gap-6 mb-6 text-sm text-gray-400">
      <span><span class="text-gray-900 font-medium">{{ info.notes }}</span> Notizen</span>
      <span><span class="text-gray-900 font-medium">{{ info.openTasks }}</span> Aufgaben</span>
      <span><span class="text-gray-900 font-medium">{{ info.termine }}</span> Termine</span>
    </div>

    <!-- Tabs -->
    <div class="flex gap-4 mb-6 border-b border-gray-200">
      <button
        v-for="t in (['notes', 'tasks', 'termine'] as const)"
        :key="t"
        @click="tab = t; viewingNote = null"
        :class="tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'"
        class="pb-2 text-sm font-medium border-b-2 transition"
      >
        {{ t === 'notes' ? 'Notizen' : t === 'tasks' ? 'Aufgaben' : 'Termine' }}
      </button>
    </div>

    <!-- Notes Tab -->
    <div v-if="tab === 'notes'">
      <div v-if="viewingNote">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-mono text-gray-500">{{ viewingNote }}</span>
          <button @click="viewingNote = null" class="text-sm text-gray-400 hover:text-gray-600 transition">Schliessen</button>
        </div>
        <div class="border border-gray-100 rounded p-5 overflow-auto max-h-[500px]">
          <MarkdownRenderer :content="noteContent" />
        </div>
      </div>
      <div v-else class="divide-y divide-gray-100">
        <button
          v-for="n in notes"
          :key="n"
          @click="openNote(n)"
          class="block w-full text-left py-2.5 text-sm text-gray-700 hover:text-gray-900 transition"
        >
          {{ n }}
        </button>
        <p v-if="notes.length === 0" class="text-gray-400 text-sm py-4">Keine Notizen in diesem Projekt.</p>
      </div>
    </div>

    <!-- Tasks Tab -->
    <div v-if="tab === 'tasks'">
      <div class="flex gap-2 mb-4">
        <input
          v-model="newTask"
          placeholder="Neue Aufgabe..."
          @keyup.enter="addTask"
          class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
        />
        <button @click="addTask" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Hinzufuegen</button>
      </div>
      <div class="divide-y divide-gray-100">
        <div v-for="t in tasks" :key="t" class="flex items-center gap-3 py-2.5">
          <input type="checkbox" @change="completeTask(t)" class="w-4 h-4 rounded border-gray-300" />
          <span class="text-sm text-gray-700">{{ t }}</span>
        </div>
        <p v-if="tasks.length === 0" class="text-gray-400 text-sm py-4">Keine offenen Aufgaben.</p>
      </div>
    </div>

    <!-- Termine Tab -->
    <div v-if="tab === 'termine'">
      <div class="flex gap-2 mb-4">
        <input v-model="newDatum" placeholder="TT.MM.JJJJ" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-32" />
        <input v-model="newUhrzeit" placeholder="HH:MM" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-24" />
        <input v-model="newTerminText" placeholder="Beschreibung..." @keyup.enter="addTermin" class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
        <button @click="addTermin" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Erstellen</button>
      </div>
      <div class="divide-y divide-gray-100">
        <div v-for="t in termine" :key="t" class="flex items-center justify-between py-2.5">
          <span class="text-sm text-gray-700">{{ t }}</span>
          <button @click="removeTermin(t)" class="text-xs text-gray-400 hover:text-red-500 transition">Loeschen</button>
        </div>
        <p v-if="termine.length === 0" class="text-gray-400 text-sm py-4">Keine Termine.</p>
      </div>
    </div>
  </div>
</template>
