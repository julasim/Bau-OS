<script setup lang="ts">
import { formatDateTime } from "../../utils/format";
// ============================================================
// PATIO — TaskDetail
// ============================================================
// DetailPane einer Task. Status-Cycle, Felder editierbar,
// Loeschen. Empty-State wenn keine Task ausgewaehlt.
// ============================================================

import { ref, watch, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api";
import DetailPane from "../../components/shell/DetailPane.vue";
import StatusDot from "../../components/shell/StatusDot.vue";
import BIcon from "../../components/BIcon.vue";
import { useConfirm } from "../../composables/useConfirm";

const { confirm } = useConfirm();

interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  priority?: string;
  assignee: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  date: string | null;
  location: string | null;
  project: string | null;
  phaseId?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TeamMini {
  id: string;
  name: string;
}

const route = useRoute();
const router = useRouter();
const task = ref<Task | null>(null);
const team = ref<TeamMini[]>([]);
const projects = ref<string[]>([]);
// Leistungsphasen des aktuellen Projekts (fuer das Phase-Dropdown).
const phases = ref<{ id: string; name: string }[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const taskId = computed(() => (route.params.id as string) ?? "");

const STATUS_LABELS: Record<Task["status"], string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};

async function loadTask(id: string) {
  if (!id) {
    task.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    // /tasks/:id ist nicht garantiert vorhanden — fallback ueber /tasks-Liste
    const list = await api.get<Task[]>("/tasks");
    task.value = list.find((t) => t.id === id) ?? null;
    if (!task.value) error.value = "Aufgabe nicht gefunden";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Fehler beim Laden";
    task.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadAux() {
  try {
    [team.value, projects.value] = await Promise.all([
      api.get<TeamMini[]>("/team").catch(() => []),
      api.get<string[]>("/projects").catch(() => []),
    ]);
  } catch {
    /* no-op */
  }
}

async function saveTask() {
  if (!task.value || saving.value) return;
  saving.value = true;
  try {
    const t = task.value;
    const cleanAssignee = typeof t.assignee === "string" && t.assignee !== "[object Object]" ? t.assignee : null;
    await api.put(`/tasks/${t.id}`, {
      text: t.text,
      status: t.status,
      assignee: cleanAssignee,
      assigneeId: t.assigneeId ?? null,
      date: t.date,
      location: t.location,
      project: t.project,
      phaseId: t.phaseId ?? null,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    saving.value = false;
  }
}

async function cycleStatus() {
  if (!task.value) return;
  const next: Record<Task["status"], Task["status"]> = {
    open: "in_progress",
    in_progress: "done",
    done: "open",
  };
  task.value.status = next[task.value.status];
  await saveTask();
}

async function removeTask() {
  if (!task.value) return;
  if (
    !(await confirm({
      message: `Aufgabe „${task.value.text}" wirklich löschen?`,
      confirmDanger: true,
    }))
  )
    return;
  try {
    await api.delete(`/tasks/${task.value.id}`);
    router.push("/tasks");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

function statusToDot(s: Task["status"]): "open" | "doing" | "done" {
  if (s === "open") return "open";
  if (s === "in_progress") return "doing";
  return "done";
}

function onAssigneeChange(memberId: string) {
  if (!task.value) return;
  if (!memberId) {
    task.value.assigneeId = null;
    task.value.assigneeName = null;
  } else {
    const m = team.value.find((x) => x.id === memberId);
    task.value.assigneeId = memberId;
    task.value.assigneeName = m?.name ?? null;
  }
}

// Phasen des aktuell gewaehlten Projekts laden. Wechselt das Projekt, wird die
// Phasen-Zuordnung zurueckgesetzt, falls die alte Phase nicht mehr passt.
async function loadPhasesFor(project: string | null) {
  if (!project) {
    phases.value = [];
    return;
  }
  try {
    const res = await api.get<{ phases: { id: string; name: string }[] }>(
      `/projects/${encodeURIComponent(project)}/phases`,
    );
    phases.value = (res.phases ?? []).map((p) => ({ id: p.id, name: p.name }));
  } catch {
    phases.value = [];
  }
}

// Nutzer wechselt das Projekt im Dropdown → Phasen-Zuordnung loesen (die alte
// Phase gehoert zum alten Projekt). Das Neuladen der Optionen macht der watch.
function onProjectChange() {
  if (task.value) task.value.phaseId = null;
}

watch(taskId, (id) => void loadTask(id), { immediate: true });
// Optionen laden, sobald ein Projekt bekannt ist (Task-Load ODER Dropdown-Wechsel).
watch(
  () => task.value?.project ?? null,
  (project) => void loadPhasesFor(project),
);
loadAux();
</script>

<template>
  <DetailPane>
    <template #crumb>
      <span class="sep">Aufgaben</span>
      <template v-if="task">
        <span class="sep">/</span>
        <span class="here">{{ task.text }}</span>
      </template>
    </template>

    <template #actions v-if="task">
      <!-- Status cycle button -->
      <button class="pt-btn pt-btn--secondary pt-btn--sm" @click="cycleStatus">
        <StatusDot :status="statusToDot(task.status)" />
        {{ STATUS_LABELS[task.status] }}
      </button>
      <!-- Delete -->
      <button class="pt-iconbtn" title="Löschen" @click="removeTask">
        <BIcon name="trash" :size="16" />
      </button>
      <!-- Save -->
      <button
        class="pt-btn pt-btn--primary pt-btn--sm"
        :disabled="saving"
        :class="{ 'is-loading': saving }"
        @click="saveTask"
      >
        {{ saving ? "Speichert…" : "Speichern" }}
      </button>
    </template>

    <!-- Empty — no task selected -->
    <div v-if="!taskId" class="task-empty">
      <p>Wähle eine Aufgabe aus der Liste links.</p>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="task-loading">Lade…</div>

    <!-- Error / Not found -->
    <div v-else-if="error" class="task-error">
      {{ error }}
    </div>

    <!-- Task detail form -->
    <div v-else-if="task" class="task-form">
      <!-- Title field -->
      <div class="pt-field task-field--title">
        <label class="pt-label" for="td-title">Titel</label>
        <input id="td-title" v-model="task.text" class="pt-input task-input--title" />
      </div>

      <!-- Status badge row -->
      <div class="task-status-row">
        <span
          :class="{
            'pt-badge': true,
            'pt-badge--warning': task.status === 'in_progress',
            'pt-badge--success': task.status === 'done',
          }"
        >
          <StatusDot :status="statusToDot(task.status)" />
          {{ STATUS_LABELS[task.status] }}
        </span>
      </div>

      <!-- Fields grid -->
      <div class="task-grid">
        <!-- Assignee -->
        <div class="pt-field">
          <label class="pt-label" for="td-assignee">Verantwortlich</label>
          <select
            id="td-assignee"
            :value="task.assigneeId ?? ''"
            class="pt-select"
            @change="onAssigneeChange(($event.target as HTMLSelectElement).value)"
          >
            <option value="">— niemand —</option>
            <option v-for="m in team" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>

        <!-- Due date -->
        <div class="pt-field">
          <label class="pt-label" for="td-date">Fällig</label>
          <input id="td-date" v-model="task.date" type="date" class="pt-input" />
        </div>

        <!-- Project -->
        <div class="pt-field">
          <label class="pt-label" for="td-project">Projekt</label>
          <select id="td-project" v-model="task.project" class="pt-select" @change="onProjectChange">
            <option :value="null">—</option>
            <option v-for="p in projects" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>

        <!-- Phase (Leistungsphase) — nur wenn Projekt mit Phasen gewählt -->
        <div v-if="task.project && phases.length" class="pt-field">
          <label class="pt-label" for="td-phase">Phase</label>
          <select id="td-phase" v-model="task.phaseId" class="pt-select">
            <option :value="null">—</option>
            <option v-for="ph in phases" :key="ph.id" :value="ph.id">{{ ph.name }}</option>
          </select>
        </div>

        <!-- Location -->
        <div class="pt-field">
          <label class="pt-label" for="td-location">Ort</label>
          <input id="td-location" v-model="task.location" class="pt-input" placeholder="(optional)" />
        </div>
      </div>

      <!-- History panel -->
      <div class="ap-panel" style="margin-top: var(--space-4)">
        <div class="ap-panel-head">
          <span class="ap-panel-title">Verlauf</span>
        </div>
        <div class="ap-panel-body">
          <dl class="task-history">
            <dt>Erstellt</dt>
            <dd>{{ formatDateTime(task.createdAt) }}</dd>
            <dt>Geändert</dt>
            <dd>{{ formatDateTime(task.updatedAt) }}</dd>
            <template v-if="task.completedAt">
              <dt>Erledigt</dt>
              <dd>{{ formatDateTime(task.completedAt) }}</dd>
            </template>
          </dl>
        </div>
      </div>
    </div>
  </DetailPane>
</template>

<style scoped>
/* ── Empty / Loading / Error ──────────────────────────────── */
.task-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-12) var(--space-6);
  text-align: center;
}
.task-empty p {
  font-size: var(--fs-14);
  color: var(--fg-subtle);
  margin: 0;
}

.task-loading {
  padding: var(--space-10) var(--space-6);
  text-align: center;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.task-error {
  margin: var(--space-5);
  padding: var(--space-3) var(--space-4);
  background: var(--danger-bg);
  color: var(--danger-fg);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--fs-13);
}

/* ── Form layout ──────────────────────────────────────────── */
.task-form {
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.task-field--title .pt-label {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--fg-subtle);
  font-weight: var(--fw-medium);
}

.task-input--title {
  height: 44px;
  font-size: var(--fs-18);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-tight);
}

.task-status-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.task-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

/* ── History list ─────────────────────────────────────────── */
.task-history {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: var(--fs-13);
  line-height: var(--lh-normal);
}
.task-history dt {
  color: var(--fg-muted);
}
.task-history dd {
  margin: 0;
  color: var(--fg-body);
}

@media (max-width: 640px) {
  .task-grid {
    grid-template-columns: 1fr;
  }
}
</style>
