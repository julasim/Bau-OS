<script setup lang="ts">
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

const VIEW_KEY = "bau-os-calendar-view";
const view = ref<ViewMode>(
  ((): ViewMode => {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "week" || v === "day" || v === "list" ? v : "month";
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
const monthTitle = computed(() =>
  current.value.toLocaleDateString("de-AT", { month: "long", year: "numeric" }),
);

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
}

function edit(t: Termin) {
  showCreate.value = false;
  editing.value = { ...t, assignees: [...t.assignees] };
}

async function save(t: Termin) {
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
}

async function remove(id: string) {
  await api.delete(`/termine/${id}`);
  await load();
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
</script>

<template>
  <div>
    <!-- ── Header ─────────────────────────────────────────────── -->
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-lg font-semibold">Kalender</h2>
      <div class="flex items-center gap-3">
        <button
          @click="startCreate()"
          class="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition"
        >
          + Neuer Termin
        </button>
        <div class="flex gap-1 text-xs">
          <button
            v-for="v in VIEWS"
            :key="v.id"
            @click="view = v.id"
            :class="view === v.id ? 'text-gray-900 font-medium' : 'text-gray-400'"
            class="px-2 py-1 hover:text-gray-600 transition"
          >
            {{ v.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Navigation (nur in Grid-Ansichten) ─────────────────── -->
    <div v-if="view !== 'list'" class="flex items-center gap-3 mb-4">
      <button @click="prev" class="text-gray-400 hover:text-gray-600 transition text-sm">←</button>
      <span class="text-sm font-medium text-gray-700 min-w-[200px] text-center">{{ rangeLabel }}</span>
      <button @click="next" class="text-gray-400 hover:text-gray-600 transition text-sm">→</button>
      <button
        @click="goToday"
        class="text-xs text-gray-400 hover:text-gray-600 ml-2"
      >Heute</button>
    </div>

    <!-- ── Inline Create-Formular ─────────────────────────────── -->
    <div v-if="showCreate" class="border border-gray-200 rounded-lg p-4 mb-5 space-y-3">
      <div class="grid grid-cols-[140px_120px_1fr] gap-3">
        <div>
          <label class="block text-[11px] text-gray-400 mb-1">Datum</label>
          <input
            v-model="newDatum"
            type="date"
            class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
        <div>
          <label class="block text-[11px] text-gray-400 mb-1">Uhrzeit</label>
          <input
            v-model="newUhrzeit"
            type="time"
            class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
        <div>
          <label class="block text-[11px] text-gray-400 mb-1">Beschreibung</label>
          <input
            v-model="newText"
            placeholder="Termin..."
            @keyup.enter="create"
            class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
      </div>
      <div class="flex gap-2">
        <button
          @click="create"
          class="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition"
        >Erstellen</button>
        <button
          @click="showCreate = false"
          class="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition"
        >Abbrechen</button>
      </div>
    </div>

    <!-- ── Inline Edit-Formular ───────────────────────────────── -->
    <div v-if="editing" class="border border-gray-200 rounded-lg p-4 mb-5 space-y-3">
      <div>
        <label class="block text-[11px] text-gray-400 mb-1">Beschreibung</label>
        <input
          v-model="editing.text"
          class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-[11px] text-gray-400 mb-1">Datum</label>
          <input v-model="editing.datum" type="date" class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none" />
        </div>
        <div>
          <label class="block text-[11px] text-gray-400 mb-1">Von</label>
          <input v-model="editing.uhrzeit" type="time" class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none" />
        </div>
        <div>
          <label class="block text-[11px] text-gray-400 mb-1">Bis</label>
          <input v-model="editing.endzeit" type="time" class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none" />
        </div>
      </div>
      <div>
        <label class="block text-[11px] text-gray-400 mb-1">Ort</label>
        <input
          v-model="editing.location"
          placeholder="z.B. Buero, Baustelle..."
          class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>
      <div v-if="team.length > 0">
        <label class="block text-[11px] text-gray-400 mb-1">Personen</label>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="m in team"
            :key="m"
            @click="toggleAssignee(m)"
            :class="editing.assignees.includes(m) ? 'bg-gray-900 text-white' : 'text-gray-500 border-gray-200'"
            class="px-2.5 py-1 text-xs rounded border transition"
          >{{ m }}</button>
        </div>
      </div>
      <div class="flex gap-2 pt-1">
        <button @click="save(editing!)" class="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Speichern</button>
        <button @click="editing = null" class="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition">Abbrechen</button>
        <div class="flex-1" />
        <button @click="remove(editing.id); editing = null" class="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500 transition">Loeschen</button>
      </div>
    </div>

    <!-- ── MONATS-ANSICHT ─────────────────────────────────────── -->
    <div v-if="view === 'month'">
      <div class="grid grid-cols-7 text-xs text-gray-400 mb-1">
        <div v-for="wd in weekdays" :key="wd" class="py-1 text-center">{{ wd }}</div>
      </div>
      <div class="grid grid-cols-7 border-t border-l border-gray-100">
        <div
          v-for="day in monthDays"
          :key="day.iso"
          :class="[
            day.inMonth ? 'text-gray-700' : 'text-gray-300',
            day.today ? 'bg-gray-50' : '',
          ]"
          class="relative border-r border-b border-gray-100 p-1.5 min-h-[90px] hover:bg-gray-50 transition group"
        >
          <div class="flex items-start justify-between">
            <span
              @click="goToDate(day.iso)"
              :class="day.today
                ? 'bg-gray-900 text-white rounded-full w-7 h-7 text-[11px] leading-none font-medium'
                : 'w-7 h-7 text-xs leading-none'"
              class="inline-flex items-center justify-center cursor-pointer flex-shrink-0"
            >{{ day.date.getDate() }}</span>
            <button
              @click.stop="startCreate(day.iso)"
              title="Termin an diesem Tag erstellen"
              class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-900 text-xs leading-none transition"
            >+</button>
          </div>
          <div class="mt-0.5 space-y-0.5">
            <button
              v-for="t in termineForDate(day.iso).slice(0, 3)"
              :key="t.id"
              @click.stop="edit(t)"
              class="block w-full text-left text-[10px] text-gray-600 truncate leading-tight hover:text-gray-900 transition"
            >
              <span v-if="t.uhrzeit" class="text-gray-400">{{ t.uhrzeit }} </span>{{ t.text }}
            </button>
            <div v-if="termineForDate(day.iso).length > 3" class="text-[10px] text-gray-400">
              +{{ termineForDate(day.iso).length - 3 }} mehr
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── WOCHEN-ANSICHT ─────────────────────────────────────── -->
    <div v-if="view === 'week'">
      <div class="grid grid-cols-7 border-t border-l border-gray-100">
        <div
          v-for="day in weekDays"
          :key="day.iso"
          :class="day.today ? 'bg-gray-50' : ''"
          class="border-r border-b border-gray-100 p-2 min-h-[240px] group hover:bg-gray-50 transition"
        >
          <div class="flex items-center justify-between mb-2">
            <button
              @click="goToDate(day.iso)"
              :class="day.today ? 'font-medium text-gray-900' : 'text-gray-500 hover:text-gray-900'"
              class="text-xs transition"
            >{{ day.label }}</button>
            <button
              @click="startCreate(day.iso)"
              class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-900 text-xs leading-none transition"
            >+</button>
          </div>
          <div class="space-y-1">
            <button
              v-for="t in termineForDate(day.iso)"
              :key="t.id"
              @click="edit(t)"
              class="block w-full text-left text-xs text-gray-600 py-1 px-1.5 rounded bg-gray-100 hover:bg-gray-200 transition"
            >
              <span v-if="t.uhrzeit" class="text-gray-400">{{ t.uhrzeit }} </span>{{ t.text }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── TAGES-ANSICHT ──────────────────────────────────────── -->
    <div v-if="view === 'day'">
      <div class="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
        <div v-for="h in hours" :key="h" class="flex min-h-[52px]">
          <div class="w-16 text-xs text-gray-400 py-2 px-3 flex-shrink-0">{{ String(h).padStart(2, "0") }}:00</div>
          <div class="flex-1 py-1 pr-3 border-l border-gray-100 pl-3 space-y-1">
            <button
              v-for="t in termineForDate(dayISO).filter(t => t.uhrzeit && parseInt(t.uhrzeit) === h)"
              :key="t.id"
              @click="edit(t)"
              class="block w-full text-left text-sm text-gray-700 py-1 px-2 rounded bg-gray-100 hover:bg-gray-200 transition"
            >
              <span class="text-gray-400 text-xs mr-1">
                {{ t.uhrzeit }}{{ t.endzeit ? ` – ${t.endzeit}` : "" }}
              </span>
              {{ t.text }}
              <span v-if="t.location" class="text-gray-400 text-xs ml-1">· {{ t.location }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="termineForDate(dayISO).filter(t => !t.uhrzeit).length > 0" class="mt-4">
        <p class="text-[11px] uppercase tracking-wider text-gray-400 mb-2">Ganztaegig</p>
        <div class="space-y-1">
          <button
            v-for="t in termineForDate(dayISO).filter(t => !t.uhrzeit)"
            :key="t.id"
            @click="edit(t)"
            class="block w-full text-left text-sm text-gray-700 py-1.5 px-2 rounded bg-gray-50 hover:bg-gray-100 transition"
          >
            {{ t.text }}
            <span v-if="t.location" class="text-gray-400 text-xs ml-1">· {{ t.location }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ── LISTEN-ANSICHT ─────────────────────────────────────── -->
    <div v-if="view === 'list'">
      <div v-for="group in grouped" :key="group.date" class="mb-6">
        <h3 class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{{ group.label }}</h3>
        <div class="divide-y divide-gray-100">
          <div
            v-for="t in group.items"
            :key="t.id"
            class="flex items-start justify-between py-3 group"
          >
            <button
              @click="edit(t)"
              class="flex items-start gap-3 flex-1 text-left hover:bg-gray-50 rounded px-2 -mx-2 py-1 -my-1 transition"
            >
              <span v-if="t.uhrzeit" class="text-sm font-mono text-gray-500 w-12 flex-shrink-0 pt-0.5">{{ t.uhrzeit }}</span>
              <span v-else class="text-sm font-mono text-gray-300 w-12 flex-shrink-0 pt-0.5">--:--</span>
              <div>
                <p class="text-sm text-gray-700">{{ t.text }}</p>
                <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-gray-400">
                  <span v-if="t.endzeit">bis {{ t.endzeit }}</span>
                  <span v-if="t.location">{{ t.location }}</span>
                  <span v-if="t.assignees.length">{{ t.assignees.join(", ") }}</span>
                </div>
              </div>
            </button>
            <button
              @click="remove(t.id)"
              class="ml-2 text-xs text-gray-400 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
            >Loeschen</button>
          </div>
        </div>
      </div>
      <p v-if="termine.length === 0" class="text-gray-400 text-sm py-6 text-center">Keine Termine vorhanden.</p>
    </div>
  </div>
</template>
