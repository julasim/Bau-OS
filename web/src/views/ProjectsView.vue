<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";

interface ProjectInfo {
  id?: string;
  name: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  // Stammdaten (Migration 004) — in Phase 4 in Karten-Preview + Filter aktiv.
  projektnummer?: string | null;
  bauherr?: string | null;
  standort?: string | null;
  projektart?: string | null;
  nutzung?: string | null;
  phase?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  // Verknuepfungen (Migration 005)
  parentId?: string | null;
  parentName?: string | null;
  childrenCount?: number;
  // Phase 3 ACL
  createdById?: string | null;
  createdByUsername?: string | null;
  notes: number;
  openTasks: number;
  doneTasks?: number;
  termine: number;
  files?: number;
  createdAt?: string;
  updatedAt?: string;
}

const router = useRouter();
const projects = ref<ProjectInfo[]>([]);
const searchQuery = ref("");
const viewMode = ref<"grid" | "list" | "kanban">("grid");

// ── Filter (Phase 4) ─────────────────────────────────────
// Alle Filter sind "alle" = leerer String — matchen ohne Einschraenkung.
const filterStatus = ref<string>("aktiv"); // Default: nur aktive — archivierte stoeren meistens nur.
const filterProjektart = ref<string>("");
const filterPhase = ref<string>("");

// ── Sortierung ───────────────────────────────────────────
type SortKey = "updated" | "name" | "nummer" | "created";
const sortKey = ref<SortKey>("updated");

// Eindeutige Werte aus den Projektdaten — so passen sich die Dropdowns
// automatisch an, was der User wirklich nutzt.
function uniqueValues(key: keyof ProjectInfo): string[] {
  const set = new Set<string>();
  for (const p of projects.value) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
const projektartOptions = computed(() => uniqueValues("projektart"));
const phaseOptions = computed(() => uniqueValues("phase"));

const filtered = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  const list = projects.value.filter((p) => {
    if (filterStatus.value && p.status !== filterStatus.value) return false;
    if (filterProjektart.value && p.projektart !== filterProjektart.value) return false;
    if (filterPhase.value && p.phase !== filterPhase.value) return false;
    if (!q) return true;
    // Freitext sucht ueber Name, Beschreibung, Projektnummer, Bauherr, Standort.
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false) ||
      (p.projektnummer?.toLowerCase().includes(q) ?? false) ||
      (p.bauherr?.toLowerCase().includes(q) ?? false) ||
      (p.standort?.toLowerCase().includes(q) ?? false)
    );
  });

  // Sortierung — toSorted wuerde nicht alle Browser abdecken, also spread + sort.
  const sorted = [...list];
  switch (sortKey.value) {
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name, "de"));
      break;
    case "nummer":
      sorted.sort((a, b) => {
        // Projekte ohne Nummer ans Ende.
        const an = a.projektnummer?.trim();
        const bn = b.projektnummer?.trim();
        if (!an && !bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn, "de", { numeric: true });
      });
      break;
    case "created":
      sorted.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      break;
    case "updated":
    default:
      sorted.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return sorted;
});

const anyFilterActive = computed(
  () =>
    !!searchQuery.value.trim() ||
    !!filterProjektart.value ||
    !!filterPhase.value ||
    filterStatus.value !== "aktiv",
);

function resetFilters() {
  searchQuery.value = "";
  filterStatus.value = "aktiv";
  filterProjektart.value = "";
  filterPhase.value = "";
}

// ── Neues Projekt Dialog ─────────────────────────────────
const showCreateDialog = ref(false);
const createSaving = ref(false);
const createError = ref<string | null>(null);
const createForm = ref({
  name: "",
  description: "",
  projektnummer: "",
  bauherr: "",
  standort: "",
  projektart: "",
  nutzung: "",
  phase: "",
  startDate: "",
  endDate: "",
});
const PROJEKTART_OPTIONS = ["", "Neubau", "Umbau", "Sanierung", "Zubau"] as const;

function openCreateDialog() {
  showCreateDialog.value = true;
  createError.value = null;
  createForm.value = {
    name: "",
    description: "",
    projektnummer: "",
    bauherr: "",
    standort: "",
    projektart: "",
    nutzung: "",
    phase: "",
    startDate: "",
    endDate: "",
  };
}

function closeCreateDialog() {
  if (createSaving.value) return;
  showCreateDialog.value = false;
}

async function submitCreate() {
  const name = createForm.value.name.trim();
  if (!name || createSaving.value) return;

  // Name-Duplikat client-seitig abfangen: create() ist zwar idempotent, aber
  // der User will hier explizit ein NEUES Projekt — ein Dialog, der lautlos
  // ein bestehendes Projekt patcht, ist verwirrend.
  if (projects.value.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    createError.value = "Ein Projekt mit diesem Namen existiert bereits.";
    return;
  }

  createSaving.value = true;
  createError.value = null;
  try {
    // Leere Strings werden serverseitig zu null — wir muessen nichts filtern.
    const payload = { ...createForm.value, name };
    const created = await api.post<ProjectInfo>("/projects", payload);
    showCreateDialog.value = false;
    // Direkt ins neu angelegte Projekt navigieren — Stammdaten sind schon gesetzt.
    router.push(`/projects/${encodeURIComponent(created.name)}`);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  } finally {
    createSaving.value = false;
  }
}

function formatDate(iso?: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function relativeTime(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `vor ${hrs} Std`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `vor ${days} Tagen`;
  return formatDate(iso);
}

function statusLabel(s?: string) {
  if (!s) return "";
  const map: Record<string, string> = { aktiv: "Aktiv", archiviert: "Archiviert", pausiert: "Pausiert" };
  return map[s] || s;
}

// ── Fortschritt: openTasks + doneTasks ───────────────────
// Nur sinnvoll, wenn ueberhaupt Aufgaben da sind.
function taskTotal(p: ProjectInfo): number {
  return p.openTasks + (p.doneTasks ?? 0);
}
function taskProgress(p: ProjectInfo): number {
  const total = taskTotal(p);
  if (total === 0) return 0;
  return Math.round(((p.doneTasks ?? 0) / total) * 100);
}

function mapsLink(standort: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(standort)}`;
}

// ── Kanban: gruppieren nach Phase ────────────────────────
// Projekte ohne Phase landen in der Spalte "Ohne Phase" — damit nichts
// "verloren" geht. Spalten-Reihenfolge: erst der "Ohne"-Bucket, dann die
// vorhandenen Phasen alphabetisch (oder in definierter Reihenfolge).
const KANBAN_ORDER = ["Vorentwurf", "Einreichung", "Ausführung", "Baubetreuung", "Abgeschlossen"];

const kanbanColumns = computed<{ phase: string; items: ProjectInfo[] }[]>(() => {
  const map = new Map<string, ProjectInfo[]>();
  for (const p of filtered.value) {
    const key = p.phase?.trim() || "Ohne Phase";
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  // Sortierung: bekannte Phasen zuerst in vorgegebener Reihenfolge, dann
  // unbekannte alphabetisch, "Ohne Phase" immer ganz am Ende.
  const keys = Array.from(map.keys());
  const known = KANBAN_ORDER.filter((k) => map.has(k));
  const unknown = keys
    .filter((k) => k !== "Ohne Phase" && !KANBAN_ORDER.includes(k))
    .sort((a, b) => a.localeCompare(b, "de"));
  const ordered = [...known, ...unknown];
  if (map.has("Ohne Phase")) ordered.push("Ohne Phase");
  return ordered.map((phase) => ({ phase, items: map.get(phase) ?? [] }));
});

// Drei-Zustand-Toggle fuer ViewMode
function cycleViewMode() {
  viewMode.value = viewMode.value === "grid" ? "list" : viewMode.value === "list" ? "kanban" : "grid";
}
function viewModeLabel() {
  return viewMode.value === "grid" ? "Liste" : viewMode.value === "list" ? "Kanban" : "Kacheln";
}
function viewModeIcon() {
  return viewMode.value === "grid" ? "list" : viewMode.value === "list" ? "kanban" : "grid";
}

// ── Drag-&-Drop im Kanban ────────────────────────────────
// Karten per Drag & Drop zwischen Phasen-Spalten verschieben → Patch der
// phase-Spalte. "Ohne Phase" als Drop-Ziel setzt phase auf null.
// Kein externes DnD-Lib — wir brauchen nur das Grundmuster: dragstart auf
// Karte, dragover auf Spalte (mit preventDefault), drop auf Spalte.
const draggingProjectName = ref<string | null>(null);
const dragOverPhase = ref<string | null>(null);

function onCardDragStart(e: DragEvent, p: ProjectInfo) {
  draggingProjectName.value = p.name;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    // Minimal-Payload fuer Tools, die den Text-Type erwarten.
    e.dataTransfer.setData("text/plain", p.name);
  }
}
function onCardDragEnd() {
  draggingProjectName.value = null;
  dragOverPhase.value = null;
}
function onColumnDragOver(e: DragEvent, phase: string) {
  // preventDefault ist essentiell — sonst erlaubt der Browser kein drop.
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dragOverPhase.value = phase;
}
function onColumnDragLeave(phase: string) {
  if (dragOverPhase.value === phase) dragOverPhase.value = null;
}
async function onColumnDrop(e: DragEvent, phase: string) {
  e.preventDefault();
  const name = draggingProjectName.value;
  draggingProjectName.value = null;
  dragOverPhase.value = null;
  if (!name) return;
  const project = projects.value.find((p) => p.name === name);
  if (!project) return;
  const newPhase = phase === "Ohne Phase" ? null : phase;
  if ((project.phase ?? null) === newPhase) return; // kein Change
  // Optimistisches Update — Kanban wirkt sofort, Rollback bei Fehler.
  const before = project.phase;
  project.phase = newPhase;
  try {
    await api.patch(`/projects/${encodeURIComponent(name)}`, { phase: newPhase });
  } catch {
    project.phase = before ?? null;
  }
}

onMounted(async () => {
  projects.value = await api.get<ProjectInfo[]>("/projects");
});
</script>

<template>
  <div style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)">
    <!-- Header -->
    <div class="flex items-end justify-between gap-4" style="margin-bottom: 20px">
      <div class="min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Arbeit</div>
        <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Projekte</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ projects.length }} Projekte
        </p>
      </div>
      <div class="flex items-center" style="gap: 8px">
        <button @click="cycleViewMode" class="bauos-btn ghost">
          <BIcon :name="viewModeIcon()" :size="14" />
          {{ viewModeLabel() }}
        </button>
        <button @click="openCreateDialog" class="bauos-btn solid">
          <BIcon name="plus" :size="14" />
          <span style="margin-left: 4px">Neues Projekt</span>
        </button>
      </div>
    </div>

    <!-- Filter-Bar -->
    <div v-if="projects.length > 3" class="filter-bar">
      <div
        class="flex items-center"
        style="
          gap: 8px;
          padding: 6px 12px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-bg);
        "
      >
        <BIcon name="search" :size="14" style="color: var(--color-text-muted)" />
        <input
          v-model="searchQuery"
          placeholder="Name, Nummer, Bauherr, Standort…"
          style="
            flex: 1;
            border: none;
            outline: none;
            background: transparent;
            font-size: 13px;
            color: var(--color-text);
          "
        />
        <span style="font-size: 11px; color: var(--color-text-tertiary)">
          {{ filtered.length }} / {{ projects.length }}
        </span>
      </div>

      <!-- Dropdowns — nur anzeigen, wenn es ueberhaupt Werte zum Filtern gibt. -->
      <select v-model="filterStatus" class="filter-select">
        <option value="">Alle Status</option>
        <option value="aktiv">Aktiv</option>
        <option value="pausiert">Pausiert</option>
        <option value="archiviert">Archiviert</option>
      </select>
      <select
        v-if="projektartOptions.length > 0"
        v-model="filterProjektart"
        class="filter-select"
      >
        <option value="">Alle Projektarten</option>
        <option v-for="opt in projektartOptions" :key="opt" :value="opt">{{ opt }}</option>
      </select>
      <select v-if="phaseOptions.length > 0" v-model="filterPhase" class="filter-select">
        <option value="">Alle Phasen</option>
        <option v-for="opt in phaseOptions" :key="opt" :value="opt">{{ opt }}</option>
      </select>
      <select v-model="sortKey" class="filter-select" :title="'Sortieren nach…'">
        <option value="updated">Zuletzt geändert</option>
        <option value="created">Neu angelegt</option>
        <option value="name">Name (A–Z)</option>
        <option value="nummer">Projektnummer</option>
      </select>
      <button
        v-if="anyFilterActive"
        @click="resetFilters"
        class="bauos-btn ghost"
        style="padding: 4px 10px; font-size: 11px"
      >
        Filter zurücksetzen
      </button>
    </div>

    <!-- Grid -->
    <div v-if="viewMode === 'grid'" class="grid proj-grid" style="grid-template-columns: repeat(3, 1fr); gap: 12px">
      <div
        v-for="p in filtered"
        :key="p.name"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
        class="proj-card"
        :class="{ 'proj-card-accent': !!p.color }"
        :style="p.color ? { '--accent-color': p.color } : {}"
      >
        <div class="flex items-center justify-between" style="margin-bottom: 10px">
          <div class="flex items-center" style="gap: 6px; min-width: 0">
            <span
              v-if="p.status"
              :class="['pill', `pill-${p.status}`]"
              style="font-size: 10px"
              >{{ statusLabel(p.status) }}</span
            >
            <span
              v-if="p.projektnummer"
              class="font-mono"
              style="font-size: 10px; color: var(--color-text-muted); letter-spacing: 0.02em"
              >#{{ p.projektnummer }}</span
            >
          </div>
          <span
            v-if="p.updatedAt"
            class="font-mono"
            style="font-size: 10px; color: var(--color-text-tertiary)"
            >{{ relativeTime(p.updatedAt) }}</span
          >
        </div>
        <!-- Parent-Breadcrumb, wenn Sub-Projekt. Klick navigiert zum Parent. -->
        <div
          v-if="p.parentName"
          class="card-parent-crumb"
          @click.stop="router.push(`/projects/${encodeURIComponent(p.parentName)}`)"
        >
          <BIcon name="layers" :size="10" />
          <span>{{ p.parentName }}</span>
          <span style="opacity: 0.5">/</span>
        </div>
        <!-- Phase 3: angelegt-von kommt nur, wenn Username vorhanden ist. -->
        <div
          v-if="p.createdByUsername"
          style="font-size: 10px; color: var(--color-text-faint); margin-bottom: 4px; letter-spacing: 0.04em; text-transform: uppercase"
        >
          von {{ p.createdByUsername }}
        </div>
        <div style="font-size: 15px; font-weight: 600; color: var(--color-text); margin-bottom: 4px">
          {{ p.name }}
        </div>
        <!-- Kontextzeile aus Stammdaten — ersetzt description, wenn welche da sind;
             description faellt darunter, knapp, nur wenn vorhanden. -->
        <p
          v-if="p.bauherr || p.standort"
          style="
            font-size: 12px;
            color: var(--color-text-secondary);
            margin: 0 0 6px 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          "
        >
          <span v-if="p.bauherr">{{ p.bauherr }}</span>
          <span v-if="p.bauherr && p.standort"> · </span>
          <span v-if="p.standort">{{ p.standort }}</span>
        </p>
        <p
          v-if="p.description"
          class="card-description"
        >
          {{ p.description }}
        </p>
        <div v-else-if="!p.bauherr && !p.standort" style="min-height: 18px; margin-bottom: 10px"></div>

        <!-- Chips fuer Projektart + Phase — nur wenn gesetzt, sonst unsichtbar -->
        <div
          v-if="p.projektart || p.phase"
          class="flex items-center"
          style="gap: 4px; margin-bottom: 12px; flex-wrap: wrap"
        >
          <span v-if="p.projektart" class="card-chip">{{ p.projektart }}</span>
          <span v-if="p.phase" class="card-chip card-chip-phase">{{ p.phase }}</span>
        </div>

        <div
          class="flex items-center"
          style="gap: 12px; font-size: 11px; color: var(--color-text-muted)"
        >
          <span>{{ p.notes }} Notizen</span>
          <span :style="{ color: p.openTasks > 0 ? 'var(--color-warning-text)' : 'inherit' }">
            {{ p.openTasks }} Aufgaben
          </span>
          <span>{{ p.termine }} Termine</span>
          <span
            v-if="p.childrenCount && p.childrenCount > 0"
            style="margin-left: auto; color: var(--color-text-secondary)"
            :title="'Unterprojekte'"
          >
            <BIcon name="layers" :size="10" />
            {{ p.childrenCount }}
          </span>
        </div>

        <!-- Fortschritts-Balken — nur, wenn ueberhaupt Aufgaben existieren. -->
        <div v-if="taskTotal(p) > 0" class="progress-wrap" :title="`${p.doneTasks ?? 0} von ${taskTotal(p)} Aufgaben erledigt`">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: taskProgress(p) + '%' }"></div>
          </div>
          <span class="progress-label">{{ taskProgress(p) }}%</span>
        </div>
      </div>
      <p
        v-if="filtered.length === 0"
        style="
          grid-column: 1 / -1;
          font-size: 13px;
          color: var(--color-text-tertiary);
          text-align: center;
          padding: 32px 0;
        "
      >
        {{ searchQuery ? "Keine Treffer." : "Keine Projekte vorhanden." }}
      </p>
    </div>

    <!-- Kanban (nach Phase) -->
    <div v-else-if="viewMode === 'kanban'" class="kanban-board">
      <div
        v-for="col in kanbanColumns"
        :key="col.phase"
        class="kanban-col"
        :class="{ 'kanban-col-drop': dragOverPhase === col.phase }"
        @dragover="onColumnDragOver($event, col.phase)"
        @dragleave="onColumnDragLeave(col.phase)"
        @drop="onColumnDrop($event, col.phase)"
      >
        <div class="kanban-col-head">
          <span class="kanban-col-title">{{ col.phase }}</span>
          <span class="kanban-col-count">{{ col.items.length }}</span>
        </div>
        <div
          v-for="p in col.items"
          :key="p.name"
          class="kanban-card"
          :class="{
            'proj-card-accent': !!p.color,
            'kanban-card-dragging': draggingProjectName === p.name,
          }"
          :style="p.color ? { '--accent-color': p.color } : {}"
          draggable="true"
          @dragstart="onCardDragStart($event, p)"
          @dragend="onCardDragEnd"
          @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
        >
          <div class="flex items-center justify-between" style="margin-bottom: 6px; gap: 8px">
            <span v-if="p.projektnummer" class="font-mono" style="font-size: 10px; color: var(--color-text-muted)">
              #{{ p.projektnummer }}
            </span>
            <span v-if="p.status && p.status !== 'aktiv'" :class="['pill', `pill-${p.status}`]" style="font-size: 9px">
              {{ statusLabel(p.status) }}
            </span>
          </div>
          <div class="kanban-name">{{ p.name }}</div>
          <div v-if="p.bauherr" class="kanban-sub">{{ p.bauherr }}</div>
          <div
            v-if="p.openTasks > 0"
            class="kanban-meta"
            :style="{ color: p.openTasks > 0 ? 'var(--color-warning-text)' : 'var(--color-text-muted)' }"
          >
            {{ p.openTasks }} offene Aufgabe<span v-if="p.openTasks !== 1">n</span>
          </div>
          <div v-if="taskTotal(p) > 0" class="progress-wrap" style="margin-top: 8px">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: taskProgress(p) + '%' }"></div>
            </div>
          </div>
        </div>
        <p v-if="col.items.length === 0" class="kanban-empty">—</p>
      </div>
    </div>

    <!-- List -->
    <!-- Mobile: outer wrapper scrollt horizontal, inner mit min-width -->
    <div v-else class="proj-list-wrap" style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
     <div class="proj-list-inner">
      <div
        class="flex items-center"
        style="
          gap: 12px;
          padding: 10px 16px;
          background: var(--color-bg-subtle);
          border-bottom: 1px solid var(--color-border);
        "
      >
        <span class="eyebrow" style="width: 80px">Nr.</span>
        <span class="eyebrow flex-1">Projekt</span>
        <span class="eyebrow" style="width: 120px">Bauherr</span>
        <span class="eyebrow" style="width: 100px">Projektart</span>
        <span class="eyebrow" style="width: 80px">Status</span>
        <span class="eyebrow" style="width: 60px; text-align: center">Aufgaben</span>
        <span class="eyebrow" style="width: 90px; text-align: right">Geändert</span>
      </div>
      <div
        v-for="p in filtered"
        :key="p.name"
        class="proj-row flex items-center"
        style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
      >
        <span
          class="font-mono"
          style="width: 80px; font-size: 11px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
        >
          {{ p.projektnummer || "—" }}
        </span>
        <div class="flex-1 min-w-0 flex items-center" style="gap: 8px">
          <BIcon name="folder" :size="14" style="color: var(--color-text-muted); flex-shrink: 0" />
          <span style="font-size: 13px; color: var(--color-text)" class="truncate">{{ p.name }}</span>
        </div>
        <span
          style="width: 120px; font-size: 12px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
        >
          {{ p.bauherr || "—" }}
        </span>
        <span
          style="width: 100px; font-size: 11px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
        >
          {{ p.projektart || "—" }}
        </span>
        <div style="width: 80px">
          <span
            v-if="p.status"
            :class="['pill', `pill-${p.status}`]"
            style="font-size: 10px"
            >{{ statusLabel(p.status) }}</span
          >
        </div>
        <span
          style="width: 60px; text-align: center; font-size: 11px"
          :style="{ color: p.openTasks > 0 ? 'var(--color-warning-text)' : 'var(--color-text-muted)' }"
        >
          {{ p.openTasks }}
        </span>
        <span
          class="font-mono"
          style="width: 90px; text-align: right; font-size: 11px; color: var(--color-text-tertiary)"
        >
          {{ formatDate(p.updatedAt) }}
        </span>
      </div>
      <p
        v-if="filtered.length === 0"
        style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 32px 0"
      >
        {{ anyFilterActive ? "Keine Treffer." : "Keine Projekte vorhanden." }}
      </p>
     </div>
    </div>

    <!-- ═══ Neues-Projekt-Dialog (Phase 4) ═══════════════ -->
    <div v-if="showCreateDialog" class="modal-overlay" @click.self="closeCreateDialog">
      <div class="modal-card" @keydown.esc="closeCreateDialog">
        <div class="flex items-center justify-between" style="margin-bottom: 16px">
          <div>
            <div class="eyebrow" style="margin-bottom: 4px">Neu</div>
            <h2 style="font-size: 18px; font-weight: 600; margin: 0; color: var(--color-text)">
              Projekt anlegen
            </h2>
          </div>
          <button class="modal-close" @click="closeCreateDialog" :disabled="createSaving">
            <BIcon name="x" :size="14" />
          </button>
        </div>

        <div class="form-grid">
          <label class="form-field form-field-span-2">
            <span class="eyebrow">Name *</span>
            <input
              v-model="createForm.name"
              type="text"
              placeholder="z.B. Wohnhaus Huber"
              class="form-input-lg"
              @keyup.enter="submitCreate"
              autofocus
            />
          </label>

          <label class="form-field">
            <span class="eyebrow">Projektnummer</span>
            <input
              v-model="createForm.projektnummer"
              type="text"
              placeholder="2026-037"
              class="form-input-lg"
            />
          </label>

          <label class="form-field">
            <span class="eyebrow">Projektart</span>
            <select v-model="createForm.projektart" class="form-input-lg">
              <option v-for="opt in PROJEKTART_OPTIONS" :key="opt" :value="opt">
                {{ opt || "—" }}
              </option>
            </select>
          </label>

          <label class="form-field">
            <span class="eyebrow">Bauherr</span>
            <input
              v-model="createForm.bauherr"
              type="text"
              placeholder="Name + Kontakt"
              class="form-input-lg"
            />
          </label>

          <label class="form-field">
            <span class="eyebrow">Standort</span>
            <input
              v-model="createForm.standort"
              type="text"
              placeholder="Ort / Adresse"
              class="form-input-lg"
            />
          </label>

          <label class="form-field">
            <span class="eyebrow">Nutzung</span>
            <input
              v-model="createForm.nutzung"
              type="text"
              placeholder="z.B. Wohnbau"
              class="form-input-lg"
            />
          </label>

          <label class="form-field">
            <span class="eyebrow">Phase</span>
            <input
              v-model="createForm.phase"
              type="text"
              placeholder="z.B. Vorentwurf"
              class="form-input-lg"
            />
          </label>

          <label class="form-field">
            <span class="eyebrow">Start</span>
            <input v-model="createForm.startDate" type="date" class="form-input-lg" />
          </label>

          <label class="form-field">
            <span class="eyebrow">Ende</span>
            <input v-model="createForm.endDate" type="date" class="form-input-lg" />
          </label>

          <label class="form-field form-field-span-2">
            <span class="eyebrow">Beschreibung</span>
            <textarea
              v-model="createForm.description"
              rows="2"
              placeholder="Kurze Beschreibung (optional)"
              class="form-input-lg"
              style="resize: vertical; font-family: inherit; line-height: 1.5"
            ></textarea>
          </label>
        </div>

        <div
          v-if="createError"
          style="
            margin-top: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ createError }}
        </div>

        <div class="flex items-center justify-between" style="margin-top: 20px">
          <span style="font-size: 11px; color: var(--color-text-faint)">
            * Pflichtfeld — alle anderen Felder lassen sich später noch befüllen.
          </span>
          <div class="flex items-center" style="gap: 8px">
            <button class="bauos-btn ghost" @click="closeCreateDialog" :disabled="createSaving">
              Abbrechen
            </button>
            <button
              class="bauos-btn solid"
              @click="submitCreate"
              :disabled="!createForm.name.trim() || createSaving"
            >
              {{ createSaving ? "Lege an…" : "Projekt anlegen" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.proj-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  background: var(--color-bg);
  cursor: pointer;
  transition: all 180ms ease;
}
.proj-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}
.proj-row {
  cursor: pointer;
  transition: background 180ms ease;
}
.proj-row:hover {
  background: var(--color-bg-subtle);
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border: 1px solid transparent;
}
.pill-aktiv {
  background: var(--color-success-bg);
  color: var(--color-success-text);
  border-color: var(--color-success-border);
}
.pill-pausiert {
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  border-color: var(--color-warning-border);
}
.pill-archiviert {
  background: var(--color-border-subtle);
  color: var(--color-text-muted);
  border-color: var(--color-border);
}

/* ── Filter-Bar ────────────────────────────────────────── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.filter-bar > div:first-child {
  flex: 1 1 260px;
  min-width: 220px;
}

.filter-select {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  transition: border-color 180ms ease;
}
.filter-select:hover {
  border-color: var(--color-text-faint);
}

/* ── Karten-Chips + Beschreibung ───────────────────────── */
.card-description {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 0 0 10px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-chip {
  display: inline-flex;
  padding: 2px 8px;
  font-size: 10px;
  border-radius: 999px;
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
.card-chip-phase {
  background: transparent;
  color: var(--color-text-secondary);
}

/* ── Fortschritts-Balken ───────────────────────────────── */
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--color-bg-subtle);
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
}
.progress-fill {
  height: 100%;
  background: var(--color-primary, #4f46e5);
  transition: width 300ms ease;
  border-radius: 999px;
}
.progress-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
  min-width: 28px;
  text-align: right;
}

/* ── Projekt-Farb-Akzent ───────────────────────────────── */
.proj-card-accent {
  border-left: 3px solid var(--accent-color);
}

/* ── Kanban-Board ──────────────────────────────────────── */
.kanban-board {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 12px;
  scroll-snap-type: x proximity;
}
.kanban-col {
  flex: 0 0 260px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 10px;
  scroll-snap-align: start;
}
.kanban-col-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding: 0 4px;
}
.kanban-col-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.kanban-col-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-bg);
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
}

.kanban-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: grab;
  transition: border-color 180ms ease, transform 120ms ease, opacity 180ms ease;
}
.kanban-card:hover {
  border-color: var(--color-text-faint);
  transform: translateY(-1px);
}
.kanban-card:last-child {
  margin-bottom: 0;
}
.kanban-card:active {
  cursor: grabbing;
}
.kanban-card-dragging {
  opacity: 0.4;
  transform: scale(0.98);
}
.kanban-col-drop {
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-subtle));
  border-color: var(--color-primary);
  outline: 2px dashed var(--color-primary);
  outline-offset: -4px;
}

.kanban-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kanban-sub {
  font-size: 11px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kanban-meta {
  font-size: 11px;
  margin-top: 6px;
}
.kanban-empty {
  font-size: 11px;
  color: var(--color-text-faint);
  text-align: center;
  font-style: italic;
  margin: 8px 0 0 0;
}

/* ── Parent-Breadcrumb auf Karten ───────────────────────── */
.card-parent-crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--color-text-muted);
  margin-bottom: 2px;
  cursor: pointer;
  transition: color 180ms ease;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 500;
}
.card-parent-crumb:hover {
  color: var(--color-text);
}

/* ── Modal ─────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, #000 55%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 60px 20px 20px;
  z-index: 1000;
  overflow-y: auto;
}
.modal-card {
  width: 100%;
  max-width: 640px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px 28px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}
.modal-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 180ms ease;
}
.modal-close:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}
.modal-close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.form-field-span-2 {
  grid-column: span 2;
}
.form-input-lg {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 180ms ease;
}
.form-input-lg:focus {
  border-color: var(--color-primary);
}

@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
  .form-field-span-2 {
    grid-column: span 1;
  }
}

/* ── Mobile-Anpassungen (Phase 1A) ─────────────────────────── */
.proj-list-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.proj-list-inner {
  /* min-width damit die Spalten nicht kollabieren */
  min-width: 800px;
}
@media (max-width: 1023.98px) {
  .proj-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}
@media (max-width: 640px) {
  .proj-grid {
    grid-template-columns: 1fr !important;
  }
}
</style>
