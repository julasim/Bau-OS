<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import BIcon from "../components/BIcon.vue";

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
  <div style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)">
    <button
      @click="router.push('/projects')"
      class="flex items-center"
      style="
        gap: 4px;
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        font-size: 12px;
        cursor: pointer;
        margin-bottom: 16px;
      "
    >
      <BIcon name="arrowLeft" :size="12" />
      Alle Projekte
    </button>

    <div style="margin-bottom: 28px">
      <div class="eyebrow" style="margin-bottom: 6px">Projekt</div>
      <h1 style="font-size: 28px; font-weight: 600; margin: 0; letter-spacing: -0.01em">
        {{ projectName }}
      </h1>
    </div>

    <!-- Stat-Kacheln -->
    <div
      v-if="info"
      class="grid"
      style="grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px"
    >
      <div class="stat-tile">
        <div class="eyebrow">Notizen</div>
        <div
          style="
            font-size: 24px;
            font-weight: 600;
            color: var(--color-text);
            margin-top: 4px;
            letter-spacing: -0.02em;
          "
        >
          {{ info.notes }}
        </div>
      </div>
      <div class="stat-tile">
        <div class="eyebrow">Offene Aufgaben</div>
        <div
          style="
            font-size: 24px;
            font-weight: 600;
            color: var(--color-text);
            margin-top: 4px;
            letter-spacing: -0.02em;
          "
        >
          {{ info.openTasks }}
        </div>
      </div>
      <div class="stat-tile">
        <div class="eyebrow">Termine</div>
        <div
          style="
            font-size: 24px;
            font-weight: 600;
            color: var(--color-text);
            margin-top: 4px;
            letter-spacing: -0.02em;
          "
        >
          {{ info.termine }}
        </div>
      </div>
    </div>

    <!-- Tab-Nav -->
    <div
      class="flex"
      style="gap: 24px; margin-bottom: 20px; border-bottom: 1px solid var(--color-border)"
    >
      <button
        v-for="t in (['notes', 'tasks', 'termine'] as const)"
        :key="t"
        @click="
          tab = t;
          viewingNote = null;
        "
        :class="['tab-btn', tab === t ? 'tab-btn-active' : '']"
      >
        {{ t === "notes" ? "Notizen" : t === "tasks" ? "Aufgaben" : "Termine" }}
      </button>
    </div>

    <!-- Notes -->
    <div v-if="tab === 'notes'">
      <div v-if="viewingNote">
        <div class="flex items-center justify-between" style="margin-bottom: 12px">
          <span class="font-mono" style="font-size: 12px; color: var(--color-text-muted)">
            {{ viewingNote }}
          </span>
          <button @click="viewingNote = null" class="bauos-btn ghost">Schließen</button>
        </div>
        <div
          style="
            border: 1px solid var(--color-border);
            border-radius: 8px;
            padding: 20px 24px;
            background: var(--color-bg);
            max-height: 500px;
            overflow: auto;
            font-size: 14px;
            line-height: 1.7;
            color: var(--color-text-secondary);
          "
        >
          <MarkdownRenderer :content="noteContent" />
        </div>
      </div>
      <div v-else style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
        <button
          v-for="n in notes"
          :key="n"
          @click="openNote(n)"
          class="detail-row"
          style="border-top: 1px solid var(--color-border-subtle)"
        >
          <BIcon name="file" :size="14" style="color: var(--color-text-muted)" />
          <span class="flex-1" style="font-size: 13px; color: var(--color-text)">{{ n }}</span>
        </button>
        <p
          v-if="notes.length === 0"
          style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 28px"
        >
          Keine Notizen in diesem Projekt.
        </p>
      </div>
    </div>

    <!-- Tasks -->
    <div v-if="tab === 'tasks'">
      <div class="flex" style="gap: 8px; margin-bottom: 16px">
        <input
          v-model="newTask"
          placeholder="Neue Aufgabe…"
          @keyup.enter="addTask"
          class="form-input"
        />
        <button @click="addTask" class="bauos-btn solid">Hinzufügen</button>
      </div>
      <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
        <div
          v-for="t in tasks.filter((t) => t.status !== 'done')"
          :key="t.id"
          class="flex items-center"
          style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        >
          <input type="checkbox" @change="completeTask(t)" style="accent-color: var(--color-primary)" />
          <span style="flex: 1; font-size: 13px; color: var(--color-text-secondary)">{{ t.text }}</span>
          <span
            v-if="t.assignee"
            style="font-size: 11px; color: var(--color-text-tertiary)"
            >{{ t.assignee }}</span
          >
          <span
            v-if="t.date"
            class="font-mono"
            style="font-size: 11px; color: var(--color-text-tertiary)"
            >{{ t.date }}</span
          >
        </div>
        <p
          v-if="tasks.filter((t) => t.status !== 'done').length === 0"
          style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 24px"
        >
          Keine offenen Aufgaben.
        </p>
      </div>
    </div>

    <!-- Termine -->
    <div v-if="tab === 'termine'">
      <div class="flex" style="gap: 8px; margin-bottom: 16px">
        <input v-model="newDatum" type="date" class="form-input" style="width: 150px" />
        <input v-model="newUhrzeit" type="time" class="form-input" style="width: 110px" />
        <input
          v-model="newTerminText"
          placeholder="Beschreibung…"
          @keyup.enter="addTermin"
          class="form-input"
        />
        <button @click="addTermin" class="bauos-btn solid">Erstellen</button>
      </div>
      <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
        <div
          v-for="t in termine"
          :key="t.id"
          class="termin-row flex items-center justify-between"
          style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        >
          <div class="min-w-0">
            <div style="font-size: 13px; color: var(--color-text)">{{ t.text }}</div>
            <div
              class="font-mono"
              style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px"
            >
              {{ t.datum }}{{ t.uhrzeit ? " · " + t.uhrzeit : "" }}
            </div>
          </div>
          <button @click="removeTermin(t)" class="del-btn">Löschen</button>
        </div>
        <p
          v-if="termine.length === 0"
          style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 24px"
        >
          Keine Termine.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-tile {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--color-bg);
}

.tab-btn {
  padding-bottom: 10px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
  margin-bottom: -1px;
  transition: all 180ms ease;
}
.tab-btn:hover {
  color: var(--color-text);
}
.tab-btn-active {
  color: var(--color-text);
  border-bottom-color: var(--color-primary);
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 180ms ease;
}
.detail-row:first-child {
  border-top: 0 !important;
}
.detail-row:hover {
  background: var(--color-bg-subtle);
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
  flex: 1;
}

.termin-row .del-btn {
  font-size: 11px;
  color: var(--color-text-faint);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: all 180ms ease;
}
.termin-row:hover .del-btn {
  opacity: 1;
}
.termin-row .del-btn:hover {
  color: var(--color-danger-text);
}
</style>
