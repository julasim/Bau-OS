<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — TasksListPane
// ============================================================
// ListPane fuer Tasks. Tabs: Alle / Offen / In Arbeit / Erledigt.
// Quick-Add unten. Klick auf Task → /tasks/:id (Detail rechts).
// ============================================================

import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import { useEvents } from "../../composables/useEvents";
import ListPane from "../../components/shell/ListPane.vue";
import StatusDot from "../../components/shell/StatusDot.vue";

interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  assigneeName?: string | null;
  assignee: string | null;
  date: string | null;
  project: string | null;
  updatedAt: string;
}

type Tab = "all" | "open" | "in_progress" | "done";

const route = useRoute();
const router = useRouter();
const tasks = ref<Task[]>([]);
const search = ref("");
const tab = ref<Tab>("open");
const newText = ref("");

const counts = computed(() => ({
  all: tasks.value.length,
  open: tasks.value.filter((t) => t.status === "open").length,
  in_progress: tasks.value.filter((t) => t.status === "in_progress").length,
  done: tasks.value.filter((t) => t.status === "done").length,
}));

const filtered = computed(() => {
  let r = tasks.value;
  if (tab.value === "open") r = r.filter((t) => t.status === "open");
  else if (tab.value === "in_progress") r = r.filter((t) => t.status === "in_progress");
  else if (tab.value === "done") r = r.filter((t) => t.status === "done");
  if (search.value) {
    const q = search.value.toLowerCase();
    r = r.filter(
      (t) =>
        t.text.toLowerCase().includes(q) ||
        t.project?.toLowerCase().includes(q) ||
        t.assigneeName?.toLowerCase().includes(q),
    );
  }
  return [...r].sort((a, b) => {
    // Faelligkeit zuerst (heute > zukunft > kein-datum), dann updated desc
    const da = a.date ?? "9999-99-99";
    const db = b.date ?? "9999-99-99";
    if (da !== db) return da.localeCompare(db);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
});

const activeId = computed(() => (route.params.id as string) ?? "");

async function load() {
  try {
    tasks.value = await api.get<Task[]>("/tasks");
  } catch {
    tasks.value = [];
  }
}

function statusToDot(s: Task["status"]): "open" | "doing" | "done" {
  if (s === "open") return "open";
  if (s === "in_progress") return "doing";
  return "done";
}

function openTask(id: string) {
  router.push(`/tasks/${id}`);
}

async function quickAdd() {
  if (!newText.value.trim()) return;
  const text = newText.value;
  newText.value = "";
  const created = await api.post<Task>("/tasks", { text });
  await load();
  if (created?.id) router.push(`/tasks/${created.id}`);
}

function displayAssignee(t: Task): string {
  if (t.assigneeName && t.assigneeName !== "[object Object]") return t.assigneeName;
  if (t.assignee && t.assignee !== "[object Object]") return t.assignee;
  return "";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
}

onMounted(load);
useEvents(["task"], () => load());
</script>

<template>
  <ListPane
    title="Aufgaben"
    :count="counts.all"
    searchable
    search-placeholder="Aufgaben filtern…"
    :model-value="search"
    @update:model-value="search = $event"
    :tabs="[
      { id: 'open', label: `Offen ${counts.open}` },
      { id: 'in_progress', label: `Aktiv ${counts.in_progress}` },
      { id: 'done', label: `Erledigt ${counts.done}` },
      { id: 'all', label: `Alle ${counts.all}` },
    ]"
    :active-tab="tab"
    @tab-change="tab = $event as Tab"
  >
    <button
      v-for="task in filtered"
      :key="task.id"
      class="list-item"
      :data-active="task.id === activeId"
      @click="openTask(task.id)"
    >
      <div class="li-top" style="align-items: center">
        <StatusDot :status="statusToDot(task.status)" />
        <span class="li-title">{{ task.text }}</span>
        <span v-if="task.date" class="li-time">{{ fmtDate(task.date) }}</span>
      </div>
      <div v-if="displayAssignee(task) || task.project" class="li-meta">
        <span v-if="displayAssignee(task)">{{ displayAssignee(task) }}</span>
        <span v-if="displayAssignee(task) && task.project">·</span>
        <span v-if="task.project">{{ task.project }}</span>
      </div>
    </button>

    <div
      v-if="filtered.length === 0"
      style="padding: 32px 16px; text-align: center; font-size: 12px; color: var(--fg-muted)"
    >
      <span v-if="search">Keine Treffer für „{{ search }}"</span>
      <span v-else-if="tab === 'open'">Keine offenen Aufgaben — alles erledigt 🎉</span>
      <span v-else-if="tab === 'done'">Noch nichts erledigt.</span>
      <span v-else>Keine Aufgaben.</span>
    </div>

    <!-- Quick-Add unten -->
    <div
      style="
        margin-top: auto;
        padding: 8px;
        border-top: 1px solid var(--list-border);
        background: var(--list-bg);
        position: sticky;
        bottom: 0;
      "
    >
      <input
        v-model="newText"
        placeholder="+ Neue Aufgabe (Enter)"
        @keyup.enter="quickAdd"
        style="
          width: 100%;
          padding: 8px 10px;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          background: var(--bg-app);
          color: var(--fg-primary);
          font-size: 13px;
          outline: none;
        "
      />
    </div>
  </ListPane>
</template>
