<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";
import BIcon from "../components/BIcon.vue";

interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  priority?: string;
  /** Legacy-Freitext-Assignee. Bei alten Daten kann hier auch
   *  "[object Object]" stehen — wir zeigen das defensiv als "—". */
  assignee: string | null;
  /** Migration 007: FK auf team_members.id — wenn gesetzt ist
   *  assigneeName aus dem Backend-Join verfuegbar. */
  assigneeId?: string | null;
  assigneeName?: string | null;
  date: string | null;
  location: string | null;
  project: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Defensive Anzeige fuer assignee — alte Daten koennten "[object Object]"
 *  als String enthalten (Bug aus alter API-Version, gefixt mit dem TeamMini-
 *  Type-Fix). Bevorzugt assigneeName aus dem Backend-Join, sonst Freitext. */
function displayAssignee(task: Task): string {
  if (task.assigneeName && task.assigneeName !== "[object Object]") return task.assigneeName;
  if (task.assignee && task.assignee !== "[object Object]") return task.assignee;
  return "—";
}

type ViewMode = "list" | "kanban" | "timeline";

const tasks = ref<Task[]>([]);
// /team liefert seit Migration 006 TeamMember-Objects, nicht mehr string[].
// Wir brauchen hier nur id+name fuers Select.
interface TeamMini {
  id: string;
  name: string;
}
const team = ref<TeamMini[]>([]);
const editing = ref<Task | null>(null);
const newText = ref("");
const filter = ref<"all" | "open" | "in_progress" | "done">("all");

// Ref auf Quick-Add-Input — wird vom Empty-State-CTA fokussiert.
const quickAddInput = ref<HTMLInputElement | null>(null);
function focusQuickAdd() {
  quickAddInput.value?.focus();
  quickAddInput.value?.scrollIntoView({ behavior: "smooth", block: "center" });
}
const viewMode = ref<ViewMode>("list");

const filtered = computed(() => {
  if (filter.value === "all") return tasks.value;
  return tasks.value.filter((t) => t.status === filter.value);
});

const counts = computed(() => ({
  all: tasks.value.length,
  open: tasks.value.filter((t) => t.status === "open").length,
  in_progress: tasks.value.filter((t) => t.status === "in_progress").length,
  done: tasks.value.filter((t) => t.status === "done").length,
}));

async function load() {
  [tasks.value, team.value] = await Promise.all([
    api.get<Task[]>("/tasks"),
    api.get<TeamMini[]>("/team").catch(() => []),
  ]);
}

async function create() {
  if (!newText.value.trim()) return;
  await api.post("/tasks", { text: newText.value });
  newText.value = "";
  await load();
}

async function save(task: Task) {
  // Defensive: falls assignee aus alten kaputten Daten ein Object ist
  // ("[object Object]"-String oder echtes Object), normalisieren auf null.
  const cleanAssignee =
    typeof task.assignee === "string" && task.assignee !== "[object Object]"
      ? task.assignee
      : null;
  await api.put(`/tasks/${task.id}`, {
    text: task.text,
    status: task.status,
    assignee: cleanAssignee,
    assigneeId: task.assigneeId ?? null,
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

async function cycleStatus(task: Task) {
  const next: Record<Task["status"], Task["status"]> = {
    open: "in_progress",
    in_progress: "done",
    done: "open",
  };
  await setStatus(task, next[task.status]);
}

async function remove(id: string) {
  await api.delete(`/tasks/${id}`);
  await load();
}

function edit(task: Task) {
  editing.value = { ...task };
}

const statusLabel: Record<Task["status"], string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};
const filterLabel: Record<"all" | Task["status"], string> = {
  all: "Alle",
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};

function formatDate(d: string | null) {
  if (!d) return "";
  if (d.includes(".")) return d;
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

onMounted(load);
useEvents(["task"], () => load());

const kanbanColumns = computed(() => [
  { key: "open" as const, title: "Offen", dotClass: "status-open", items: tasks.value.filter((t) => t.status === "open") },
  { key: "in_progress" as const, title: "In Arbeit", dotClass: "status-progress", items: tasks.value.filter((t) => t.status === "in_progress") },
  { key: "done" as const, title: "Erledigt", dotClass: "status-done", items: tasks.value.filter((t) => t.status === "done") },
]);
</script>

<template>
  <div
    style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)"
  >
    <!-- Header -->
    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Arbeit</div>
        <h1
          style="
            font-size: 24px;
            font-weight: 600;
            margin: 0;
            letter-spacing: -0.01em;
            color: var(--color-text);
          "
        >
          Aufgaben
        </h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ counts.open }} offen · {{ counts.in_progress }} in Arbeit · {{ counts.done }} erledigt
        </p>
      </div>
      <!-- Segmented View-Switcher -->
      <div
        class="flex"
        style="border: 1px solid var(--color-border); border-radius: 6px; overflow: hidden"
      >
        <button
          v-for="(m, i) in ['list', 'kanban', 'timeline'] as ViewMode[]"
          :key="m"
          @click="viewMode = m"
          :class="['seg-btn', viewMode === m ? 'seg-btn-active' : '', i > 0 ? 'seg-divider' : '']"
          :aria-pressed="viewMode === m"
        >
          <BIcon :name="m" :size="14" />
          <span>{{ m === "list" ? "Liste" : m === "kanban" ? "Kanban" : "Zeitstrahl" }}</span>
        </button>
      </div>
    </div>

    <!-- Quick-Add -->
    <div class="flex gap-2" style="margin-bottom: 20px">
      <input
        ref="quickAddInput"
        v-model="newText"
        placeholder="Neue Aufgabe…"
        @keyup.enter="create"
        class="flex-1"
        style="
          padding: 8px 12px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          font-size: 13px;
          outline: none;
          background: var(--color-bg);
          color: var(--color-text);
        "
      />
      <button @click="create" class="bauos-btn solid">
        <BIcon name="plus" :size="14" :stroke-width="2" /> Hinzufügen
      </button>
    </div>

    <!-- Filter-Pills -->
    <div class="flex" style="gap: 6px; margin-bottom: 16px">
      <button
        v-for="f in (['all', 'open', 'in_progress', 'done'] as const)"
        :key="f"
        @click="filter = f"
        :class="['filter-pill', filter === f ? 'filter-pill-active' : '']"
      >
        {{ filterLabel[f] }}
        <span :class="['filter-count', filter === f ? 'filter-count-active' : '']">
          {{ counts[f] }}
        </span>
      </button>
    </div>

    <!-- Edit-Form -->
    <div
      v-if="editing"
      style="
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 20px;
        background: var(--color-bg);
      "
    >
      <div style="margin-bottom: 12px">
        <label class="eyebrow" style="margin-bottom: 4px; display: block">Beschreibung</label>
        <input v-model="editing.text" class="form-input" />
      </div>
      <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px">
        <div>
          <label class="eyebrow" style="margin-bottom: 4px; display: block">Status</label>
          <select v-model="editing.status" class="form-input">
            <option value="open">Offen</option>
            <option value="in_progress">In Arbeit</option>
            <option value="done">Erledigt</option>
          </select>
        </div>
        <div>
          <label class="eyebrow" style="margin-bottom: 4px; display: block">Person</label>
          <!-- Bind auf assigneeId (UUID) statt assignee (Text). Backend
               denormalisiert assignee-Text aus team_members.name beim Save,
               sodass die Anzeige in der Liste konsistent bleibt. -->
          <select v-model="editing.assigneeId" class="form-input">
            <option :value="null">–</option>
            <option v-for="m in team" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div>
          <label class="eyebrow" style="margin-bottom: 4px; display: block">Datum</label>
          <input v-model="editing.date" type="date" class="form-input" />
        </div>
      </div>
      <div style="margin-bottom: 16px">
        <label class="eyebrow" style="margin-bottom: 4px; display: block">Ort</label>
        <input v-model="editing.location" placeholder="z. B. Baustelle Wien" class="form-input" />
      </div>
      <div class="flex gap-2">
        <button @click="save(editing!)" class="bauos-btn solid">Speichern</button>
        <button @click="editing = null" class="bauos-btn ghost">Abbrechen</button>
      </div>
    </div>

    <!-- LIST VIEW -->
    <!-- Mobile: outer wrapper scrollt horizontal, innerer Container hat
         min-width damit die Spalten nicht zerquetscht werden. Ab 768px
         normales Verhalten ohne Scroll. -->
    <div
      v-if="viewMode === 'list'"
      class="task-list-wrap"
      style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden"
    >
     <div class="task-list-inner">
      <!-- Header — auf Mobile via CSS hidden, weil dort keine Tabelle mehr -->
      <div class="task-list-header flex items-center">
        <span style="width: 14px" />
        <span class="eyebrow flex-1">Aufgabe</span>
        <span class="eyebrow" style="width: 120px">Projekt</span>
        <span class="eyebrow" style="width: 100px">Person</span>
        <span class="eyebrow" style="width: 90px">Fällig</span>
      </div>
      <div v-if="filtered.length === 0" class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">
          {{ filter === "all" ? "Noch keine Aufgaben." : "Keine Aufgaben in dieser Ansicht." }}
        </div>
        <button v-if="filter === 'all'" class="bauos-btn solid sm" @click="focusQuickAdd">
          <BIcon name="plus" :size="11" :stroke-width="2" />
          Erste Aufgabe anlegen
        </button>
      </div>
      <div
        v-for="task in filtered"
        :key="task.id"
        class="task-row flex items-center"
        style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
      >
        <button
          @click="cycleStatus(task)"
          :class="['status-box', `status-${task.status}`]"
          :aria-label="statusLabel[task.status]"
        >
          <BIcon v-if="task.status === 'done'" name="check" :size="10" :stroke-width="2.5" />
        </button>
        <div class="task-text flex-1 min-w-0" @click="edit(task)" style="cursor: pointer">
          <div
            :class="{ 'line-through': task.status === 'done' }"
            :style="{
              fontSize: '13px',
              color:
                task.status === 'done'
                  ? 'var(--color-text-tertiary)'
                  : 'var(--color-text-secondary)',
            }"
            class="truncate"
          >
            {{ task.text }}
          </div>
          <div
            v-if="task.location"
            style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px"
          >
            {{ task.location }}
          </div>
          <!-- Mobile-Meta-Zeile: Projekt + Person + Datum als Chips, nur unter
               768px sichtbar (CSS unten). Verhindert Tabellen-Quetsche auf Phone. -->
          <div class="task-meta-mobile">
            <span v-if="task.project" class="task-meta-chip">{{ task.project }}</span>
            <span v-if="task.assigneeName || (task.assignee && task.assignee !== '[object Object]')" class="task-meta-text">
              👤 {{ displayAssignee(task) }}
            </span>
            <span v-if="task.date" class="task-meta-text font-mono">📅 {{ formatDate(task.date) }}</span>
          </div>
        </div>
        <div class="task-col-project" style="width: 120px; font-size: 12px; color: var(--color-text-muted)">
          <span
            v-if="task.project"
            style="
              background: var(--color-border-subtle);
              padding: 2px 8px;
              border-radius: 4px;
              font-size: 11px;
            "
            class="truncate"
            >{{ task.project }}</span
          >
          <span v-else style="color: var(--color-text-faint)">—</span>
        </div>
        <div class="task-col-person truncate" style="width: 100px; font-size: 12px; color: var(--color-text-muted)">
          {{ displayAssignee(task) }}
        </div>
        <div
          class="task-col-date font-mono"
          style="width: 90px; font-size: 11px; color: var(--color-text-muted)"
        >
          {{ formatDate(task.date) || "—" }}
        </div>
        <div class="task-actions flex" style="gap: 6px">
          <button class="icon-btn" @click="remove(task.id)" title="Löschen">
            <BIcon name="x" :size="12" />
          </button>
        </div>
      </div>
     </div>
    </div>

    <!-- KANBAN VIEW -->
    <div v-else-if="viewMode === 'kanban'" class="grid kanban-grid" style="grid-template-columns: repeat(3, 1fr); gap: 12px">
      <div
        v-for="col in kanbanColumns"
        :key="col.key"
        style="
          background: var(--color-bg-subtle);
          border: 1px solid var(--color-border-subtle);
          border-radius: 8px;
          padding: 12px;
          min-height: 400px;
        "
      >
        <div class="flex items-center justify-between" style="margin-bottom: 12px; padding: 0 4px">
          <div class="flex items-center gap-2">
            <span :class="['dot', col.dotClass]" />
            <span style="font-size: 13px; font-weight: 600; color: var(--color-text)">
              {{ col.title }}
            </span>
            <span style="font-size: 11px; color: var(--color-text-tertiary)">
              {{ col.items.length }}
            </span>
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px">
          <div
            v-for="task in col.items"
            :key="task.id"
            class="kanban-card"
            @click="edit(task)"
          >
            <div
              :class="{ 'line-through': task.status === 'done' }"
              :style="{
                fontSize: '13px',
                fontWeight: 500,
                color:
                  task.status === 'done'
                    ? 'var(--color-text-tertiary)'
                    : 'var(--color-text)',
                marginBottom: '8px',
              }"
            >
              {{ task.text }}
            </div>
            <div class="flex items-center justify-between" style="gap: 6px; font-size: 10px">
              <span
                v-if="task.project"
                style="
                  background: var(--color-border-subtle);
                  padding: 1px 6px;
                  border-radius: 3px;
                  color: var(--color-text-muted);
                "
              >
                {{ task.project }}
              </span>
              <span class="font-mono" style="color: var(--color-text-tertiary)">
                {{ formatDate(task.date) }}
              </span>
            </div>
          </div>
          <div
            v-if="col.items.length === 0"
            style="font-size: 11px; color: var(--color-text-faint); text-align: center; padding: 12px 0"
          >
            keine
          </div>
        </div>
      </div>
    </div>

    <!-- TIMELINE VIEW -->
    <div
      v-else-if="viewMode === 'timeline'"
      style="border: 1px solid var(--color-border); border-radius: 8px; padding: 20px; background: var(--color-bg)"
    >
      <div v-if="filtered.length === 0" style="font-size: 13px; color: var(--color-text-tertiary); text-align: center">
        Keine Aufgaben in dieser Ansicht.
      </div>
      <div v-else style="display: flex; flex-direction: column; gap: 8px">
        <div
          v-for="task in filtered"
          :key="task.id"
          style="
            height: 36px;
            display: flex;
            align-items: center;
            border-bottom: 1px solid var(--color-border-subtle);
          "
        >
          <div
            :class="['timeline-pill', `status-${task.status}`]"
            @click="edit(task)"
          >
            <span :class="['dot', `status-${task.status}`]" />
            <span class="truncate" style="flex: 1">{{ task.text }}</span>
            <span class="font-mono" style="font-size: 10px; opacity: 0.7">
              {{ formatDate(task.date) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 180ms ease, color 180ms ease;
}
.seg-btn-active {
  background: var(--color-border-subtle);
  color: var(--color-text);
}
.seg-divider {
  border-left: 1px solid var(--color-border);
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 180ms ease;
}
.filter-pill:hover {
  border-color: var(--color-text-faint);
  color: var(--color-text);
}
.filter-pill-active {
  background: var(--color-primary);
  color: var(--color-bg);
  border-color: var(--color-primary);
}
.filter-count {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  background: var(--color-border-subtle);
  color: var(--color-text-muted);
}
.filter-count-active {
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-bg);
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
}

.status-box {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid var(--color-text-faint);
  background: transparent;
  color: #fff;
  padding: 0;
  transition: all 180ms ease;
}
.status-box.status-in_progress {
  background: var(--color-warning);
  border-color: var(--color-warning);
}
.status-box.status-done {
  background: var(--color-success);
  border-color: var(--color-success);
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 9999px;
}
.dot.status-open {
  background: var(--color-text-faint);
}
.dot.status-progress,
.dot.status-in_progress {
  background: var(--color-warning);
}
.dot.status-done {
  background: var(--color-success);
}

.task-row {
  cursor: default;
  transition: background 180ms ease;
}
.task-row:hover {
  background: var(--color-bg-subtle);
}
.task-row .task-actions {
  opacity: 0;
  transition: opacity 180ms ease;
}
.task-row:hover .task-actions {
  opacity: 1;
}

.icon-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
}
.icon-btn:hover {
  background: var(--color-border-subtle);
  color: var(--color-text);
}

.kanban-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 180ms ease;
}
.kanban-card:hover {
  border-color: var(--color-text-faint);
}

.timeline-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  font-size: 12px;
  color: var(--color-text);
  cursor: pointer;
  max-width: 70%;
  transition: all 180ms ease;
}
.timeline-pill.status-in_progress {
  background: var(--color-warning-bg);
  border-color: var(--color-warning-border);
  color: var(--color-warning-text);
}
.timeline-pill.status-done {
  background: var(--color-success-bg);
  border-color: var(--color-success-border);
  color: var(--color-success-text);
}
.timeline-pill:hover {
  transform: translateX(2px);
}

/* ── Tasks-Liste — Layouts ─────────────────────────────────── */
.task-list-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.task-list-inner {
  /* Desktop: min-width damit die Spalten nicht zerquetscht werden. */
  min-width: 600px;
}
.task-list-header {
  gap: 12px;
  padding: 10px 16px;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}
/* Mobile-Meta-Zeile (Projekt/Person/Datum als Chips) — Default hidden,
   wird unter 768px aktiviert. */
.task-meta-mobile {
  display: none;
}

@media (max-width: 767.98px) {
  /* Kein horizontal-scroll mehr — wir wechseln auf Card-Layout */
  .task-list-wrap {
    overflow-x: visible;
  }
  .task-list-inner {
    min-width: 0;
  }
  /* Header verstecken — auf Phone redundant (Meta-Chips selbsterklaerend) */
  .task-list-header {
    display: none;
  }
  /* Tabellen-Spalten verstecken — Meta wandert unter den Aufgabe-Text */
  .task-col-project,
  .task-col-person,
  .task-col-date {
    display: none !important;
  }
  /* Mobile-Meta-Zeile sichtbar */
  .task-meta-mobile {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--color-text-muted);
    align-items: center;
  }
  .task-meta-chip {
    background: var(--color-border-subtle);
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--color-text-muted);
  }
  .task-meta-text {
    font-size: 11px;
    color: var(--color-text-muted);
  }
  /* Row-Padding bisschen lockerer auf Phone */
  .task-row {
    padding: 12px 14px !important;
    align-items: flex-start !important;
  }
  /* Kanban auf Phone: 1 Spalte statt 3 */
  .kanban-grid {
    grid-template-columns: 1fr !important;
  }
}
</style>
