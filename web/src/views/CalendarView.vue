<script setup lang="ts">
import { formatWeekdayDayMonth, formatMonthLong, formatWeekdayFull } from "../utils/format";
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";

// ── Types ────────────────────────────────────────────────────────────────────
interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
  assignees: string[];
  project?: string | null;
}

type ViewMode = "month" | "week" | "day" | "list";

// ── State ────────────────────────────────────────────────────────────────────
const termine = ref<Termin[]>([]);
const team = ref<string[]>([]);

const VIEW_KEY = "patio-calendar-view";
// Auf Phone (<768px): Default auf "list" — Monats-/Wochengrid ist auf
// 375px schlicht unbenutzbar (5px-Spalten, ueberlappende Events).
// User kann via View-Switcher trotzdem auf Monat umschalten.
const isMobileViewport = typeof window !== "undefined" && window.innerWidth < 768;
const view = ref<ViewMode>(
  ((): ViewMode => {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "week" || v === "day" || v === "list" || v === "month") {
      // Stored-Wert respektieren, ausser User ist auf Mobile + hat noch nichts
      // gewaehlt: dann list als sinnvoller Default.
      return v as ViewMode;
    }
    return isMobileViewport ? "list" : "month";
  })(),
);
watch(view, (v) => localStorage.setItem(VIEW_KEY, v));

const current = ref(new Date());

// Formular-State
const editing = ref<Termin | null>(null);
const showCreate = ref(false);
const newDatum = ref("");
const newUhrzeit = ref("");
const newText = ref("");

// Flash-Message
const message = ref<{ type: "success" | "error"; text: string } | null>(null);
function flash(type: "success" | "error", text: string) {
  message.value = { type, text };
  setTimeout(() => {
    if (message.value?.text === text) message.value = null;
  }, 4000);
}

const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 07 – 20

// ── Laden ────────────────────────────────────────────────────────────────────
async function load() {
  [termine.value, team.value] = await Promise.all([
    api.get<Termin[]>("/termine"),
    api.get<string[]>("/team").catch(() => []),
  ]);
}
onMounted(load);
useEvents(["termin"], () => load());

// ── Helpers ──────────────────────────────────────────────────────────────────
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDisplayISO(d: string): string {
  // Backend kann sowohl 2026-04-10 als auch 10.04.2026 liefern
  if (d.includes("-")) return d;
  const [dd, mm, yyyy] = d.split(".");
  return `${yyyy}-${mm}-${dd}`;
}

function termineForDate(iso: string): Termin[] {
  return termine.value.filter((t) => toDisplayISO(t.datum) === iso);
}

function formatDateLong(d: string): string {
  const iso = toDisplayISO(d);
  return formatWeekdayDayMonth(iso);
}

// ── Monats-Grid ──────────────────────────────────────────────────────────────
const monthTitle = computed(() => formatMonthLong(current.value));

const monthDays = computed(() => {
  const y = current.value.getFullYear();
  const m = current.value.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;

  const days: { date: Date; iso: string; inMonth: boolean; today: boolean }[] = [];
  const todayISO = toISO(new Date());

  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(y, m, -i);
    days.push({ date: d, iso: toISO(d), inMonth: false, today: false });
  }
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(y, m, d);
    const iso = toISO(date);
    days.push({ date, iso, inMonth: true, today: iso === todayISO });
  }
  while (days.length % 7 !== 0) {
    const d = new Date(y, m + 1, days.length - startDay - last.getDate() + 1);
    days.push({ date: d, iso: toISO(d), inMonth: false, today: false });
  }
  return days;
});

// ── Wochen-Grid ──────────────────────────────────────────────────────────────
const weekStart = computed(() => {
  const d = new Date(current.value);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
});

const weekDays = computed(() => {
  const days: { date: Date; iso: string; label: string; today: boolean }[] = [];
  const todayISO = toISO(new Date());
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.value);
    d.setDate(d.getDate() + i);
    const iso = toISO(d);
    days.push({
      date: d,
      iso,
      label: `${weekdays[i]} ${d.getDate()}.${d.getMonth() + 1}.`,
      today: iso === todayISO,
    });
  }
  return days;
});

// ── Tages-Ansicht ───────────────────────────────────────────────────────────
const dayTitle = computed(() => formatWeekdayFull(current.value));
const dayISO = computed(() => toISO(current.value));

// ── Listen-Ansicht ──────────────────────────────────────────────────────────
const grouped = computed(() => {
  const groups: { date: string; label: string; items: Termin[] }[] = [];
  const map = new Map<string, Termin[]>();
  for (const t of termine.value) {
    const k = toDisplayISO(t.datum);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  const todayISO = toISO(new Date());
  for (const [iso, items] of map) {
    let label = formatDateLong(iso);
    if (iso === todayISO) label = "Heute — " + label;
    // Sortiere Termine innerhalb des Tages nach Uhrzeit
    items.sort((a, b) => (a.uhrzeit ?? "99:99").localeCompare(b.uhrzeit ?? "99:99"));
    groups.push({ date: iso, label, items });
  }
  groups.sort((a, b) => a.date.localeCompare(b.date));
  return groups;
});

// ── Navigation ──────────────────────────────────────────────────────────────
function prev() {
  const d = new Date(current.value);
  if (view.value === "month") d.setMonth(d.getMonth() - 1);
  else if (view.value === "week") d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 1);
  current.value = d;
}
function next() {
  const d = new Date(current.value);
  if (view.value === "month") d.setMonth(d.getMonth() + 1);
  else if (view.value === "week") d.setDate(d.getDate() + 7);
  else d.setDate(d.getDate() + 1);
  current.value = d;
}
function goToday() {
  current.value = new Date();
}
function goToDate(iso: string, switchTo: ViewMode = "day") {
  current.value = new Date(iso + "T00:00:00");
  view.value = switchTo;
}

// ── CRUD ────────────────────────────────────────────────────────────────────
function startCreate(iso?: string) {
  editing.value = null;
  newDatum.value = iso ?? toISO(new Date());
  newUhrzeit.value = "";
  newText.value = "";
  showCreate.value = true;
}

async function create() {
  if (!newDatum.value || !newText.value.trim()) return;
  try {
    await api.post("/termine", {
      datum: newDatum.value,
      text: newText.value.trim(),
      uhrzeit: newUhrzeit.value || undefined,
    });
    newDatum.value = "";
    newUhrzeit.value = "";
    newText.value = "";
    showCreate.value = false;
    await load();
    flash("success", "Termin erstellt");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  }
}

function edit(t: Termin) {
  showCreate.value = false;
  editing.value = { ...t, assignees: [...t.assignees] };
}

async function save(t: Termin) {
  try {
    await api.put(`/termine/${t.id}`, {
      text: t.text,
      datum: t.datum,
      uhrzeit: t.uhrzeit,
      endzeit: t.endzeit,
      location: t.location,
      assignees: t.assignees,
    });
    editing.value = null;
    await load();
    flash("success", "Termin gespeichert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  }
}

async function remove(id: string) {
  try {
    await api.delete(`/termine/${id}`);
    await load();
    flash("success", "Termin gelöscht");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Löschen fehlgeschlagen");
  }
}

function toggleAssignee(name: string) {
  if (!editing.value) return;
  const idx = editing.value.assignees.indexOf(name);
  if (idx >= 0) editing.value.assignees.splice(idx, 1);
  else editing.value.assignees.push(name);
}

// ── Header-Label ────────────────────────────────────────────────────────────
const rangeLabel = computed(() => {
  if (view.value === "month") return monthTitle.value;
  if (view.value === "day") return dayTitle.value;
  if (view.value === "week") {
    const s = weekDays.value[0];
    const e = weekDays.value[6];
    return s && e ? `${s.label} – ${e.label}` : "";
  }
  return "Alle Termine";
});

// ── View-Konfiguration ──────────────────────────────────────────────────────
const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "month", label: "Monat" },
  { id: "week", label: "Woche" },
  { id: "day", label: "Tag" },
  { id: "list", label: "Liste" },
];

// ── Agenda-Filter ────────────────────────────────────────────────────────────
// In Monatsansicht: Klick auf Tag filtert die Agenda auf diesen Tag.
// "Ganzer Monat" setzt zurück.
const agendaFilter = ref<string | null>(null);

function selectAgendaDay(iso: string) {
  agendaFilter.value = agendaFilter.value === iso ? null : iso;
}

const agendaGroups = computed(() => {
  if (agendaFilter.value) {
    const items = termineForDate(agendaFilter.value);
    items.sort((a, b) => (a.uhrzeit ?? "99:99").localeCompare(b.uhrzeit ?? "99:99"));
    const iso = agendaFilter.value;
    const todayISO = toISO(new Date());
    let label = formatDateLong(iso);
    if (iso === todayISO) label = "Heute — " + label;
    return items.length > 0 ? [{ date: iso, label, items }] : [];
  }
  // Zeige nur den aktuellen Monat
  const y = current.value.getFullYear();
  const m = current.value.getMonth();
  return grouped.value.filter((g) => {
    const d = new Date(g.date + "T00:00:00");
    return d.getFullYear() === y && d.getMonth() === m;
  });
});

function agendaMonthAbbrev(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("de-AT", { month: "short" });
}
function agendaDayNum(iso: string): string {
  return String(new Date(iso + "T00:00:00").getDate());
}
</script>

<template>
  <div class="ap-page">
    <!-- ── Flash-Message ──────────────────────────────────────────────────── -->
    <div v-if="message" :class="['ap-flash', message.type === 'success' ? 'ap-flash--success' : 'ap-flash--danger']">
      {{ message.text }}
    </div>

    <!-- ── Page Header ────────────────────────────────────────────────────── -->
    <header class="ap-pagehead">
      <div>
        <h1 class="ap-pagetitle">Termine</h1>
        <p class="ap-pagesub">Alle Behörden-, Bauherren- und Abstimmungstermine deiner Projekte.</p>
      </div>
      <div class="ap-pagehead-actions">
        <button @click="startCreate()" class="pt-btn pt-btn--primary pt-btn--sm" type="button">
          <svg
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="14"
            height="14"
            style="flex-shrink: 0"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Neuer Termin
        </button>
      </div>
    </header>

    <!-- ── Inline Create-Formular ─────────────────────────────────────────── -->
    <div v-if="showCreate" class="ap-panel ap-create-panel">
      <div class="ap-panel-head">
        <span class="ap-panel-title">Neuer Termin</span>
        <button @click="showCreate = false" class="pt-iconbtn" type="button" aria-label="Schliessen">
          <svg
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="ap-panel-body">
        <div class="ap-form-row">
          <div class="pt-field">
            <label class="pt-label" for="nc-datum">Datum</label>
            <input v-model="newDatum" type="date" class="pt-input" id="nc-datum" />
          </div>
          <div class="pt-field">
            <label class="pt-label" for="nc-uhrzeit">Uhrzeit</label>
            <input v-model="newUhrzeit" type="time" class="pt-input" id="nc-uhrzeit" />
          </div>
          <div class="pt-field" style="flex: 2">
            <label class="pt-label" for="nc-text">Beschreibung <span class="pt-req">*</span></label>
            <input
              v-model="newText"
              type="text"
              placeholder="Termin…"
              @keyup.enter="create"
              class="pt-input"
              id="nc-text"
            />
          </div>
        </div>
        <div class="ap-group-h" style="margin-top: 12px">
          <button @click="create" class="pt-btn pt-btn--primary pt-btn--sm" type="button">Erstellen</button>
          <button @click="showCreate = false" class="pt-btn pt-btn--ghost pt-btn--sm" type="button">Abbrechen</button>
        </div>
      </div>
    </div>

    <!-- ── Inline Edit-Formular ───────────────────────────────────────────── -->
    <div v-if="editing" class="ap-panel ap-create-panel">
      <div class="ap-panel-head">
        <span class="ap-panel-title">Termin bearbeiten</span>
        <button @click="editing = null" class="pt-iconbtn" type="button" aria-label="Schliessen">
          <svg
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="ap-panel-body">
        <div class="pt-field" style="margin-bottom: 12px">
          <label class="pt-label" for="ed-text">Beschreibung</label>
          <input v-model="editing.text" class="pt-input" id="ed-text" />
        </div>
        <div class="ap-form-row" style="margin-bottom: 12px">
          <div class="pt-field">
            <label class="pt-label" for="ed-datum">Datum</label>
            <input v-model="editing.datum" type="date" class="pt-input" id="ed-datum" />
          </div>
          <div class="pt-field">
            <label class="pt-label" for="ed-von">Von</label>
            <input v-model="editing.uhrzeit" type="time" class="pt-input" id="ed-von" />
          </div>
          <div class="pt-field">
            <label class="pt-label" for="ed-bis">Bis</label>
            <input v-model="editing.endzeit" type="time" class="pt-input" id="ed-bis" />
          </div>
        </div>
        <div class="pt-field" style="margin-bottom: 12px">
          <label class="pt-label" for="ed-ort">Ort</label>
          <input v-model="editing.location" placeholder="z. B. Büro, Magistrat…" class="pt-input" id="ed-ort" />
        </div>
        <div v-if="team.length > 0" style="margin-bottom: 16px">
          <div class="pt-label" style="margin-bottom: 6px">Personen</div>
          <div class="ap-group-h" style="flex-wrap: wrap; gap: 6px">
            <button
              v-for="m in team"
              :key="m"
              @click="toggleAssignee(m)"
              :class="['ap-chip-btn', editing.assignees.includes(m) ? 'ap-chip-btn--active' : '']"
              type="button"
            >
              {{ m }}
            </button>
          </div>
        </div>
        <div class="ap-group-h">
          <button @click="save(editing!)" class="pt-btn pt-btn--primary pt-btn--sm" type="button">Speichern</button>
          <button @click="editing = null" class="pt-btn pt-btn--ghost pt-btn--sm" type="button">Abbrechen</button>
          <span style="flex: 1" />
          <button
            @click="
              remove(editing.id);
              editing = null;
            "
            class="pt-btn pt-btn--ghost pt-btn--sm ap-btn--danger"
            type="button"
          >
            Löschen
          </button>
        </div>
      </div>
    </div>

    <!-- ── Toolbar: View-Switcher + Navigation ────────────────────────────── -->
    <div class="ap-toolbar ap-cal-toolbar">
      <!-- Navigation (nur in Grid-Ansichten) -->
      <div v-if="view !== 'list'" class="ap-group-h ap-cal-nav">
        <button @click="prev" class="pt-iconbtn" type="button" aria-label="Zurück">
          <svg
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <span class="ap-cal-range-label">{{ rangeLabel }}</span>
        <button @click="next" class="pt-iconbtn" type="button" aria-label="Vor">
          <svg
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button @click="goToday" class="pt-btn pt-btn--ghost pt-btn--sm" type="button">Heute</button>
      </div>
      <span class="pt-spacer" style="flex: 1" />
      <!-- Segmented View-Switcher -->
      <div class="pt-segment" aria-label="Ansicht">
        <button
          v-for="(v, i) in VIEWS"
          :key="v.id"
          @click="view = v.id"
          :class="['pt-seg-btn', view === v.id ? 'is-active' : '']"
          type="button"
        >
          {{ v.label }}
        </button>
      </div>
    </div>

    <!-- ── MONATS-ANSICHT: two-column layout ─────────────────────────────── -->
    <div v-if="view === 'month'" class="ap-termin-layout">
      <!-- Left: Calendar grid -->
      <div class="ap-cal">
        <!-- Day-of-week header -->
        <div class="ap-cal-grid ap-cal-dows">
          <div v-for="wd in weekdays" :key="wd" class="ap-cal-dow">{{ wd }}</div>
        </div>
        <!-- Day cells -->
        <div class="ap-cal-grid ap-cal-cells">
          <div
            v-for="day in monthDays"
            :key="day.iso"
            class="ap-cal-cell"
            :class="{
              'is-muted': !day.inMonth,
              'is-today': day.today,
              'is-selected': agendaFilter === day.iso,
            }"
            @click="
              selectAgendaDay(day.iso);
              startCreate(day.iso);
            "
          >
            <span @click.stop="selectAgendaDay(day.iso)" :class="['d', day.today ? 'is-today-num' : '']">{{
              day.date.getDate()
            }}</span>
            <button
              v-for="t in termineForDate(day.iso).slice(0, 3)"
              :key="t.id"
              @click.stop="edit(t)"
              class="ap-chip ap-chip--termin"
              type="button"
            >
              <span v-if="t.uhrzeit" class="ap-chip-time">{{ t.uhrzeit }}</span>
              <span class="ap-chip-text">{{ t.text }}</span>
            </button>
            <div v-if="termineForDate(day.iso).length > 3" class="ap-chip-more">
              +{{ termineForDate(day.iso).length - 3 }}
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Agenda -->
      <div class="ap-agenda">
        <div class="ap-agenda-head">
          <span class="ap-agenda-title">
            {{ agendaFilter ? formatDateLong(agendaFilter) : "Agenda · " + monthTitle }}
          </span>
          <button
            v-if="agendaFilter"
            @click="agendaFilter = null"
            class="pt-btn pt-btn--ghost pt-btn--sm"
            type="button"
          >
            Ganzer Monat
          </button>
        </div>
        <div v-if="agendaGroups.length === 0" class="ap-agenda-empty">Keine Termine.</div>
        <div v-for="group in agendaGroups" :key="group.date" class="ap-agenda-group">
          <div v-for="t in group.items" :key="t.id" class="ap-termin-row">
            <div class="ap-termin-date">
              <span class="d">{{ agendaDayNum(group.date) }}</span>
              <span class="m">{{ agendaMonthAbbrev(group.date) }}</span>
            </div>
            <div class="ap-termin-body">
              <button @click="edit(t)" class="ap-termin-title" type="button">
                {{ t.text }}
              </button>
              <div class="ap-termin-meta">
                <span v-if="t.uhrzeit" class="font-mono">{{ t.uhrzeit }}{{ t.endzeit ? ` – ${t.endzeit}` : "" }}</span>
                <span v-if="t.location">{{ t.location }}</span>
                <span v-if="t.assignees.length">{{ t.assignees.join(", ") }}</span>
              </div>
            </div>
            <button @click="remove(t.id)" class="ap-termin-del" type="button" aria-label="Löschen">
              <svg
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="14"
                height="14"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── WOCHEN-ANSICHT ─────────────────────────────────────────────────── -->
    <div v-if="view === 'week'" class="ap-panel">
      <div class="ap-cal-grid ap-week-grid" style="position: relative">
        <div v-if="termine.length === 0" class="ap-grid-empty">
          <span class="ap-grid-empty-title">Keine Termine diese Woche.</span>
          <span class="ap-grid-empty-hint">Klicke auf einen Tag um einen Termin zu erstellen.</span>
        </div>
        <div v-for="day in weekDays" :key="day.iso" class="ap-week-cell" :class="{ 'is-today': day.today }">
          <div class="ap-week-cell-head">
            <button
              @click="goToDate(day.iso)"
              class="ap-week-cell-label"
              :class="{ 'is-today': day.today }"
              type="button"
            >
              {{ day.label }}
            </button>
            <button
              @click="startCreate(day.iso)"
              class="pt-iconbtn ap-week-add"
              type="button"
              aria-label="Termin hinzufügen"
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
            </button>
          </div>
          <div class="ap-week-events">
            <button
              v-for="t in termineForDate(day.iso)"
              :key="t.id"
              @click="edit(t)"
              class="ap-chip ap-chip--termin"
              type="button"
            >
              <span v-if="t.uhrzeit" class="ap-chip-time">{{ t.uhrzeit }}</span>
              <span class="ap-chip-text">{{ t.text }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── TAGES-ANSICHT ──────────────────────────────────────────────────── -->
    <div v-if="view === 'day'">
      <div v-if="termineForDate(dayISO).length === 0" class="ap-grid-empty ap-day-empty">
        <span class="ap-grid-empty-title">Keine Termine an diesem Tag.</span>
        <span class="ap-grid-empty-hint">Klicke auf "+ Neuer Termin" um einen Termin zu erstellen.</span>
      </div>
      <div class="ap-panel">
        <div v-for="h in hours" :key="h" class="ap-day-row">
          <div class="ap-day-hour font-mono">{{ String(h).padStart(2, "0") }}:00</div>
          <div class="ap-day-slot">
            <button
              v-for="t in termineForDate(dayISO).filter((t) => t.uhrzeit && parseInt(t.uhrzeit) === h)"
              :key="t.id"
              @click="edit(t)"
              class="ap-event-full"
              type="button"
            >
              <span class="ap-event-time font-mono"> {{ t.uhrzeit }}{{ t.endzeit ? ` – ${t.endzeit}` : "" }} </span>
              <span class="ap-event-title">{{ t.text }}</span>
              <span v-if="t.location" class="ap-event-loc">· {{ t.location }}</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="termineForDate(dayISO).filter((t) => !t.uhrzeit).length > 0" style="margin-top: 16px">
        <div class="ap-section-label" style="margin-bottom: 8px">Ganztägig</div>
        <div class="ap-panel">
          <button
            v-for="t in termineForDate(dayISO).filter((t) => !t.uhrzeit)"
            :key="t.id"
            @click="edit(t)"
            class="ap-event-full"
            type="button"
          >
            <span class="ap-event-title">{{ t.text }}</span>
            <span v-if="t.location" class="ap-event-loc">· {{ t.location }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ── LISTEN-ANSICHT ─────────────────────────────────────────────────── -->
    <div v-if="view === 'list'">
      <p v-if="termine.length === 0" class="ap-list-empty">Keine Termine vorhanden.</p>
      <div v-for="group in grouped" :key="group.date" class="ap-list-group">
        <div class="ap-section-label">{{ group.label }}</div>
        <div class="ap-panel">
          <div v-for="t in group.items" :key="t.id" class="ap-list-row">
            <button @click="edit(t)" class="ap-list-btn" type="button">
              <span v-if="t.uhrzeit" class="font-mono ap-list-time">{{ t.uhrzeit }}</span>
              <span v-else class="font-mono ap-list-time ap-list-time--empty">–:–</span>
              <div class="ap-list-body">
                <div class="ap-list-title">
                  <span>{{ t.text }}</span>
                </div>
                <div class="ap-list-meta">
                  <span v-if="t.endzeit" class="font-mono">bis {{ t.endzeit }}</span>
                  <span v-if="t.location">{{ t.location }}</span>
                  <span v-if="t.assignees.length">{{ t.assignees.join(", ") }}</span>
                </div>
              </div>
            </button>
            <button @click="remove(t.id)" class="ap-list-del" type="button" aria-label="Löschen">Löschen</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Page wrapper ──────────────────────────────────────────────────────────── */
.ap-page {
  padding: var(--space-6, 24px) var(--space-8, 32px) var(--space-8, 32px);
  color: var(--fg, var(--color-text));
  max-width: 1400px;
}

/* ── Flash ─────────────────────────────────────────────────────────────────── */
.ap-flash {
  padding: 8px 14px;
  margin-bottom: 12px;
  border-radius: var(--radius-md, 6px);
  font-size: 13px;
  border: 1px solid;
}
.ap-flash--success {
  background: var(--success-bg, var(--color-success-bg));
  border-color: var(--success-border, var(--color-success-border));
  color: var(--success-fg, var(--color-success-text));
}
.ap-flash--danger {
  background: var(--danger-bg, var(--color-danger-bg));
  border-color: var(--danger-border, var(--color-danger-border));
  color: var(--danger-fg, var(--color-danger-text));
}

/* ── Page head ─────────────────────────────────────────────────────────────── */
.ap-pagehead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: var(--space-5, 20px);
}
.ap-pagetitle {
  font-size: var(--fs-24, 22px);
  font-weight: var(--fw-semibold, 600);
  letter-spacing: var(--tracking-tight, -0.01em);
  color: var(--fg, var(--color-text));
  margin: 0 0 4px;
}
.ap-pagesub {
  font-size: 13px;
  color: var(--fg-subtle, var(--color-text-muted));
  margin: 0;
}
.ap-pagehead-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ── Panel ─────────────────────────────────────────────────────────────────── */
.ap-panel {
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-lg, 8px);
  background: var(--surface, var(--color-bg));
  overflow: hidden;
}
.ap-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--hairline, var(--color-border-subtle));
}
.ap-panel-title {
  font-size: 14px;
  font-weight: var(--fw-semibold, 600);
  color: var(--fg, var(--color-text));
}
.ap-panel-body {
  padding: 16px;
}

/* ── Create panel ──────────────────────────────────────────────────────────── */
.ap-create-panel {
  margin-bottom: 20px;
}

/* ── Form helpers ──────────────────────────────────────────────────────────── */
.ap-form-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
.ap-form-row .pt-field {
  flex: 1;
}
.ap-group-h {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── Chip button (assignee toggle) ─────────────────────────────────────────── */
.ap-chip-btn {
  padding: 4px 10px;
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-md, 6px);
  background: var(--surface, var(--color-bg));
  color: var(--fg-muted, var(--color-text-muted));
  font-size: 12px;
  cursor: pointer;
  transition: all 180ms ease;
}
.ap-chip-btn--active {
  background: var(--accent, var(--color-primary));
  color: var(--accent-fg, var(--color-bg));
  border-color: var(--accent, var(--color-primary));
}

/* ── Danger btn ────────────────────────────────────────────────────────────── */
.ap-btn--danger {
  color: var(--danger-fg, var(--color-danger-text)) !important;
}

/* ── Section label ─────────────────────────────────────────────────────────── */
.ap-section-label {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: var(--fs-11, 11px);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide, 0.06em);
  color: var(--fg-subtle, var(--color-text-muted));
  margin-bottom: var(--space-2, 8px);
}

/* ── Toolbar ────────────────────────────────────────────────────────────────── */
.ap-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.ap-cal-toolbar {
  flex-wrap: wrap;
}
.ap-cal-nav {
  gap: 6px;
}
.ap-cal-range-label {
  font-size: 14px;
  font-weight: var(--fw-semibold, 600);
  color: var(--fg, var(--color-text));
  min-width: 180px;
  text-align: center;
}
.pt-spacer {
  flex: 1;
}

/* ── Segmented control ─────────────────────────────────────────────────────── */
.pt-segment {
  display: flex;
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}
.pt-seg-btn {
  padding: 6px 12px;
  border: 0;
  border-left: 1px solid var(--border, var(--color-border));
  background: transparent;
  color: var(--fg-subtle, var(--color-text-muted));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 180ms ease,
    color 180ms ease;
}
.pt-seg-btn:first-child {
  border-left: 0;
}
.pt-seg-btn.is-active {
  background: var(--surface-muted, var(--color-border-subtle));
  color: var(--fg, var(--color-text));
}

/* ── Two-column layout (month view) ────────────────────────────────────────── */
.ap-termin-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: var(--space-6, 24px);
  align-items: start;
}

/* ── Calendar grid ─────────────────────────────────────────────────────────── */
.ap-cal {
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-lg, 8px);
  background: var(--surface, var(--color-bg));
  overflow: hidden;
}
.ap-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.ap-cal-dows {
  border-bottom: 1px solid var(--hairline, var(--color-border-subtle));
  background: var(--surface-subtle, var(--color-bg-subtle));
}
.ap-cal-dow {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: var(--fs-11, 11px);
  color: var(--fg-subtle, var(--color-text-muted));
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide, 0.06em);
  padding: 8px 12px;
  text-align: left;
}
.ap-cal-cells {
  grid-auto-rows: minmax(92px, auto);
  position: relative;
}
.ap-cal-cell {
  padding: 6px;
  border-right: 1px solid var(--hairline, var(--color-border-subtle));
  border-bottom: 1px solid var(--hairline, var(--color-border-subtle));
  cursor: pointer;
  transition: background-color 180ms ease;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}
.ap-cal-cell:nth-child(7n) {
  border-right: 0;
}
.ap-cal-cell:hover {
  background: var(--surface-subtle, var(--color-bg-subtle));
}
.ap-cal-cell.is-muted {
  background: var(--surface-subtle, var(--color-bg-subtle));
  cursor: default;
}
.ap-cal-cell.is-muted:hover {
  background: var(--surface-subtle, var(--color-bg-subtle));
}
.ap-cal-cell.is-today {
  background: transparent;
}
.ap-cal-cell.is-selected {
  background: var(--surface-subtle, var(--color-bg-subtle));
  box-shadow: inset 0 0 0 1.5px var(--border-strong, var(--color-border));
}
.ap-cal-cell .d {
  font-size: 13px;
  color: var(--fg-body, var(--color-text-secondary));
  font-variant-numeric: tabular-nums;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 9999px;
  flex-shrink: 0;
  font-weight: 500;
  line-height: 1;
}
.ap-cal-cell.is-muted .d {
  color: var(--fg-subtle, var(--color-text-faint));
}
.ap-cal-cell .d.is-today-num {
  background: var(--accent, var(--color-primary));
  color: var(--accent-fg, var(--color-bg));
  font-weight: var(--fw-medium, 500);
}

/* ── Event chips (inside cells) ─────────────────────────────────────────────── */
.ap-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: var(--radius-sm, 3px);
  background: var(--surface-muted, var(--color-border-subtle));
  color: var(--fg-body, var(--color-text-secondary));
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: 0;
  border-left: 2px solid var(--fg-subtle, var(--color-text-muted));
  transition: background 180ms ease;
}
.ap-chip--termin {
  border-left-color: var(--fg-muted, var(--color-text-muted));
}
.ap-chip:hover {
  background: var(--border, var(--color-border));
}
.ap-chip-time {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  color: var(--fg-subtle, var(--color-text-tertiary));
  flex-shrink: 0;
}
.ap-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.ap-chip-more {
  font-size: 10px;
  color: var(--fg-subtle, var(--color-text-tertiary));
  font-family: var(--font-mono, monospace);
  padding-left: 2px;
}

/* ── Agenda (right column in month view) ───────────────────────────────────── */
.ap-agenda {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.ap-agenda-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3, 12px);
  gap: 8px;
}
.ap-agenda-title {
  font-size: var(--fs-15, 15px);
  font-weight: var(--fw-semibold, 600);
  letter-spacing: var(--tracking-tight, -0.01em);
  color: var(--fg, var(--color-text));
}
.ap-agenda-empty {
  font-size: 13px;
  color: var(--fg-subtle, var(--color-text-muted));
  padding: 24px 0;
  text-align: center;
}
.ap-agenda-group {
  margin-bottom: 0;
}

/* ── Agenda termin rows ──────────────────────────────────────────────────────── */
.ap-termin-row {
  display: flex;
  align-items: stretch;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hairline, var(--color-border-subtle));
  background: var(--surface, var(--color-bg));
  transition: background 180ms ease;
}
.ap-termin-row:first-child {
  border-top: 1px solid var(--hairline, var(--color-border-subtle));
  border-radius: var(--radius-md, 6px) var(--radius-md, 6px) 0 0;
}
.ap-termin-row:last-child {
  border-bottom: 0;
  border-radius: 0 0 var(--radius-md, 6px) var(--radius-md, 6px);
}
.ap-termin-row:only-child {
  border-radius: var(--radius-md, 6px);
}
.ap-termin-row + .ap-termin-row:last-child {
  border-radius: 0 0 var(--radius-md, 6px) var(--radius-md, 6px);
}
.ap-termin-row:hover {
  background: var(--surface-subtle, var(--color-bg-subtle));
}
.ap-agenda-group + .ap-agenda-group .ap-termin-row:first-child {
  margin-top: 8px;
  border-radius: var(--radius-md, 6px) var(--radius-md, 6px) 0 0;
}
.ap-termin-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 32px;
  flex-shrink: 0;
  padding-top: 2px;
}
.ap-termin-date .d {
  font-family: var(--font-display, inherit);
  font-size: var(--fs-18, 18px);
  font-weight: var(--fw-semibold, 600);
  color: var(--fg, var(--color-text));
  line-height: 1;
}
.ap-termin-date .m {
  font-family: var(--font-mono, monospace);
  font-size: var(--fs-11, 11px);
  text-transform: uppercase;
  color: var(--fg-subtle, var(--color-text-muted));
  letter-spacing: 0.04em;
  line-height: 1.2;
}
.ap-termin-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ap-termin-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--fg, var(--color-text));
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-termin-title:hover {
  color: var(--accent, var(--color-primary));
}
.ap-termin-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--fg-subtle, var(--color-text-tertiary));
}
.ap-termin-meta .font-mono {
  font-family: var(--font-mono, monospace);
}
.ap-termin-del {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 180ms ease;
  background: transparent;
  border: 0;
  color: var(--fg-subtle, var(--color-text-muted));
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm, 4px);
  flex-shrink: 0;
}
.ap-termin-row:hover .ap-termin-del {
  opacity: 1;
}
.ap-termin-del:hover {
  color: var(--danger-fg, var(--color-danger-text));
  background: var(--danger-bg, var(--color-danger-bg));
}

/* ── Week view ──────────────────────────────────────────────────────────────── */
.ap-week-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-lg, 8px);
  overflow: hidden;
  background: var(--surface, var(--color-bg));
  position: relative;
}
.ap-week-cell {
  min-height: 240px;
  padding: 8px 10px;
  border-right: 1px solid var(--hairline, var(--color-border-subtle));
  transition: background 180ms ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ap-week-cell:last-child {
  border-right: 0;
}
.ap-week-cell:hover {
  background: var(--surface-subtle, var(--color-bg-subtle));
}
.ap-week-cell.is-today {
  background: color-mix(in srgb, var(--accent, var(--color-primary)) 4%, transparent);
}
.ap-week-cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.ap-week-cell-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--fg-muted, var(--color-text-muted));
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
}
.ap-week-cell-label.is-today {
  font-weight: 600;
  color: var(--fg, var(--color-text));
}
.ap-week-add {
  opacity: 0;
  transition: opacity 180ms ease;
  width: 18px;
  height: 18px;
}
.ap-week-cell:hover .ap-week-add {
  opacity: 1;
}
.ap-week-events {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* ── Day view ───────────────────────────────────────────────────────────────── */
.ap-day-row {
  display: flex;
  min-height: 48px;
  border-bottom: 1px solid var(--hairline, var(--color-border-subtle));
}
.ap-day-row:last-child {
  border-bottom: 0;
}
.ap-day-hour {
  width: 56px;
  padding: 8px 10px;
  font-size: 11px;
  color: var(--fg-subtle, var(--color-text-tertiary));
  flex-shrink: 0;
}
.ap-day-slot {
  flex: 1;
  padding: 4px 12px;
  border-left: 1px solid var(--hairline, var(--color-border-subtle));
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ap-event-full {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-md, 6px);
  background: var(--surface-subtle, var(--color-bg-subtle));
  border: 1px solid var(--hairline, var(--color-border-subtle));
  font-size: 13px;
  color: var(--fg, var(--color-text));
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background 180ms ease;
}
.ap-event-full:hover {
  background: var(--surface-muted, var(--color-border-subtle));
}
.ap-event-time {
  font-size: 11px;
  color: var(--fg-subtle, var(--color-text-tertiary));
  flex-shrink: 0;
}
.ap-event-title {
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ap-event-loc {
  color: var(--fg-muted, var(--color-text-muted));
  font-size: 11px;
  flex-shrink: 0;
}
.ap-day-empty {
  padding: 48px 24px;
}

/* ── List view ──────────────────────────────────────────────────────────────── */
.ap-list-group {
  margin-bottom: 24px;
}
.ap-list-empty {
  font-size: 13px;
  color: var(--fg-subtle, var(--color-text-tertiary));
  text-align: center;
  padding: 32px 0;
}
.ap-list-row {
  display: flex;
  align-items: stretch;
  border-top: 1px solid var(--hairline, var(--color-border-subtle));
  transition: background 180ms ease;
}
.ap-list-row:first-child {
  border-top: 0;
}
.ap-list-row:hover {
  background: var(--surface-subtle, var(--color-bg-subtle));
}
.ap-list-btn {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  padding: 12px 16px;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.ap-list-time {
  font-size: 12px;
  color: var(--fg-muted, var(--color-text-muted));
  width: 52px;
  flex-shrink: 0;
  padding-top: 1px;
}
.ap-list-time--empty {
  color: var(--fg-faint, var(--color-text-faint));
}
.ap-list-body {
  flex: 1;
  min-width: 0;
}
.ap-list-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg, var(--color-text));
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.ap-list-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  color: var(--fg-subtle, var(--color-text-tertiary));
}
.ap-list-del {
  padding: 0 16px;
  color: var(--fg-faint, var(--color-text-faint));
  background: transparent;
  border: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 180ms ease;
  font-size: 11px;
}
.ap-list-row:hover .ap-list-del {
  opacity: 1;
}
.ap-list-del:hover {
  color: var(--danger-fg, var(--color-danger-text));
}

/* ── Empty states ───────────────────────────────────────────────────────────── */
.ap-grid-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
}
.ap-grid-empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--fg-muted, var(--color-text-muted));
}
.ap-grid-empty-hint {
  font-size: 12px;
  color: var(--fg-subtle, var(--color-text-tertiary));
  max-width: 280px;
}

/* ── Responsive ─────────────────────────────────────────────────────────────── */
@media (max-width: 1199.98px) {
  .ap-termin-layout {
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 16px;
  }
}

@media (max-width: 1023.98px) {
  .ap-termin-layout {
    grid-template-columns: 1fr;
  }
  .ap-cal-range-label {
    min-width: 120px;
    font-size: 13px;
  }
}

@media (max-width: 767.98px) {
  .ap-page {
    padding: 16px 14px 32px;
  }
  .ap-pagehead {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-bottom: 14px;
  }
  .ap-pagehead-actions {
    justify-content: flex-end;
  }
  .ap-cal-toolbar {
    gap: 8px;
  }
  .ap-cal-nav {
    flex: 1;
    justify-content: space-between;
    width: 100%;
  }
  .ap-cal-range-label {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .pt-seg-btn {
    padding: 6px 8px;
    font-size: 11px;
  }
  .ap-cal-cell {
    min-height: 56px;
    padding: 3px 4px;
  }
  .ap-cal-cell .d {
    width: 20px;
    height: 20px;
    font-size: 10px;
  }
  .ap-form-row {
    flex-direction: column;
  }
  .ap-termin-layout {
    grid-template-columns: 1fr;
  }
}
</style>
