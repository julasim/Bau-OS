<script setup lang="ts">
// ============================================================
// PATIO — Projektübersicht (Design System v2)
// ============================================================
// Vollbild-Übersicht aller Projekte als Karten-Raster oder
// Tabelle. Toolbar: Suche + Phasen-Filter + Status-Filter +
// Ansicht-Toggle. KPIs im Seiten-Kopf.
// Navigiert bei Klick auf /projects/:name (Detail-Ansicht).
// ============================================================

import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";

interface Project {
  name: string;
  status?: string;
  phase?: string | null;
  bauherr?: string | null;
  bauherrName?: string | null;
  standort?: string | null;
  nutzung?: string | null;
  projektart?: string | null;
  projektnummer?: string | null;
  openTasks?: number;
  termine?: number;
  files?: number;
  notes?: number;
}

const router = useRouter();
const projects = ref<Project[]>([]);
// Honorargewichteter Fortschritt je Projektname, aus dem Portfolio-Cockpit.
const progressByName = ref<Record<string, number>>({});
const search = ref("");
const phaseFilter = ref("all");
const statusFilter = ref("all");
const view = ref<"cards" | "table">((localStorage.getItem("patio-projects-view") as "cards" | "table") ?? "cards");

// ── Create-Dialog ─────────────────────────────────────────────
const showCreate = ref(false);
const createSaving = ref(false);
const createError = ref<string | null>(null);
const createForm = ref({
  name: "",
  projektnummer: "",
  bauherr: "",
  standort: "",
  projektart: "",
  nutzung: "",
  phase: "",
  startDate: "",
  endDate: "",
  description: "",
});

const PHASE_OPTIONS = [
  "",
  "Vorentwurf",
  "Entwurf",
  "Einreichplanung",
  "Einreichung",
  "Ausführungsplanung",
  "Ausführung",
  "Übergabe",
];
const PROJEKTART_OPTIONS = ["", "Neubau", "Umbau", "Sanierung", "Zubau", "Sonstiges"];

// ── Filter ────────────────────────────────────────────────────
const filtered = computed(() => {
  let r = projects.value;
  if (search.value) {
    const q = search.value.toLowerCase();
    r = r.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.bauherrName ?? p.bauherr ?? "").toLowerCase().includes(q) ||
        (p.standort ?? "").toLowerCase().includes(q) ||
        (p.nutzung ?? "").toLowerCase().includes(q) ||
        (p.projektnummer ?? "").toLowerCase().includes(q),
    );
  }
  if (phaseFilter.value !== "all") {
    r = r.filter((p) => (p.phase ?? "").toLowerCase().includes(phaseFilter.value.toLowerCase()));
  }
  if (statusFilter.value !== "all") {
    r = r.filter((p) => {
      const s = (p.status ?? "aktiv").toLowerCase();
      return s === statusFilter.value;
    });
  }
  return r;
});

// ── KPIs ──────────────────────────────────────────────────────
const kpiAktiv = computed(() => projects.value.filter((p) => !p.status || p.status === "aktiv").length);
const kpiTasks = computed(() => projects.value.reduce((sum, p) => sum + (p.openTasks ?? 0), 0));
const kpiTermine = computed(() => projects.value.reduce((sum, p) => sum + (p.termine ?? 0), 0));

// ── Helpers ───────────────────────────────────────────────────
function statusBadgeClass(status?: string): string {
  const s = (status ?? "aktiv").toLowerCase();
  if (s === "frist") return "pt-badge pt-badge--warning";
  if (s === "abgeschlossen") return "pt-badge pt-badge--success";
  if (s === "pausiert") return "pt-badge";
  return "pt-badge"; // aktiv
}

function statusDotClass(status?: string): string {
  const s = (status ?? "aktiv").toLowerCase();
  if (s === "frist") return "pt-dot pt-dot--warning";
  if (s === "abgeschlossen") return "pt-dot pt-dot--success";
  if (s === "pausiert") return "pt-dot pt-dot--muted";
  return "pt-dot pt-dot--success"; // aktiv
}

function statusLabel(status?: string): string {
  const s = (status ?? "aktiv").toLowerCase();
  if (s === "frist") return "Frist";
  if (s === "abgeschlossen") return "Abgeschlossen";
  if (s === "pausiert") return "Pausiert";
  return "Aktiv";
}

// Echter honorargewichteter Fortschritt aus den Leistungsphasen (Portfolio).
// Projekte ohne Phasen / im FS-Modus → 0 (statt erfundener Keyword-Prozente).
function projectProgressPct(p: Project): number {
  return progressByName.value[p.name] ?? 0;
}

// ── Aktionen ──────────────────────────────────────────────────
function setView(v: "cards" | "table") {
  view.value = v;
  try {
    localStorage.setItem("patio-projects-view", v);
  } catch (_) {}
}

function openProject(name: string) {
  router.push(`/projects/${encodeURIComponent(name)}`);
}

function openCreate() {
  createError.value = null;
  createForm.value = {
    name: "",
    projektnummer: "",
    bauherr: "",
    standort: "",
    projektart: "",
    nutzung: "",
    phase: "",
    startDate: "",
    endDate: "",
    description: "",
  };
  showCreate.value = true;
}

async function submitCreate() {
  const name = createForm.value.name.trim();
  if (!name || createSaving.value) return;
  if (projects.value.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    createError.value = "Ein Projekt mit diesem Namen existiert bereits.";
    return;
  }
  createSaving.value = true;
  createError.value = null;
  try {
    const created = await api.post<{ name: string }>("/projects", {
      ...createForm.value,
      name,
    });
    showCreate.value = false;
    await load();
    router.push(`/projects/${encodeURIComponent(created.name)}`);
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen.";
  } finally {
    createSaving.value = false;
  }
}

async function load() {
  try {
    const list = await api
      .get<Project[]>("/projects?detailed=1")
      .catch(async () => (await api.get<string[]>("/projects")).map((n) => ({ name: n })));
    projects.value = (list as Project[]).map((p) => (typeof p === "string" ? { name: p } : p));
    // Fortschritt aus dem Portfolio-Cockpit nachladen (DB-only; sonst leer).
    const portfolio = await api.get<{ name: string; progress: number }[]>("/portfolio").catch(() => []);
    const map: Record<string, number> = {};
    for (const e of portfolio) map[e.name] = e.progress;
    progressByName.value = map;
  } catch {
    projects.value = [];
  }
}

onMounted(load);
</script>

<template>
  <div class="ov-wrap">
    <!-- Seiten-Kopf + KPIs -->
    <header class="ov-head">
      <h1 class="ov-title">Projekte</h1>
      <p class="ov-sub">Alle laufenden Projekte des Büros.</p>
      <div class="ov-kpis">
        <div class="ov-kpi">
          <span class="ov-kpi-val">{{ kpiAktiv }}</span>
          <span class="ov-kpi-lbl">Aktive Projekte</span>
        </div>
        <div class="ov-kpi">
          <span class="ov-kpi-val">{{ kpiTasks }}<span class="u">offen</span></span>
          <span class="ov-kpi-lbl">Aufgaben</span>
        </div>
        <div class="ov-kpi">
          <span class="ov-kpi-val">{{ kpiTermine }}</span>
          <span class="ov-kpi-lbl">Termine</span>
        </div>
      </div>
    </header>

    <!-- Toolbar -->
    <div class="ov-toolbar">
      <!-- Suche -->
      <div class="ov-search">
        <BIcon name="search" :size="16" />
        <input
          v-model="search"
          class="pt-input"
          type="search"
          placeholder="Projekt, Bauherr, Adresse …"
          aria-label="Projekte durchsuchen"
        />
      </div>

      <!-- Phasen-Filter -->
      <div class="ov-filter">
        <select v-model="phaseFilter" class="pt-select" aria-label="Nach Phase filtern">
          <option value="all">Alle Phasen</option>
          <option value="vorentwurf">Vorentwurf</option>
          <option value="entwurf">Entwurf</option>
          <option value="einreichung">Einreichung</option>
          <option value="ausführung">Ausführung</option>
          <option value="übergabe">Übergabe</option>
        </select>
      </div>

      <!-- Status-Filter -->
      <div class="ov-filter">
        <select v-model="statusFilter" class="pt-select" aria-label="Nach Status filtern">
          <option value="all">Alle Status</option>
          <option value="aktiv">Aktiv</option>
          <option value="frist">Frist</option>
          <option value="pausiert">Pausiert</option>
          <option value="abgeschlossen">Abgeschlossen</option>
        </select>
      </div>

      <span class="pt-spacer"></span>

      <!-- Ansicht-Toggle -->
      <div class="pt-segment ov-viewseg" role="group" aria-label="Ansicht wechseln">
        <button
          type="button"
          :class="{ 'is-active': view === 'cards' }"
          @click="setView('cards')"
          title="Karten"
          :aria-pressed="view === 'cards'"
        >
          <BIcon name="grid" :size="15" />
        </button>
        <button
          type="button"
          :class="{ 'is-active': view === 'table' }"
          @click="setView('table')"
          title="Tabelle"
          :aria-pressed="view === 'table'"
        >
          <BIcon name="list" :size="15" />
        </button>
      </div>

      <!-- Neues Projekt -->
      <button type="button" class="pt-btn pt-btn--primary" @click="openCreate">
        <BIcon name="plus" :size="15" />
        Neues Projekt
      </button>
    </div>

    <!-- ── Karten-Ansicht ───────────────────────────────── -->
    <div v-if="view === 'cards'" class="ov-cards" :class="{ 'is-empty': filtered.length === 0 }">
      <a
        v-for="p in filtered"
        :key="p.name"
        class="ov-card"
        :href="`/projects/${encodeURIComponent(p.name)}`"
        @click.prevent="openProject(p.name)"
      >
        <div class="ov-card-top">
          <span v-if="p.phase" class="pt-badge">{{ p.phase }}</span>
          <span class="pt-spacer"></span>
          <span :class="statusBadgeClass(p.status)">
            <span :class="statusDotClass(p.status)"></span>
            {{ statusLabel(p.status) }}
          </span>
        </div>

        <h3 class="ov-card-title">{{ p.name }}</h3>
        <div v-if="p.bauherrName || p.bauherr" class="ov-card-meta">
          {{ p.bauherrName ?? p.bauherr }}
        </div>
        <div class="ov-card-sub">
          <span v-if="p.standort">{{ p.standort }}</span>
          <span v-if="p.standort && p.nutzung"> · </span>
          <span v-if="p.nutzung">{{ p.nutzung }}</span>
        </div>

        <div class="ov-card-grow"></div>

        <!-- Fortschritt (Phase-basiert) -->
        <div class="ov-prog-row">
          <span class="ov-prog-lbl">Phase</span>
          <span class="ov-prog-val">{{ projectProgressPct(p) }} %</span>
        </div>
        <div class="pt-progress">
          <i :style="{ width: projectProgressPct(p) + '%' }"></i>
        </div>

        <!-- Fuß: Aufgaben + Termine -->
        <div v-if="(p.openTasks ?? 0) > 0 || (p.termine ?? 0) > 0" class="ov-card-foot">
          <span v-if="(p.openTasks ?? 0) > 0" class="ov-next">
            <BIcon name="check" :size="14" />
            {{ p.openTasks }} offen
          </span>
          <span v-if="(p.termine ?? 0) > 0" class="ov-next">
            <BIcon name="calendar" :size="14" />
            {{ p.termine }} Termin{{ (p.termine ?? 0) !== 1 ? "e" : "" }}
          </span>
        </div>
      </a>

      <!-- Leerzustand -->
      <div class="ov-empty">
        <p v-if="search || phaseFilter !== 'all' || statusFilter !== 'all'">Keine Projekte für diese Filter.</p>
        <p v-else>Noch keine Projekte.</p>
        <button
          v-if="!search && phaseFilter === 'all' && statusFilter === 'all'"
          type="button"
          class="pt-btn pt-btn--primary"
          style="margin-top: var(--space-4)"
          @click="openCreate"
        >
          Erstes Projekt anlegen
        </button>
      </div>
    </div>

    <!-- ── Tabellen-Ansicht ──────────────────────────────── -->
    <div v-else class="ov-table-wrap" :class="{ 'is-empty': filtered.length === 0 }">
      <div class="ov-table-scroll">
        <table class="ov-table">
          <thead>
            <tr>
              <th>Projekt</th>
              <th>Nutzung</th>
              <th>Phase</th>
              <th>Status</th>
              <th style="width: 160px">Fortschritt</th>
              <th>Aufgaben</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in filtered" :key="p.name" @click="openProject(p.name)">
              <td>
                <div class="ov-tname">{{ p.name }}</div>
                <div v-if="p.bauherrName || p.bauherr || p.standort" class="ov-tsub">
                  {{ p.bauherrName ?? p.bauherr ?? "" }}
                  <template v-if="(p.bauherrName ?? p.bauherr) && p.standort"> · </template>
                  {{ p.standort ?? "" }}
                </div>
              </td>
              <td>{{ p.nutzung ?? p.projektart ?? "—" }}</td>
              <td>{{ p.phase ?? "—" }}</td>
              <td>
                <span :class="statusBadgeClass(p.status)">
                  <span :class="statusDotClass(p.status)"></span>
                  {{ statusLabel(p.status) }}
                </span>
              </td>
              <td>
                <div class="ov-tprog">
                  <div class="pt-progress">
                    <i :style="{ width: projectProgressPct(p) + '%' }"></i>
                  </div>
                  <span class="v">{{ projectProgressPct(p) }} %</span>
                </div>
              </td>
              <td>
                <span v-if="(p.openTasks ?? 0) > 0" style="font-variant-numeric: tabular-nums">
                  {{ p.openTasks }}
                </span>
                <span v-else style="color: var(--fg-subtle)">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Leerzustand Tabelle -->
      <div class="ov-empty">
        <p v-if="search || phaseFilter !== 'all' || statusFilter !== 'all'">Keine Projekte für diese Filter.</p>
        <p v-else>Noch keine Projekte.</p>
      </div>
    </div>
  </div>

  <!-- ── Foreground-Editor: Neues Projekt ──────────────── -->
  <Teleport to="body">
    <div
      v-if="showCreate"
      class="ov-scrim"
      @click.self="showCreate = false"
      role="dialog"
      aria-modal="true"
      aria-label="Neues Projekt"
    >
      <div class="ov-editor">
        <div class="ov-ed-head">
          <div>
            <div class="ov-ed-eyebrow">Neues Projekt</div>
            <div class="ov-ed-title">Projekt anlegen</div>
          </div>
          <button type="button" class="pt-btn pt-btn--ghost" @click="showCreate = false" aria-label="Schließen">
            <BIcon name="x" :size="16" />
          </button>
        </div>

        <div class="ov-ed-body">
          <div class="ov-field">
            <label class="ov-label">Name *</label>
            <input
              v-model="createForm.name"
              class="pt-input"
              placeholder="z.B. Wohnhaus Huber"
              @keyup.enter="submitCreate"
              autofocus
            />
          </div>
          <div class="ov-form-row">
            <div class="ov-field">
              <label class="ov-label">Projektnummer</label>
              <input v-model="createForm.projektnummer" class="pt-input" placeholder="2026-001" />
            </div>
            <div class="ov-field">
              <label class="ov-label">Projektart</label>
              <select v-model="createForm.projektart" class="pt-select">
                <option v-for="opt in PROJEKTART_OPTIONS" :key="opt" :value="opt">
                  {{ opt || "— wählen —" }}
                </option>
              </select>
            </div>
          </div>
          <div class="ov-field">
            <label class="ov-label">Bauherr</label>
            <input v-model="createForm.bauherr" class="pt-input" placeholder="Name oder Firma" />
          </div>
          <div class="ov-field">
            <label class="ov-label">Standort</label>
            <input v-model="createForm.standort" class="pt-input" placeholder="Adresse / Ort" />
          </div>
          <div class="ov-form-row">
            <div class="ov-field">
              <label class="ov-label">Nutzung</label>
              <input v-model="createForm.nutzung" class="pt-input" placeholder="Wohnbau, Büro …" />
            </div>
            <div class="ov-field">
              <label class="ov-label">Phase</label>
              <select v-model="createForm.phase" class="pt-select">
                <option v-for="opt in PHASE_OPTIONS" :key="opt" :value="opt">
                  {{ opt || "— wählen —" }}
                </option>
              </select>
            </div>
          </div>
          <div class="ov-form-row">
            <div class="ov-field">
              <label class="ov-label">Start</label>
              <input v-model="createForm.startDate" type="date" class="pt-input" />
            </div>
            <div class="ov-field">
              <label class="ov-label">Ende</label>
              <input v-model="createForm.endDate" type="date" class="pt-input" />
            </div>
          </div>
          <div class="ov-field">
            <label class="ov-label">Beschreibung</label>
            <textarea v-model="createForm.description" class="pt-textarea" rows="2" placeholder="Optional"></textarea>
          </div>
          <p v-if="createError" class="ov-error">{{ createError }}</p>
        </div>

        <div class="ov-ed-foot">
          <button type="button" class="pt-btn pt-btn--secondary" @click="showCreate = false">Abbrechen</button>
          <button
            type="button"
            class="pt-btn pt-btn--primary"
            :disabled="!createForm.name.trim() || createSaving"
            @click="submitCreate"
          >
            {{ createSaving ? "Lege an …" : "Anlegen" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Wrapper ─────────────────────────────────────────────── */
.ov-wrap {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: var(--space-8) var(--space-10) var(--space-16);
}

/* ── Seiten-Kopf ─────────────────────────────────────────── */
.ov-head {
  margin-bottom: var(--space-6);
}
.ov-title {
  font-family: var(--font-display);
  font-size: var(--fs-36);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-display);
  line-height: var(--lh-tight);
  color: var(--fg);
  margin: 0 0 var(--space-2);
}
.ov-sub {
  font-size: var(--fs-14);
  color: var(--fg-muted);
  margin: 0;
}

.ov-kpis {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-10);
  margin-top: var(--space-5);
  padding-top: var(--space-5);
  border-top: 1px solid var(--hairline);
}
.ov-kpi {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ov-kpi-val {
  font-family: var(--font-display);
  font-size: var(--fs-30);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-display);
  line-height: 1;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}
.ov-kpi-val .u {
  font-size: var(--fs-16);
  color: var(--fg-muted);
  margin-left: 4px;
  letter-spacing: 0;
}
.ov-kpi-lbl {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--fg-subtle);
}

/* ── Toolbar ─────────────────────────────────────────────── */
.ov-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
  flex-wrap: wrap;
}
.ov-search {
  position: relative;
  width: 268px;
  max-width: 100%;
}
.ov-search > svg {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--fg-subtle);
  pointer-events: none;
}
.ov-search .pt-input {
  height: 32px;
  padding-left: 34px;
  border-radius: var(--radius-md);
}
.ov-filter {
  width: 168px;
}
.ov-filter .pt-select {
  height: 32px;
  border-radius: var(--radius-md);
  font-size: var(--fs-13);
}
.ov-toolbar .pt-spacer {
  flex: 1;
  min-width: var(--space-3);
}

/* Ansicht-Toggle (pt-segment-Optik, Icon-Buttons) */
.ov-viewseg button {
  padding: 0 9px;
}

/* ── Karten-Raster ───────────────────────────────────────── */
.ov-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(298px, 1fr));
  gap: var(--space-4);
}
.ov-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: inherit;
  min-height: 196px;
  transition:
    border-color var(--t-base) var(--ease),
    box-shadow var(--t-base) var(--ease);
}
.ov-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}
.ov-card:focus-visible {
  outline: 2px solid var(--fg);
  outline-offset: 2px;
}

.ov-card-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.ov-card-title {
  font-family: var(--font-display);
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--lh-snug);
  color: var(--fg);
  margin: 0;
}
.ov-card-meta {
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg-body);
  margin-top: var(--space-2);
}
.ov-card-sub {
  font-size: var(--fs-12);
  color: var(--fg-muted);
  margin-top: 2px;
}
.ov-card-grow {
  flex: 1;
  min-height: var(--space-4);
}

.ov-prog-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ov-prog-lbl {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--fg-subtle);
}
.ov-prog-val {
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}

.ov-card-foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.ov-next {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-12);
  color: var(--fg-muted);
  white-space: nowrap;
}
.ov-next :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--fg-subtle);
  flex: none;
}

/* ── Progress (pt-progress wird von patio-components.css bereitgestellt,
      .pt-progress i = Fortschrittsbalken) ── */
:deep(.pt-progress) {
  height: 4px;
  background: var(--surface-muted);
  border-radius: var(--radius-full);
  overflow: hidden;
}
:deep(.pt-progress i) {
  display: block;
  height: 100%;
  background: var(--fg);
  border-radius: var(--radius-full);
  transition: width var(--t-slow) var(--ease);
  font-style: normal;
}

/* ── Tabelle ─────────────────────────────────────────────── */
.ov-table-wrap {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);
}
.ov-table-scroll {
  overflow-x: auto;
}
.ov-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-sans);
  font-size: var(--fs-13);
  min-width: 700px;
}
.ov-table thead th {
  text-align: left;
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
  color: var(--fg-subtle);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  white-space: nowrap;
}
.ov-table tbody td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--hairline);
  color: var(--fg-body);
  vertical-align: middle;
}
.ov-table tbody tr:last-child td {
  border-bottom: 0;
}
.ov-table tbody tr {
  transition: background-color var(--t-fast) var(--ease);
  cursor: pointer;
}
.ov-table tbody tr:hover {
  background: var(--surface-subtle);
}
.ov-tname {
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.ov-tsub {
  font-size: var(--fs-12);
  color: var(--fg-muted);
  margin-top: 1px;
}
.ov-tprog {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 132px;
}
.ov-tprog :deep(.pt-progress) {
  flex: 1;
}
.ov-tprog .v {
  font-variant-numeric: tabular-nums;
  color: var(--fg-body);
  font-weight: var(--fw-medium);
  width: 34px;
  text-align: right;
}

/* ── Leerzustand ─────────────────────────────────────────── */
.ov-empty {
  display: none;
  padding: var(--space-16) var(--space-6);
  text-align: center;
}
.ov-empty p {
  margin: 0;
  font-size: var(--fs-14);
  color: var(--fg-subtle);
}
.is-empty .ov-empty {
  display: block;
}

/* ── Foreground-Editor (Neues Projekt) ───────────────────── */
.ov-scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(10, 10, 10, 0.45);
  display: grid;
  place-items: start center;
  padding: clamp(24px, 7vh, 88px) var(--space-6) var(--space-6);
  overflow-y: auto;
}
.dark .ov-scrim {
  background: rgba(0, 0, 0, 0.66);
}

.ov-editor {
  width: min(560px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.ov-ed-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6) 0;
}
.ov-ed-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--fs-11);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--fg-subtle);
  margin-bottom: var(--space-2);
}
.ov-ed-title {
  font-family: var(--font-display);
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
}

.ov-ed-body {
  padding: var(--space-5) var(--space-6) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.ov-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ov-label {
  font-size: var(--fs-12);
  font-weight: var(--fw-medium);
  color: var(--fg-muted);
}
.ov-form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.ov-error {
  font-size: var(--fs-12);
  color: var(--danger-fg);
  margin: 0;
}

.ov-ed-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--hairline);
  background: var(--surface-subtle);
}

/* ── Responsive ──────────────────────────────────────────── */
@media (max-width: 768px) {
  .ov-wrap {
    padding: var(--space-4) var(--space-4) var(--space-12);
  }
  .ov-title {
    font-size: var(--fs-24);
  }
  .ov-search {
    width: 100%;
  }
  .ov-filter {
    flex: 1;
    width: auto;
  }
  .ov-form-row {
    grid-template-columns: 1fr;
  }
}
</style>
