<script setup lang="ts">
import { formatWeekdayFull, formatWeekdayShort } from "../utils/format";
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";
import { useCurrentUser } from "../composables/useCurrentUser";
import BIcon from "../components/BIcon.vue";

const { displayName } = useCurrentUser();
// Die Begruessung nutzt nur den Vornamen (erstes Wort des displayName),
// damit "Guten Morgen, Julius." lesbarer ist als "Guten Morgen, Julius Sima.".
const firstName = computed(() => displayName.value.split(/\s+/)[0] || "");

interface DashboardData {
  notes: number;
  openTasks: number;
  totalTasks: number;
  todayTermine: string[];
  termine: number;
  projects: number;
  agents: string[];
}

interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  assignee: string | null;
  date: string | null;
  project?: string | null;
}

interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
}

interface Project {
  name: string;
  status?: string;
  client?: string;
  phase?: string;
  progress?: number;
  tasks?: { open: number; done: number };
  updated?: string;
}

const router = useRouter();
const data = ref<DashboardData | null>(null);
const tasks = ref<Task[]>([]);
const termine = ref<Termin[]>([]);
const projects = ref<Project[]>([]);
const stats = computed(() => ({
  openTasks: data.value?.openTasks ?? 0,
  termine: data.value?.termine ?? 0,
  notes: data.value?.notes ?? 0,
  projects: data.value?.projects ?? 0,
  progressTasks: tasks.value.filter((t) => t.status === "in_progress").length,
}));

// Reaktive Zeit-Werte: werden bei visibilitychange aktualisiert, damit
// Begrüßung und Datumsfilter nach langem Inaktiv-Tab korrekt bleiben.
const today = ref(new Date().toISOString().slice(0, 10));
const todayDE = ref(formatWeekdayFull(new Date()));
const hour = ref(new Date().getHours());
const greeting = computed(() =>
  hour.value < 5 ? "Gute Nacht" : hour.value < 11 ? "Guten Morgen" : hour.value < 18 ? "Guten Tag" : "Guten Abend",
);

const openTasks = computed(() => tasks.value.filter((t) => t.status !== "done").slice(0, 6));
const upcomingTermine = computed(() =>
  termine.value
    .filter((t) => {
      const d = t.datum.includes(".") ? t.datum.split(".").reverse().join("-") : t.datum;
      return d >= today.value;
    })
    .slice(0, 4),
);
// Letzte 4 Projekte (nach Aktualisierung sortiert) — unabhaengig vom Status.
// So sieht der Nutzer auf dem Dashboard immer seine juengste Arbeit.
const recentProjects = computed(() =>
  [...projects.value].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "")).slice(0, 4),
);

async function load() {
  const [d, t, te, ps] = await Promise.all([
    api.get<DashboardData>("/dashboard"),
    api.get<Task[]>("/tasks"),
    api.get<Termin[]>("/termine"),
    api.get<Project[]>("/projects").catch(() => []),
  ]);
  data.value = d;
  tasks.value = t;
  termine.value = te;
  projects.value = ps;
}

function formatDate(d: string) {
  if (d.includes(".")) return d;
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function terminWeekday(datum: string): string {
  const iso = datum.includes(".") ? datum.split(".").reverse().join("-") : datum;
  const d = new Date(iso + "T00:00:00");
  return formatWeekdayShort(d);
}

function terminDay(datum: string): string {
  if (datum.includes(".")) return datum.split(".")[0];
  return datum.split("-")[2];
}

function openPalette() {
  router.push("/search");
}

function refreshTime() {
  const now = new Date();
  today.value = now.toISOString().slice(0, 10);
  todayDE.value = formatWeekdayFull(now);
  hour.value = now.getHours();
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    refreshTime();
    load();
  }
}

onMounted(() => {
  load();
  document.addEventListener("visibilitychange", onVisibilityChange);
});
onUnmounted(() => document.removeEventListener("visibilitychange", onVisibilityChange));
useEvents(["task", "termin", "note", "project"], () => load());

const statCards = computed(() => [
  {
    key: "openTasks",
    label: "Offene Aufgaben",
    value: stats.value.openTasks,
    sub: `${stats.value.progressTasks} in Arbeit`,
    to: "/tasks",
    icon: "check",
  },
  {
    key: "termine",
    label: "Termine",
    value: stats.value.termine,
    sub: "diese Woche",
    to: "/calendar",
    icon: "calendar",
  },
  {
    key: "notes",
    label: "Notizen",
    value: stats.value.notes,
    sub: `${stats.value.projects} Projekte`,
    to: "/notes",
    icon: "file",
  },
]);
</script>

<template>
  <div style="padding: 24px 32px 32px; color: var(--color-text)">
    <!-- Header -->
    <div class="dash-header">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Dashboard</div>
        <h1 class="dash-greeting">{{ greeting }}{{ firstName ? `, ${firstName}` : "" }}.</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 6px; margin-bottom: 0">
          {{ todayDE }} ·
          <span style="color: var(--color-text); font-weight: 500">{{ stats.openTasks }} offene Aufgaben</span>
          · {{ stats.termine }} Termine diese Woche
        </p>
      </div>
      <!-- Quick-Actions: auf Mobile wrappen + Text unter Icon verstecken -->
      <div class="dash-actions">
        <button class="patio-btn ghost dash-action-btn" @click="router.push('/notes')" title="Notiz">
          <BIcon name="file" :size="14" /> <span class="dash-action-label">Notiz</span>
        </button>
        <button class="patio-btn ghost dash-action-btn" @click="router.push('/calendar')" title="Termin">
          <BIcon name="calendar" :size="14" /> <span class="dash-action-label">Termin</span>
        </button>
        <button class="patio-btn ghost dash-action-btn" @click="openPalette" title="Suche">
          <BIcon name="search" :size="14" /> <span class="dash-action-label">Suche</span>
        </button>
        <button class="patio-btn solid dash-action-btn" @click="router.push('/tasks')" title="Aufgabe">
          <BIcon name="plus" :size="14" :stroke-width="2" /> <span class="dash-action-label">Aufgabe</span>
        </button>
      </div>
    </div>

    <!-- Stat-Grid (4 cards) -->
    <div class="grid gap-3 dash-stat-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 28px">
      <router-link v-for="s in statCards" :key="s.key" :to="s.to" class="stat-card">
        <div class="flex items-start justify-between" style="margin-bottom: 14px">
          <BIcon :name="s.icon" :size="16" style="color: var(--color-text-muted)" />
          <BIcon name="arrowUpRight" :size="14" style="color: var(--color-text-faint)" />
        </div>
        <div
          style="font-size: 28px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; color: var(--color-text)"
        >
          {{ s.value }}
        </div>
        <div style="font-size: 12px; color: var(--color-text-secondary); margin-top: 6px">
          {{ s.label }}
        </div>
        <div style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px">
          {{ s.sub }}
        </div>
      </router-link>
    </div>

    <!-- Two-Column: Aufgaben | Termine -->
    <div class="grid gap-5 dash-two-col" style="grid-template-columns: 1.3fr 1fr; margin-bottom: 28px">
      <!-- Aufgaben -->
      <section class="surface-card">
        <div class="flex items-center justify-between" style="margin-bottom: 12px">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--color-text); margin: 0">Offene Aufgaben</h2>
          <router-link
            to="/tasks"
            style="font-size: 11px; color: var(--color-text-muted); text-decoration: none"
            class="hover-link"
            >Alle →</router-link
          >
        </div>
        <div v-if="openTasks.length === 0" class="flex items-center" style="gap: 10px; padding: 8px 0">
          <span style="font-size: 12px; color: var(--color-text-tertiary)">Keine offenen Aufgaben.</span>
          <router-link to="/tasks" class="patio-btn ghost sm" style="text-decoration: none; margin-left: auto">
            <BIcon name="plus" :size="11" :stroke-width="2" /> Anlegen
          </router-link>
        </div>
        <div v-else class="divide-y" style="--tw-divide-opacity: 1">
          <div
            v-for="task in openTasks"
            :key="task.id"
            class="flex items-center"
            style="gap: 10px; padding: 8px 0; border-top: 1px solid var(--color-border-subtle)"
          >
            <span
              :style="{
                width: '14px',
                height: '14px',
                borderRadius: '4px',
                flexShrink: 0,
                background: task.status === 'in_progress' ? 'var(--color-warning)' : 'transparent',
                border:
                  task.status === 'in_progress'
                    ? '1px solid var(--color-warning)'
                    : '1px solid var(--color-text-faint)',
              }"
            />
            <div class="flex-1 min-w-0">
              <div style="font-size: 13px; color: var(--color-text-secondary)" class="truncate">
                {{ task.text }}
              </div>
              <div
                class="flex items-center"
                style="gap: 8px; font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px"
              >
                <span v-if="task.project">{{ task.project }}</span>
                <span v-if="task.date" class="font-mono">{{ formatDate(task.date) }}</span>
                <span v-if="task.assignee">{{ task.assignee }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Naechste Termine -->
      <section class="surface-card">
        <div class="flex items-center justify-between" style="margin-bottom: 12px">
          <h2 style="font-size: 13px; font-weight: 600; color: var(--color-text); margin: 0">Naechste Termine</h2>
          <router-link
            to="/calendar"
            style="font-size: 11px; color: var(--color-text-muted); text-decoration: none"
            class="hover-link"
            >Kalender →</router-link
          >
        </div>
        <div v-if="upcomingTermine.length === 0" style="font-size: 12px; color: var(--color-text-tertiary)">
          Keine anstehenden Termine.
          <router-link
            to="/calendar"
            style="
              display: inline-block;
              margin-top: 6px;
              font-size: 11px;
              color: var(--color-primary);
              text-decoration: none;
            "
            >→ Zum Kalender</router-link
          >
        </div>
        <div v-else>
          <div
            v-for="t in upcomingTermine"
            :key="t.id"
            class="flex items-start"
            style="gap: 12px; padding: 10px 0; border-top: 1px solid var(--color-border-subtle)"
          >
            <div class="flex-shrink-0 text-center" style="width: 44px">
              <div class="eyebrow" style="font-size: 9px">{{ terminWeekday(t.datum) }}</div>
              <div
                style="
                  font-size: 18px;
                  font-weight: 600;
                  color: var(--color-text);
                  line-height: 1.2;
                  letter-spacing: -0.02em;
                "
              >
                {{ terminDay(t.datum) }}
              </div>
              <div v-if="t.uhrzeit" class="font-mono" style="font-size: 10px; color: var(--color-text-muted)">
                {{ t.uhrzeit }}
              </div>
            </div>
            <div style="width: 1px; align-self: stretch; background: var(--color-border-subtle)" />
            <div class="flex-1 min-w-0">
              <div style="font-size: 13px; color: var(--color-text); font-weight: 500" class="truncate">
                {{ t.text }}
              </div>
              <div
                class="flex items-center"
                style="gap: 8px; font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px"
              >
                <span v-if="t.location">{{ t.location }}</span>
                <span v-if="t.endzeit" class="font-mono">bis {{ t.endzeit }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Letzte Projekte -->
    <section>
      <div class="flex items-center justify-between" style="margin-bottom: 12px">
        <h2 style="font-size: 13px; font-weight: 600; color: var(--color-text); margin: 0">Letzte Projekte</h2>
        <router-link
          to="/projects"
          style="font-size: 11px; color: var(--color-text-muted); text-decoration: none"
          class="hover-link"
          >Alle Projekte →</router-link
        >
      </div>
      <div
        v-if="recentProjects.length === 0"
        class="empty-state"
        style="border: 1px dashed var(--color-border); border-radius: 8px"
      >
        <div class="empty-state-icon"><BIcon name="folder" :size="26" /></div>
        <div class="empty-state-text">Noch keine Projekte angelegt.</div>
        <router-link to="/projects" class="patio-btn solid sm" style="text-decoration: none">
          <BIcon name="plus" :size="11" :stroke-width="2" />
          Erstes Projekt anlegen
        </router-link>
      </div>
      <div v-else class="grid gap-3 dash-projects-grid" style="grid-template-columns: repeat(4, 1fr)">
        <router-link
          v-for="p in recentProjects"
          :key="p.name"
          :to="`/projects/${encodeURIComponent(p.name)}`"
          class="surface-card hover-card"
        >
          <div class="flex items-center justify-between" style="margin-bottom: 10px">
            <span class="pill pill-success">aktiv</span>
            <span v-if="p.updated" class="font-mono" style="font-size: 10px; color: var(--color-text-tertiary)">{{
              p.updated
            }}</span>
          </div>
          <div style="font-size: 14px; font-weight: 600; color: var(--color-text); margin-bottom: 4px">
            {{ p.name }}
          </div>
          <div v-if="p.client || p.phase" style="font-size: 11px; color: var(--color-text-muted); margin-bottom: 12px">
            {{ [p.client, p.phase].filter(Boolean).join(" · ") }}
          </div>
          <div style="height: 2px; background: var(--color-border-subtle); border-radius: 2px; overflow: hidden">
            <div
              :style="{
                width: `${p.progress ?? 0}%`,
                height: '100%',
                background: 'var(--color-accent)',
              }"
            />
          </div>
          <div
            class="flex items-center justify-between"
            style="margin-top: 8px; font-size: 10px; color: var(--color-text-tertiary)"
          >
            <span>{{ p.progress ?? 0 }} % abgeschlossen</span>
            <span v-if="p.tasks">{{ p.tasks.open }} offen · {{ p.tasks.done }} erledigt</span>
          </div>
        </router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stat-card {
  display: block;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--color-bg);
  color: inherit;
  text-decoration: none;
  transition:
    border-color 180ms ease,
    background 180ms ease;
}
.stat-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}

.surface-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px 18px;
  background: var(--color-bg);
}
.hover-card {
  text-decoration: none;
  color: inherit;
  transition:
    border-color 180ms ease,
    background 180ms ease;
}
.hover-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}
.hover-link {
  transition: color 180ms ease;
}
.hover-link:hover {
  color: var(--color-text) !important;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid transparent;
}
.pill-success {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-border);
}

/* ── Mobile (Phase 1B) — Header + Grids stapeln ─────────── */
.dash-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}
.dash-greeting {
  font-size: 28px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
  color: var(--color-text);
}
.dash-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

@media (max-width: 1023.98px) {
  /* Tasks/Termine 2-Col → 1-Col */
  .dash-two-col {
    grid-template-columns: 1fr !important;
  }
  /* Projekte: 4 → 2 */
  .dash-projects-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}

@media (max-width: 767.98px) {
  /* Header: Quick-Actions unter den Greeting-Block stapeln */
  .dash-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    margin-bottom: 20px;
  }
  .dash-greeting {
    font-size: 22px;
  }
  .dash-actions {
    flex-wrap: wrap;
  }
  /* Action-Buttons: Text raus, nur Icons (kompakt) */
  .dash-action-btn {
    padding: 8px 10px;
    min-width: 38px;
    justify-content: center;
  }
  .dash-action-label {
    display: none;
  }
  /* Stat-Grid 4 → 2 */
  .dash-stat-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
  /* Projekte 2 → 1 */
  .dash-projects-grid {
    grid-template-columns: 1fr !important;
  }
}

@media (max-width: 380px) {
  /* Auf super-kleinen Phones: Stat-Grid in 1 Spalte */
  .dash-stat-grid {
    grid-template-columns: 1fr !important;
  }
}
</style>
