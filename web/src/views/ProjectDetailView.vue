<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";

interface ProjectInfo { name: string; notes: number; openTasks: number; termine: number; }
interface Task { id: string; text: string; status: string; assignee: string | null; date: string | null; }
interface Termin { id: string; text: string; datum: string; uhrzeit: string | null; location: string | null; assignees: string[]; }

const route = useRoute();
const router = useRouter();
const projectName = ref("");
const info = ref<ProjectInfo | null>(null);
const notes = ref<string[]>([]);
const tasks = ref<Task[]>([]);
const termine = ref<Termin[]>([]);

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
    api.get<Task[]>(`/projects/${n}/tasks`),
    api.get<Termin[]>(`/projects/${n}/termine`),
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
  await loadAll();
}

async function completeTask(task: Task) {
  const n = encodeURIComponent(projectName.value);
  await api.patch(`/projects/${n}/tasks`, { text: task.text });
  await loadAll();
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
  await loadAll();
}

async function removeTermin(t: Termin) {
  const n = encodeURIComponent(projectName.value);
  await api.delete(`/projects/${n}/termine`, { text: t.text });
  await loadAll();
}
</script>

<template>
  <div>
    <div class="flex items-center gap-2 mb-6">
      <button @click="router.push('/projects')" class="text-sm text-gray-400 hover:text-gray-600 transition">Projekte</button>
      <span class="text-gray-300">/</span>
      <h2 class="text-lg font-semibold">{{ projectName }}</h2>
    </div>

    <div v-if="info" class="flex gap-6 mb-6 text-sm text-gray-400">
      <span><span class="text-gray-900 font-medium">{{ info.notes }}</span> Notizen</span>
      <span><span class="text-gray-900 font-medium">{{ info.openTasks }}</span> Aufgaben</span>
      <span><span class="text-gray-900 font-medium">{{ info.termine }}</span> Termine</span>
    </div>

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

    <!-- Notes -->
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
        <button v-for="n in notes" :key="n" @click="openNote(n)" class="block w-full text-left py-2.5 text-sm text-gray-700 hover:text-gray-900 transition">{{ n }}</button>
        <p v-if="notes.length === 0" class="text-gray-400 text-sm py-4">Keine Notizen in diesem Projekt.</p>
      </div>
    </div>

    <!-- Tasks -->
    <div v-if="tab === 'tasks'">
      <div class="flex gap-2 mb-4">
        <input v-model="newTask" placeholder="Neue Aufgabe..." @keyup.enter="addTask" class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
        <button @click="addTask" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Hinzufuegen</button>
      </div>
      <div class="divide-y divide-gray-100">
        <div v-for="t in tasks.filter(t => t.status !== 'done')" :key="t.id" class="flex items-center gap-3 py-2.5">
          <input type="checkbox" @change="completeTask(t)" class="w-4 h-4 rounded border-gray-300" />
          <div>
            <span class="text-sm text-gray-700">{{ t.text }}</span>
            <span v-if="t.assignee" class="text-xs text-gray-400 ml-2">{{ t.assignee }}</span>
          </div>
        </div>
        <p v-if="tasks.filter(t => t.status !== 'done').length === 0" class="text-gray-400 text-sm py-4">Keine offenen Aufgaben.</p>
      </div>
    </div>

    <!-- Termine -->
    <div v-if="tab === 'termine'">
      <div class="flex gap-2 mb-4">
        <input v-model="newDatum" type="date" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-40" />
        <input v-model="newUhrzeit" type="time" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-28" />
        <input v-model="newTerminText" placeholder="Beschreibung..." @keyup.enter="addTermin" class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
        <button @click="addTermin" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Erstellen</button>
      </div>
      <div class="divide-y divide-gray-100">
        <div v-for="t in termine" :key="t.id" class="flex items-center justify-between py-2.5">
          <div>
            <span class="text-sm text-gray-700">{{ t.text }}</span>
            <span class="text-xs text-gray-400 ml-2">{{ t.datum }}{{ t.uhrzeit ? ' ' + t.uhrzeit : '' }}</span>
          </div>
          <button @click="removeTermin(t)" class="text-xs text-gray-400 hover:text-red-500 transition">Loeschen</button>
        </div>
        <p v-if="termine.length === 0" class="text-gray-400 text-sm py-4">Keine Termine.</p>
      </div>
    </div>
  </div>
</template>
