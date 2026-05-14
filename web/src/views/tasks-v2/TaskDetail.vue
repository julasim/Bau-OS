<script setup lang="ts">
// ============================================================
// Bau-OS Workspace v2 — TaskDetail
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

watch(taskId, (id) => void loadTask(id), { immediate: true });
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
      <button class="v2-btn" @click="cycleStatus">
        <StatusDot :status="statusToDot(task.status)" />
        {{ STATUS_LABELS[task.status] }}
      </button>
      <button class="v2-icon-btn" title="Löschen" @click="removeTask">
        <BIcon name="trash" :size="14" />
      </button>
      <button class="v2-btn v2-btn-primary" :disabled="saving" :style="{ opacity: saving ? 0.5 : 1 }" @click="saveTask">
        {{ saving ? "Speichert…" : "Speichern" }}
      </button>
    </template>

    <!-- Empty -->
    <div
      v-if="!taskId"
      style="
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: var(--fg-muted);
      "
    >
      <BIcon name="check" :size="32" />
      <div style="font-size: 14px">Wähle eine Aufgabe aus der Liste links</div>
      <div style="font-size: 12px; color: var(--fg-subtle)">oder lege mit dem Quick-Add unten eine neue an</div>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" style="padding: 40px; text-align: center; color: var(--fg-muted)">Lade…</div>

    <!-- Not found / Error -->
    <div
      v-else-if="error"
      style="
        padding: 12px 16px;
        background: var(--status-error-bg);
        color: var(--status-error);
        border: 1px solid var(--status-error);
        border-radius: 6px;
      "
    >
      {{ error }}
    </div>

    <!-- Task-Detail-Form -->
    <div v-else-if="task" style="max-width: 720px">
      <!-- Title -->
      <div style="margin-bottom: 24px">
        <label class="h-eyebrow">Titel</label>
        <input
          v-model="task.text"
          style="
            width: 100%;
            padding: 10px 14px;
            border: 1px solid var(--border-default);
            border-radius: 8px;
            background: var(--bg-app);
            color: var(--fg-primary);
            font-size: 18px;
            font-weight: 500;
            outline: none;
          "
        />
      </div>

      <!-- Felder-Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px">
        <div>
          <label class="h-eyebrow">Verantwortlich</label>
          <select
            :value="task.assigneeId ?? ''"
            @change="onAssigneeChange(($event.target as HTMLSelectElement).value)"
            style="
              width: 100%;
              padding: 8px 10px;
              border: 1px solid var(--border-default);
              border-radius: 6px;
              background: var(--bg-app);
              color: var(--fg-primary);
              font-size: 13px;
            "
          >
            <option value="">— niemand —</option>
            <option v-for="m in team" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div>
          <label class="h-eyebrow">Fällig</label>
          <input
            v-model="task.date"
            type="date"
            style="
              width: 100%;
              padding: 8px 10px;
              border: 1px solid var(--border-default);
              border-radius: 6px;
              background: var(--bg-app);
              color: var(--fg-primary);
              font-size: 13px;
            "
          />
        </div>
        <div>
          <label class="h-eyebrow">Projekt</label>
          <select
            v-model="task.project"
            style="
              width: 100%;
              padding: 8px 10px;
              border: 1px solid var(--border-default);
              border-radius: 6px;
              background: var(--bg-app);
              color: var(--fg-primary);
              font-size: 13px;
            "
          >
            <option :value="null">—</option>
            <option v-for="p in projects" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div>
          <label class="h-eyebrow">Ort</label>
          <input
            v-model="task.location"
            placeholder="(optional)"
            style="
              width: 100%;
              padding: 8px 10px;
              border: 1px solid var(--border-default);
              border-radius: 6px;
              background: var(--bg-app);
              color: var(--fg-primary);
              font-size: 13px;
            "
          />
        </div>
      </div>

      <!-- Meta -->
      <div class="v2-card v2-card-pad" style="margin-top: 8px">
        <div class="h-eyebrow">Verlauf</div>
        <div class="text-xs" style="color: var(--fg-muted); margin-top: 6px; line-height: 1.7">
          <div>Erstellt: {{ new Date(task.createdAt).toLocaleString("de-AT") }}</div>
          <div>Zuletzt geändert: {{ new Date(task.updatedAt).toLocaleString("de-AT") }}</div>
          <div v-if="task.completedAt">Erledigt: {{ new Date(task.completedAt).toLocaleString("de-AT") }}</div>
        </div>
      </div>
    </div>
  </DetailPane>
</template>
