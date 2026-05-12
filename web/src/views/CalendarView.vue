<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";
import ConflictDialog from "../components/ConflictDialog.vue";

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
  // Microsoft-Graph-Sync (Phase 2/3) — fuer Outlook-Badge in der UI.
  msSource?: "bau-os" | "microsoft" | null;
  msSyncStatus?: "pending" | "synced" | "conflict" | "error" | null;
}

type ViewMode = "month" | "week" | "day" | "list";

// ── State ────────────────────────────────────────────────────────────────────
const termine = ref<Termin[]>([]);
const team = ref<string[]>([]);

const VIEW_KEY = "bau-os-calendar-view";
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
  return new Date(iso + "T00:00:00").toLocaleDateString("de-AT", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}

// ── Monats-Grid ──────────────────────────────────────────────────────────────
const monthTitle = computed(() => current.value.toLocaleDateString("de-AT", { month: "long", year: "numeric" }));

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
const dayTitle = computed(() =>
  current.value.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
);
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

// Konflikt-Termine bekommen ein eigenes Dialog statt des normalen Edits.
// Der User soll erst auflösen welche Version (Bau-OS / Outlook) gewinnt
// bevor er weiter editiert — sonst riskieren wir einen Re-Konflikt
// nach dem Speichern.
const conflictTerminId = ref<string | null>(null);

function edit(t: Termin) {
  if (t.msSyncStatus === "conflict") {
    conflictTerminId.value = t.id;
    return;
  }
  showCreate.value = false;
  editing.value = { ...t, assignees: [...t.assignees] };
}

async function onConflictResolved() {
  conflictTerminId.value = null;
  await load();
  flash("success", "Konflikt aufgelöst");
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

// ── Outlook-Badge ───────────────────────────────────────────────────────────
// Zeigt mit welchem Microsoft-Status der Termin synchronisiert ist:
//   - synced/microsoft  → blaues "O" (Outlook), Termin ist in beiden Systemen
//   - pending           → oranges "O", wartet auf Push (5-min-Cron)
//   - conflict          → rotes "O", Outlook + Bau-OS sind divergiert
//   - error             → graues "O", letzter Sync fehlgeschlagen
//   - keine ms_*-Felder → kein Badge (lokaler Termin ohne MS-Verbindung)
function msBadgeFor(t: Termin): { show: boolean; cls: string; title: string } {
  if (!t.msSource && !t.msSyncStatus) return { show: false, cls: "", title: "" };
  if (t.msSyncStatus === "conflict") {
    return { show: true, cls: "ms-badge ms-badge-conflict", title: "Konflikt mit Outlook — bitte prüfen" };
  }
  if (t.msSyncStatus === "error") {
    return { show: true, cls: "ms-badge ms-badge-error", title: "Sync mit Outlook fehlgeschlagen" };
  }
  if (t.msSyncStatus === "pending") {
    return { show: true, cls: "ms-badge ms-badge-pending", title: "Wartet auf Outlook-Sync" };
  }
  // synced (oder NULL bei Migration-only) → blau
  if (t.msSource === "microsoft") {
    return { show: true, cls: "ms-badge", title: "Aus Outlook importiert" };
  }
  return { show: true, cls: "ms-badge", title: "Mit Outlook synchronisiert" };
}
</script>

<template>
  <div class="cal-page" style="padding: 24px 32px 32px; color: var(--color-text)">
    <!-- ── Flash-Message ──────────────────────────────────────── -->
    <div
      v-if="message"
      :style="{
        padding: '8px 14px',
        marginBottom: '12px',
        borderRadius: '6px',
        fontSize: '13px',
        border: '1px solid',
        background: message.type === 'success' ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
        borderColor: message.type === 'success' ? 'var(--color-success-border)' : 'var(--color-danger-border)',
        color: message.type === 'success' ? 'var(--color-success-text)' : 'var(--color-danger-text)',
      }"
    >
      {{ message.text }}
    </div>

    <!-- ── Header ─────────────────────────────────────────────── -->
    <div class="cal-header">
      <div class="cal-title min-w-0">
        <div class="eyebrow" style="margin-bottom: 6px">Arbeit</div>
        <h1 class="cal-h1">Kalender</h1>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
          {{ termine.length }} Termine insgesamt
        </p>
      </div>
      <div class="cal-toolbar">
        <!-- Navigation (nur in Grid-Ansichten) -->
        <div v-if="view !== 'list'" class="cal-nav">
          <button @click="prev" class="cal-nav-btn" aria-label="Zurück">‹</button>
          <span class="cal-range-label">{{ rangeLabel }}</span>
          <button @click="next" class="cal-nav-btn" aria-label="Vor">›</button>
          <button @click="goToday" class="bauos-btn ghost cal-today-btn">Heute</button>
        </div>

        <div class="cal-actions">
          <!-- Segmented View-Switcher -->
          <div class="flex" style="border: 1px solid var(--color-border); border-radius: 6px; overflow: hidden">
            <button
              v-for="(v, i) in VIEWS"
              :key="v.id"
              @click="view = v.id"
              :class="['seg-btn', view === v.id ? 'seg-btn-active' : '', i > 0 ? 'seg-divider' : '']"
            >
              {{ v.label }}
            </button>
          </div>

          <button @click="startCreate()" class="bauos-btn solid cal-add-btn">
            <span class="cal-add-icon">+</span>
            <span class="cal-add-label">Termin</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ── Inline Create-Formular ─────────────────────────────── -->
    <div v-if="showCreate" class="form-card">
      <div class="grid" style="grid-template-columns: 140px 120px 1fr; gap: 12px; margin-bottom: 12px">
        <div>
          <label class="eyebrow" style="display: block; margin-bottom: 4px">Datum</label>
          <input v-model="newDatum" type="date" class="form-input" />
        </div>
        <div>
          <label class="eyebrow" style="display: block; margin-bottom: 4px">Uhrzeit</label>
          <input v-model="newUhrzeit" type="time" class="form-input" />
        </div>
        <div>
          <label class="eyebrow" style="display: block; margin-bottom: 4px">Beschreibung</label>
          <input v-model="newText" placeholder="Termin…" @keyup.enter="create" class="form-input" />
        </div>
      </div>
      <div class="flex gap-2">
        <button @click="create" class="bauos-btn solid">Erstellen</button>
        <button @click="showCreate = false" class="bauos-btn ghost">Abbrechen</button>
      </div>
    </div>

    <!-- ── Inline Edit-Formular ───────────────────────────────── -->
    <div v-if="editing" class="form-card">
      <div style="margin-bottom: 12px">
        <label class="eyebrow" style="display: block; margin-bottom: 4px">Beschreibung</label>
        <input v-model="editing.text" class="form-input" />
      </div>
      <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px">
        <div>
          <label class="eyebrow" style="display: block; margin-bottom: 4px">Datum</label>
          <input v-model="editing.datum" type="date" class="form-input" />
        </div>
        <div>
          <label class="eyebrow" style="display: block; margin-bottom: 4px">Von</label>
          <input v-model="editing.uhrzeit" type="time" class="form-input" />
        </div>
        <div>
          <label class="eyebrow" style="display: block; margin-bottom: 4px">Bis</label>
          <input v-model="editing.endzeit" type="time" class="form-input" />
        </div>
      </div>
      <div style="margin-bottom: 12px">
        <label class="eyebrow" style="display: block; margin-bottom: 4px">Ort</label>
        <input v-model="editing.location" placeholder="z. B. Büro, Baustelle…" class="form-input" />
      </div>
      <div v-if="team.length > 0" style="margin-bottom: 16px">
        <label class="eyebrow" style="display: block; margin-bottom: 4px">Personen</label>
        <div class="flex flex-wrap" style="gap: 6px">
          <button
            v-for="m in team"
            :key="m"
            @click="toggleAssignee(m)"
            :class="['chip-btn', editing.assignees.includes(m) ? 'chip-btn-active' : '']"
          >
            {{ m }}
          </button>
        </div>
      </div>
      <div class="flex gap-2">
        <button @click="save(editing!)" class="bauos-btn solid">Speichern</button>
        <button @click="editing = null" class="bauos-btn ghost">Abbrechen</button>
        <div class="flex-1" />
        <button
          @click="
            remove(editing.id);
            editing = null;
          "
          class="bauos-btn ghost"
          style="color: var(--color-danger-text)"
        >
          Löschen
        </button>
      </div>
    </div>

    <!-- ── MONATS-ANSICHT ─────────────────────────────────────── -->
    <div v-if="view === 'month'">
      <div
        class="grid"
        style="
          grid-template-columns: repeat(7, minmax(0, 1fr));
          background: var(--color-bg-subtle);
          border: 1px solid var(--color-border);
          border-bottom: 0;
        "
      >
        <div v-for="wd in weekdays" :key="wd" class="eyebrow" style="padding: 8px; text-align: center">
          {{ wd }}
        </div>
      </div>
      <div
        class="grid"
        style="
          grid-template-columns: repeat(7, minmax(0, 1fr));
          grid-auto-rows: 1fr;
          border: 1px solid var(--color-border);
          position: relative;
        "
      >
        <div v-if="termine.length === 0" class="cal-grid-empty">
          <span class="cal-grid-empty-icon">📅</span>
          <span class="cal-grid-empty-title">Noch keine Termine</span>
          <span class="cal-grid-empty-hint">Klicke auf einen Tag um einen neuen Termin zu erstellen.</span>
        </div>
        <div
          v-for="day in monthDays"
          :key="day.iso"
          class="cal-day-cell"
          :class="{
            'cal-day-today': day.today,
            'cal-day-outside': !day.inMonth,
          }"
          @click="startCreate(day.iso)"
        >
          <div class="flex items-start justify-between">
            <span @click.stop="goToDate(day.iso)" :class="['cal-day-num', day.today ? 'cal-day-num-today' : '']">{{
              day.date.getDate()
            }}</span>
          </div>
          <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 2px">
            <button
              v-for="t in termineForDate(day.iso).slice(0, 3)"
              :key="t.id"
              @click.stop="edit(t)"
              class="cal-event"
            >
              <span v-if="t.uhrzeit" class="font-mono" style="color: var(--color-text-tertiary)">
                {{ t.uhrzeit }}
              </span>
              <span class="truncate" style="flex: 1">{{ t.text }}</span>
              <span v-if="msBadgeFor(t).show" :class="msBadgeFor(t).cls" :title="msBadgeFor(t).title">O</span>
            </button>
            <div
              v-if="termineForDate(day.iso).length > 3"
              style="font-size: 10px; color: var(--color-text-tertiary); padding-left: 4px"
            >
              +{{ termineForDate(day.iso).length - 3 }} weitere
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── WOCHEN-ANSICHT ─────────────────────────────────────── -->
    <div v-if="view === 'week'">
      <div
        class="grid"
        style="
          grid-template-columns: repeat(7, minmax(0, 1fr));
          border: 1px solid var(--color-border);
          position: relative;
        "
      >
        <div v-if="termine.length === 0" class="cal-grid-empty">
          <span class="cal-grid-empty-icon">📅</span>
          <span class="cal-grid-empty-title">Noch keine Termine</span>
          <span class="cal-grid-empty-hint">Klicke auf einen Tag um einen neuen Termin zu erstellen.</span>
        </div>
        <div v-for="day in weekDays" :key="day.iso" class="cal-week-cell" :class="{ 'cal-day-today': day.today }">
          <div class="flex items-center justify-between" style="margin-bottom: 8px">
            <button
              @click="goToDate(day.iso)"
              :style="{
                fontSize: '11px',
                fontWeight: day.today ? 600 : 500,
                color: day.today ? 'var(--color-text)' : 'var(--color-text-muted)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }"
            >
              {{ day.label }}
            </button>
            <button @click="startCreate(day.iso)" class="cal-add-btn">+</button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px">
            <button v-for="t in termineForDate(day.iso)" :key="t.id" @click="edit(t)" class="cal-event">
              <span v-if="t.uhrzeit" class="font-mono" style="color: var(--color-text-tertiary)">
                {{ t.uhrzeit }}
              </span>
              <span class="truncate" style="flex: 1">{{ t.text }}</span>
              <span v-if="msBadgeFor(t).show" :class="msBadgeFor(t).cls" :title="msBadgeFor(t).title">O</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── TAGES-ANSICHT ──────────────────────────────────────── -->
    <div v-if="view === 'day'">
      <div v-if="termineForDate(dayISO).length === 0" class="cal-day-empty">
        <span style="font-size: 28px; line-height: 1">📅</span>
        <span style="font-size: 14px; font-weight: 500; color: var(--color-text-muted)">Noch keine Termine</span>
        <span style="font-size: 12px; color: var(--color-text-tertiary)"
          >Klicke auf einen Tag um einen neuen Termin zu erstellen.</span
        >
      </div>
      <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
        <div
          v-for="h in hours"
          :key="h"
          class="flex"
          style="min-height: 48px; border-bottom: 1px solid var(--color-border-subtle)"
        >
          <div
            class="font-mono"
            style="width: 56px; padding: 8px 10px; font-size: 11px; color: var(--color-text-tertiary); flex-shrink: 0"
          >
            {{ String(h).padStart(2, "0") }}:00
          </div>
          <div
            style="
              flex: 1;
              padding: 4px 12px;
              border-left: 1px solid var(--color-border-subtle);
              display: flex;
              flex-direction: column;
              gap: 4px;
            "
          >
            <button
              v-for="t in termineForDate(dayISO).filter((t) => t.uhrzeit && parseInt(t.uhrzeit) === h)"
              :key="t.id"
              @click="edit(t)"
              class="cal-event-big"
            >
              <span class="font-mono" style="font-size: 11px; color: var(--color-text-tertiary)">
                {{ t.uhrzeit }}{{ t.endzeit ? ` – ${t.endzeit}` : "" }}
              </span>
              <span style="font-weight: 500">{{ t.text }}</span>
              <span v-if="t.location" style="color: var(--color-text-muted); font-size: 11px">
                · {{ t.location }}
              </span>
              <span
                v-if="msBadgeFor(t).show"
                :class="msBadgeFor(t).cls"
                :title="msBadgeFor(t).title"
                style="margin-left: auto"
                >O</span
              >
            </button>
          </div>
        </div>
      </div>

      <div v-if="termineForDate(dayISO).filter((t) => !t.uhrzeit).length > 0" style="margin-top: 16px">
        <div class="eyebrow" style="margin-bottom: 8px">Ganztägig</div>
        <div style="display: flex; flex-direction: column; gap: 4px">
          <button
            v-for="t in termineForDate(dayISO).filter((t) => !t.uhrzeit)"
            :key="t.id"
            @click="edit(t)"
            class="cal-event-big"
          >
            <span style="font-weight: 500">{{ t.text }}</span>
            <span v-if="t.location" style="color: var(--color-text-muted); font-size: 11px"> · {{ t.location }} </span>
            <span
              v-if="msBadgeFor(t).show"
              :class="msBadgeFor(t).cls"
              :title="msBadgeFor(t).title"
              style="margin-left: auto"
              >O</span
            >
          </button>
        </div>
      </div>
    </div>

    <!-- ── LISTEN-ANSICHT ─────────────────────────────────────── -->
    <div v-if="view === 'list'">
      <div v-for="group in grouped" :key="group.date" style="margin-bottom: 24px">
        <div class="eyebrow" style="margin-bottom: 8px">{{ group.label }}</div>
        <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
          <div v-for="t in group.items" :key="t.id" class="cal-list-row">
            <button @click="edit(t)" class="cal-list-btn">
              <span
                v-if="t.uhrzeit"
                class="font-mono"
                style="font-size: 12px; color: var(--color-text-muted); width: 52px; flex-shrink: 0"
                >{{ t.uhrzeit }}</span
              >
              <span
                v-else
                class="font-mono"
                style="font-size: 12px; color: var(--color-text-faint); width: 52px; flex-shrink: 0"
                >–:–</span
              >
              <div class="min-w-0" style="flex: 1">
                <div
                  style="
                    font-size: 13px;
                    color: var(--color-text);
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                  "
                >
                  <span>{{ t.text }}</span>
                  <span v-if="msBadgeFor(t).show" :class="msBadgeFor(t).cls" :title="msBadgeFor(t).title">O</span>
                </div>
                <div
                  class="flex flex-wrap"
                  style="gap: 12px; margin-top: 2px; font-size: 11px; color: var(--color-text-tertiary)"
                >
                  <span v-if="t.endzeit" class="font-mono">bis {{ t.endzeit }}</span>
                  <span v-if="t.location">{{ t.location }}</span>
                  <span v-if="t.assignees.length">{{ t.assignees.join(", ") }}</span>
                </div>
              </div>
            </button>
            <button @click="remove(t.id)" class="cal-del-btn" aria-label="Löschen">
              <span style="font-size: 11px">Löschen</span>
            </button>
          </div>
        </div>
      </div>
      <p
        v-if="termine.length === 0"
        style="font-size: 13px; color: var(--color-text-tertiary); text-align: center; padding: 32px 0"
      >
        Keine Termine vorhanden.
      </p>
    </div>

    <!-- Konflikt-Auflösungs-Dialog (Phase 5b). Wird von edit() aufgerufen
         wenn der Termin ms_sync_status='conflict' hat. -->
    <ConflictDialog
      v-if="conflictTerminId"
      :termin-id="conflictTerminId"
      @close="conflictTerminId = null"
      @resolved="onConflictResolved"
    />
  </div>
</template>

<style scoped>
.cal-nav-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  transition: all 180ms ease;
}
.cal-nav-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.seg-btn {
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 180ms ease,
    color 180ms ease;
}
.seg-btn-active {
  background: var(--color-border-subtle);
  color: var(--color-text);
}
.seg-divider {
  border-left: 1px solid var(--color-border);
}

.form-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
  background: var(--color-bg);
}

.form-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
}

.chip-btn {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition: all 180ms ease;
}
.chip-btn-active {
  background: var(--color-primary);
  color: var(--color-bg);
  border-color: var(--color-primary);
}

/* Kalender-Zellen */
.cal-day-cell {
  min-height: 96px;
  padding: 6px 8px;
  border-right: 1px solid var(--color-border-subtle);
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 180ms ease;
  position: relative;
}
.cal-day-cell:hover {
  background: var(--color-bg-subtle);
}
.cal-day-cell:nth-child(7n) {
  border-right: 0;
}
.cal-day-outside {
  background: var(--color-bg-muted);
  color: var(--color-text-faint);
}
.cal-day-today {
  background: var(--color-bg-subtle);
}

.cal-day-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  line-height: 1;
  color: var(--color-text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  font-weight: 500;
}
.cal-day-outside .cal-day-num {
  color: var(--color-text-faint);
}
.cal-day-num-today {
  background: var(--color-primary);
  color: var(--color-bg);
}

.cal-event {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--color-border-subtle);
  border-left: 2px solid var(--color-text);
  font-size: 10px;
  color: var(--color-text-secondary);
  cursor: pointer;
  width: 100%;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  transition: background 180ms ease;
}
.cal-event:hover {
  background: var(--color-border);
}

/* Outlook-Sync-Badges (Phase 2/3) — Visualisierung woher der Termin kommt
   und ob er gerade in Sync ist. Outlook-Blau ist Microsofts Brand-Farbe. */
.ms-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: #0078d4;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  letter-spacing: -0.5px;
  user-select: none;
}
.ms-badge-pending {
  background: #f59e0b;
}
.ms-badge-conflict {
  background: #dc2626;
}
.ms-badge-error {
  background: #6b7280;
}

.cal-event-big {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-subtle);
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  transition: background 180ms ease;
}
.cal-event-big:hover {
  background: var(--color-border-subtle);
}

.cal-week-cell {
  min-height: 240px;
  padding: 8px 10px;
  border-right: 1px solid var(--color-border-subtle);
  transition: background 180ms ease;
}
.cal-week-cell:nth-child(7n) {
  border-right: 0;
}
.cal-week-cell:hover {
  background: var(--color-bg-subtle);
}

.cal-add-btn {
  opacity: 0;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 12px;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  transition: all 180ms ease;
}
.cal-day-cell:hover .cal-add-btn,
.cal-week-cell:hover .cal-add-btn {
  opacity: 1;
}
.cal-add-btn:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.cal-list-row {
  display: flex;
  align-items: stretch;
  border-top: 1px solid var(--color-border-subtle);
}
.cal-list-row:first-child {
  border-top: 0;
}
.cal-list-row:hover {
  background: var(--color-bg-subtle);
}
.cal-list-btn {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 1;
  padding: 12px 16px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
}
.cal-del-btn {
  padding: 0 16px;
  color: var(--color-text-faint);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 180ms ease;
}
.cal-list-row:hover .cal-del-btn {
  opacity: 1;
}
.cal-del-btn:hover {
  color: var(--color-danger-text);
}

/* ── Header (Phase 2 Mobile-Fix) ────────────────────────── */
.cal-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.cal-h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
  color: var(--color-text);
}
.cal-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.cal-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cal-range-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  min-width: 180px;
  text-align: center;
}
.cal-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cal-add-icon {
  display: none;
}

@media (max-width: 1023.98px) {
  /* Tablet: Header bleibt 1 Zeile, Range-Label wird kompakter */
  .cal-range-label {
    min-width: 120px;
    font-size: 12px;
  }
}

@media (max-width: 767.98px) {
  /* Mobile: Title oben, Toolbar darunter — alles wrap */
  .cal-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    margin-bottom: 14px;
  }
  .cal-h1 {
    font-size: 20px;
  }
  .cal-title p {
    margin-top: 2px !important;
  }
  .cal-toolbar {
    justify-content: space-between;
    gap: 8px;
  }
  .cal-nav {
    flex: 1;
    justify-content: space-between;
    width: 100%;
  }
  .cal-range-label {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .cal-today-btn {
    padding: 6px 10px !important;
    font-size: 12px !important;
  }
  .cal-actions {
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }
  /* "+ Termin" auf Mobile auf reines Plus-Icon (spart Platz) */
  .cal-add-btn {
    padding: 6px 12px !important;
  }
  .cal-add-label {
    display: none;
  }
  .cal-add-icon {
    display: inline;
    font-size: 16px;
    font-weight: 600;
  }
  /* Segmented View-Switcher: kleinere Padding */
  .seg-btn {
    padding: 6px 10px !important;
    font-size: 11px !important;
  }

  /* Monats-Zellen: kompakter auf Phone, falls User trotzdem Monat waehlt */
  .cal-day-cell {
    min-height: 56px !important;
    padding: 3px 4px !important;
  }
  .cal-day-num {
    width: 22px !important;
    height: 22px !important;
    font-size: 10px !important;
  }

  /* Aussen-Padding der Page reduzieren (war 28px 32px) */
  .cal-page {
    padding: 16px 14px 32px !important;
  }
}

/* ── Grid Empty States (Monat + Woche) ────────────────── */
/* Das Element spannt das gesamte 7-Spalten-Grid und
   wird absolut über die Grid-Zellen gelegt. */
.cal-grid-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
  z-index: 1;
}
.cal-grid-empty-icon {
  font-size: 28px;
  line-height: 1;
}
.cal-grid-empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
}
.cal-grid-empty-hint {
  font-size: 12px;
  color: var(--color-text-tertiary);
  text-align: center;
  max-width: 280px;
}

/* ── Tages-Ansicht Empty State ─────────────────────────── */
.cal-day-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 48px 24px;
  text-align: center;
}
</style>
