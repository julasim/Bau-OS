<script setup lang="ts">
// ============================================================
// PATIO — TasksListPane
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

// Group tasks by due date bucket
type Bucket = "overdue" | "today" | "this_week" | "later" | "no_date" | "done";

function dateBucket(t: Task): Bucket {
  if (t.status === "done") return "done";
  if (!t.date) return "no_date";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(t.date.includes("T") ? t.date : t.date + "T00:00:00");
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  // within the next 7 days (same week)
  if (diff <= 6) return "this_week";
  return "later";
}

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "this_week", "later", "no_date", "done"];
const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Überfällig",
  today: "Heute",
  this_week: "Diese Woche",
  later: "Später",
  no_date: "Kein Datum",
  done: "Erledigt",
};

const grouped = computed(() => {
  const buckets: Record<Bucket, Task[]> = {
    overdue: [],
    today: [],
    this_week: [],
    later: [],
    no_date: [],
    done: [],
  };
  for (const t of filtered.value) {
    buckets[dateBucket(t)].push(t);
  }
  return BUCKET_ORDER.map((key) => ({ key, label: BUCKET_LABELS[key], tasks: buckets[key] })).filter(
    (g) => g.tasks.length > 0,
  );
});

// unique project list for filter dropdown
const projectOptions = computed(() => {
  const seen = new Set<string>();
  for (const t of tasks.value) {
    if (t.project) seen.add(t.project);
  }
  return [...seen].sort();
});

const projectFilter = ref("");

const filteredByProject = computed(() => {
  if (!projectFilter.value) return filtered.value;
  return filtered.value.filter((t) => t.project === projectFilter.value);
});

const groupedFiltered = computed(() => {
  const buckets: Record<Bucket, Task[]> = {
    overdue: [],
    today: [],
    this_week: [],
    later: [],
    no_date: [],
    done: [],
  };
  for (const t of filteredByProject.value) {
    buckets[dateBucket(t)].push(t);
  }
  return BUCKET_ORDER.map((key) => ({ key, label: BUCKET_LABELS[key], tasks: buckets[key] })).filter(
    (g) => g.tasks.length > 0,
  );
});

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
    <!-- Page header -->
    <div class="tasks-pagehead">
      <div class="tasks-kpis">
        <div class="ap-kpi">
          <span class="ap-kpi-val">{{ counts.open }}</span>
          <span class="ap-kpi-lbl">Offen</span>
        </div>
        <div class="ap-kpi">
          <span class="ap-kpi-val">{{ counts.in_progress }}</span>
          <span class="ap-kpi-lbl">In Arbeit</span>
        </div>
        <div class="ap-kpi">
          <span class="ap-kpi-val">{{ counts.done }}</span>
          <span class="ap-kpi-lbl">Erledigt</span>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="ap-toolbar">
      <!-- Status segment -->
      <div class="pt-segment" aria-label="Status filtern">
        <button type="button" :class="{ 'is-active': tab === 'all' }" @click="tab = 'all'">Alle</button>
        <button type="button" :class="{ 'is-active': tab === 'open' }" @click="tab = 'open'">Offen</button>
        <button type="button" :class="{ 'is-active': tab === 'in_progress' }" @click="tab = 'in_progress'">
          In Arbeit
        </button>
        <button type="button" :class="{ 'is-active': tab === 'done' }" @click="tab = 'done'">Erledigt</button>
      </div>

      <!-- Project filter -->
      <div class="ap-filter">
        <select v-model="projectFilter" class="pt-select" aria-label="Nach Projekt filtern">
          <option value="">Alle Projekte</option>
          <option v-for="p in projectOptions" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>

      <span class="pt-spacer"></span>

      <!-- New task button (triggers quickAdd inline or can be extended) -->
      <button
        class="pt-btn pt-btn--primary pt-btn--sm"
        type="button"
        @click="$el.querySelector('.tasks-quickadd input')?.focus()"
      >
        <svg
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Neue Aufgabe
      </button>
    </div>

    <!-- Grouped task list -->
    <template v-if="groupedFiltered.length > 0">
      <template v-for="group in groupedFiltered" :key="group.key">
        <!-- Group header -->
        <div
          class="ap-group-h"
          :class="{
            'tasks-group--overdue': group.key === 'overdue',
            'tasks-group--done': group.key === 'done',
          }"
        >
          <span v-if="group.key === 'overdue'" class="pt-dot pt-dot--danger"></span>
          <span v-else-if="group.key === 'today'" class="pt-dot pt-dot--warning"></span>
          {{ group.label }}
          <span class="ct">· {{ group.tasks.length }}</span>
          <span class="ln"></span>
        </div>

        <!-- Task rows -->
        <div class="pt-list" :class="{ 'tasks-list--done': group.key === 'done' }">
          <div
            v-for="task in group.tasks"
            :key="task.id"
            class="pt-list-item"
            :class="{ 'is-selected': task.id === activeId }"
            role="button"
            tabindex="0"
            @click="openTask(task.id)"
            @keyup.enter="openTask(task.id)"
          >
            <input class="pt-check" type="checkbox" :checked="task.status === 'done'" @click.stop @change.stop />
            <div class="pt-list-grow">
              <div class="pt-li-title" :class="{ 'is-done': task.status === 'done' }">{{ task.text }}</div>
              <div v-if="displayAssignee(task) || task.project" class="pt-li-meta">
                <b v-if="task.project">{{ task.project }}</b>
                <template v-if="task.project && displayAssignee(task)"> · </template>
                <span v-if="displayAssignee(task)">{{ displayAssignee(task) }}</span>
              </div>
            </div>
            <div class="tasks-row-end">
              <!-- Date badge -->
              <template v-if="task.date && task.status !== 'done'">
                <span v-if="group.key === 'overdue'" class="pt-badge pt-badge--danger">
                  <span class="pt-dot pt-dot--danger"></span>
                  {{ fmtDate(task.date) }}
                </span>
                <span v-else-if="group.key === 'today'" class="pt-badge pt-badge--warning">
                  <span class="pt-dot pt-dot--warning"></span>
                  heute
                </span>
                <span v-else class="pt-badge">{{ fmtDate(task.date) }}</span>
              </template>
              <span v-if="task.status === 'done'" class="pt-badge pt-badge--success">erledigt</span>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Empty state -->
    <div v-else class="ap-empty" style="display: block">
      <p v-if="search || projectFilter">Keine Aufgaben für diese Filter.</p>
      <p v-else-if="tab === 'open'">Keine offenen Aufgaben vorhanden.</p>
      <p v-else-if="tab === 'done'">Noch keine Aufgaben abgeschlossen.</p>
      <p v-else>Noch keine Aufgaben angelegt.</p>
    </div>

    <!-- Quick-Add -->
    <div class="tasks-quickadd">
      <input v-model="newText" class="pt-input" placeholder="+ Neue Aufgabe (Enter)" @keyup.enter="quickAdd" />
    </div>
  </ListPane>
</template>

<style scoped>
.tasks-pagehead {
  padding: var(--space-4) var(--space-5) 0;
}

.tasks-kpis {
  display: flex;
  gap: var(--space-8);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--hairline);
}

.ap-toolbar {
  padding: var(--space-4) var(--space-5);
  margin-bottom: 0;
  border-bottom: 1px solid var(--hairline);
}

.ap-group-h {
  padding: 0 var(--space-5);
}

.ap-group-h.tasks-group--overdue {
  color: var(--danger-fg);
}

.pt-list {
  border-radius: 0;
  border-left: 0;
  border-right: 0;
  border-top: 0;
  border-bottom: 1px solid var(--hairline);
}

.tasks-list--done .pt-list-item {
  opacity: 0.72;
}

.tasks-row-end {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

.tasks-quickadd {
  margin-top: auto;
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border);
  background: var(--surface);
  position: sticky;
  bottom: 0;
}

.tasks-quickadd .pt-input {
  height: 32px;
  font-size: var(--fs-13);
}
</style>
