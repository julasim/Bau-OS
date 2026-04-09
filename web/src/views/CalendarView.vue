<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api } from "../api";

interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
  assignees: string[];
}

const termine = ref<Termin[]>([]);
const view = ref<"month" | "week" | "day">("month");
const current = ref(new Date());

const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const hours = Array.from({ length: 14 }, (_, i) => i + 7); // 07:00 - 20:00

onMounted(async () => {
  termine.value = await api.get<Termin[]>("/termine");
});

// Helpers
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(s: string): Date {
  // Accept both 2026-04-10 and 10.04.2026
  if (s.includes("-")) return new Date(s + "T00:00:00");
  const [d, m, y] = s.split(".");
  return new Date(`${y}-${m}-${d}T00:00:00`);
}

function termineForDate(dateStr: string): Termin[] {
  return termine.value.filter(t => {
    const tISO = t.datum.includes("-") ? t.datum : (() => {
      const [d, m, y] = t.datum.split(".");
      return `${y}-${m}-${d}`;
    })();
    return tISO === dateStr;
  });
}

// Month View
const monthTitle = computed(() => {
  return current.value.toLocaleDateString("de-AT", { month: "long", year: "numeric" });
});

const monthDays = computed(() => {
  const y = current.value.getFullYear();
  const m = current.value.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);

  // Monday-based: getDay() 0=Sun, convert to Mon=0
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;

  const days: { date: Date; iso: string; inMonth: boolean; today: boolean }[] = [];
  const todayISO = toISO(new Date());

  // Previous month padding
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(y, m, -i);
    days.push({ date: d, iso: toISO(d), inMonth: false, today: false });
  }
  // Current month
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(y, m, d);
    const iso = toISO(date);
    days.push({ date, iso, inMonth: true, today: iso === todayISO });
  }
  // Next month padding
  while (days.length % 7 !== 0) {
    const d = new Date(y, m + 1, days.length - startDay - last.getDate() + 1);
    days.push({ date: d, iso: toISO(d), inMonth: false, today: false });
  }

  return days;
});

// Week View
const weekStart = computed(() => {
  const d = new Date(current.value);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
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

// Day View
const dayTitle = computed(() => {
  return current.value.toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
});

const dayISO = computed(() => toISO(current.value));

// Navigation
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

function goToDate(iso: string) {
  current.value = new Date(iso + "T00:00:00");
  view.value = "day";
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-lg font-semibold">Kalender</h2>
      <div class="flex gap-1 text-sm">
        <button
          v-for="v in (['month', 'week', 'day'] as const)"
          :key="v"
          @click="view = v"
          :class="view === v ? 'text-gray-900 font-medium' : 'text-gray-400'"
          class="px-2 py-1 hover:text-gray-600 transition"
        >
          {{ v === 'month' ? 'Monat' : v === 'week' ? 'Woche' : 'Tag' }}
        </button>
      </div>
    </div>

    <!-- Navigation -->
    <div class="flex items-center gap-3 mb-4">
      <button @click="prev" class="text-gray-400 hover:text-gray-600 transition text-sm">&larr;</button>
      <span class="text-sm font-medium text-gray-700 min-w-[180px] text-center">
        {{ view === 'month' ? monthTitle : view === 'day' ? dayTitle : weekDays[0]?.label + ' – ' + weekDays[6]?.label }}
      </span>
      <button @click="next" class="text-gray-400 hover:text-gray-600 transition text-sm">&rarr;</button>
      <button @click="goToday" class="text-xs text-gray-400 hover:text-gray-600 ml-2">Heute</button>
    </div>

    <!-- MONTH VIEW -->
    <div v-if="view === 'month'">
      <div class="grid grid-cols-7 text-xs text-gray-400 mb-1">
        <div v-for="wd in weekdays" :key="wd" class="py-1 text-center">{{ wd }}</div>
      </div>
      <div class="grid grid-cols-7 border-t border-l border-gray-100">
        <div
          v-for="day in monthDays"
          :key="day.iso"
          @click="goToDate(day.iso)"
          :class="[
            day.inMonth ? 'text-gray-700' : 'text-gray-300',
            day.today ? 'bg-gray-50' : '',
          ]"
          class="border-r border-b border-gray-100 p-1.5 min-h-[80px] cursor-pointer hover:bg-gray-50 transition"
        >
          <span
            :class="day.today ? 'bg-gray-900 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs' : 'text-xs'"
            class="inline-block"
          >
            {{ day.date.getDate() }}
          </span>
          <div class="mt-0.5 space-y-0.5">
            <div
              v-for="t in termineForDate(day.iso).slice(0, 3)"
              :key="t.id"
              class="text-[10px] text-gray-500 truncate leading-tight"
            >
              {{ t.uhrzeit ? t.uhrzeit + ' ' : '' }}{{ t.text }}
            </div>
            <div v-if="termineForDate(day.iso).length > 3" class="text-[10px] text-gray-400">
              +{{ termineForDate(day.iso).length - 3 }} mehr
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- WEEK VIEW -->
    <div v-if="view === 'week'">
      <div class="grid grid-cols-7 border-t border-l border-gray-100">
        <div
          v-for="day in weekDays"
          :key="day.iso"
          @click="goToDate(day.iso)"
          :class="day.today ? 'bg-gray-50' : ''"
          class="border-r border-b border-gray-100 p-2 min-h-[200px] cursor-pointer hover:bg-gray-50 transition"
        >
          <p :class="day.today ? 'font-medium text-gray-900' : 'text-gray-500'" class="text-xs mb-2">{{ day.label }}</p>
          <div class="space-y-1">
            <div
              v-for="t in termineForDate(day.iso)"
              :key="t.id"
              class="text-xs text-gray-600 py-1 px-1.5 rounded bg-gray-100"
            >
              <span v-if="t.uhrzeit" class="text-gray-400">{{ t.uhrzeit }} </span>{{ t.text }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- DAY VIEW -->
    <div v-if="view === 'day'">
      <div class="divide-y divide-gray-100">
        <div v-for="h in hours" :key="h" class="flex min-h-[48px]">
          <div class="w-14 text-xs text-gray-400 py-2 flex-shrink-0">{{ String(h).padStart(2, '0') }}:00</div>
          <div class="flex-1 py-1 border-l border-gray-100 pl-3 space-y-1">
            <div
              v-for="t in termineForDate(dayISO).filter(t => t.uhrzeit && parseInt(t.uhrzeit) === h)"
              :key="t.id"
              class="text-sm text-gray-700 py-1 px-2 rounded bg-gray-100"
            >
              <span class="text-gray-400">{{ t.uhrzeit }}{{ t.endzeit ? ` – ${t.endzeit}` : '' }}</span>
              {{ t.text }}
              <span v-if="t.location" class="text-gray-400 text-xs ml-1">{{ t.location }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Termine ohne Uhrzeit -->
      <div v-if="termineForDate(dayISO).filter(t => !t.uhrzeit).length > 0" class="mt-4">
        <p class="text-xs text-gray-400 mb-2">Ganztaegig</p>
        <div class="space-y-1">
          <div
            v-for="t in termineForDate(dayISO).filter(t => !t.uhrzeit)"
            :key="t.id"
            class="text-sm text-gray-700 py-1.5 px-2 rounded bg-gray-50"
          >
            {{ t.text }}
            <span v-if="t.location" class="text-gray-400 text-xs ml-1">{{ t.location }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
