<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";

interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
  assignees: string[];
  project: string | null;
}

const termine = ref<Termin[]>([]);
const team = ref<string[]>([]);
const editing = ref<Termin | null>(null);

// New termin form
const newDatum = ref("");
const newUhrzeit = ref("");
const newText = ref("");

async function load() {
  [termine.value, team.value] = await Promise.all([
    api.get<Termin[]>("/termine"),
    api.get<string[]>("/team"),
  ]);
}

async function create() {
  if (!newDatum.value || !newText.value) return;
  await api.post("/termine", {
    datum: newDatum.value,
    text: newText.value,
    uhrzeit: newUhrzeit.value || undefined,
  });
  newDatum.value = "";
  newUhrzeit.value = "";
  newText.value = "";
  await load();
}

function edit(t: Termin) {
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
  if (idx >= 0) {
    editing.value.assignees.splice(idx, 1);
  } else {
    editing.value.assignees.push(name);
  }
}

onMounted(load);

// Live-Updates via SSE
useEvents(["termin"], () => load());
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Termine</h2>

    <!-- Neuer Termin -->
    <div class="flex gap-2 mb-6">
      <input v-model="newDatum" type="date" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-40" />
      <input v-model="newUhrzeit" type="time" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-28" />
      <input v-model="newText" placeholder="Beschreibung..." @keyup.enter="create" class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      <button @click="create" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Erstellen</button>
    </div>

    <!-- Edit Form -->
    <div v-if="editing" class="border border-gray-200 rounded p-5 mb-6 space-y-3">
      <div>
        <label class="block text-xs text-gray-400 mb-1">Beschreibung</label>
        <input v-model="editing.text" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="block text-xs text-gray-400 mb-1">Datum</label>
          <input v-model="editing.datum" type="date" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none" />
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">Von</label>
          <input v-model="editing.uhrzeit" type="time" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none" />
        </div>
        <div>
          <label class="block text-xs text-gray-400 mb-1">Bis</label>
          <input v-model="editing.endzeit" type="time" class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none" />
        </div>
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">Ort</label>
        <input v-model="editing.location" placeholder="z.B. Buero, Baustelle..." class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">Personen</label>
        <div class="flex gap-2 flex-wrap">
          <button
            v-for="m in team"
            :key="m"
            @click="toggleAssignee(m)"
            :class="editing.assignees.includes(m) ? 'bg-gray-900 text-white' : 'text-gray-500 border-gray-200'"
            class="px-2.5 py-1 text-xs rounded border transition"
          >
            {{ m }}
          </button>
          <span v-if="team.length === 0" class="text-xs text-gray-400">Keine Team-Mitglieder. Erstelle welche unter Einstellungen.</span>
        </div>
      </div>
      <div class="flex gap-2 pt-1">
        <button @click="save(editing!)" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Speichern</button>
        <button @click="editing = null" class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600 transition">Abbrechen</button>
      </div>
    </div>

    <!-- Termine List -->
    <div class="divide-y divide-gray-100">
      <div
        v-for="t in termine"
        :key="t.id"
        class="flex items-start justify-between py-3 group"
      >
        <div>
          <p class="text-sm text-gray-700">{{ t.text }}</p>
          <div class="flex gap-3 mt-0.5 text-xs text-gray-400">
            <span>{{ t.datum }}</span>
            <span v-if="t.uhrzeit">{{ t.uhrzeit }}{{ t.endzeit ? ` – ${t.endzeit}` : '' }}</span>
            <span v-if="t.location">{{ t.location }}</span>
            <span v-if="t.assignees.length">{{ t.assignees.join(', ') }}</span>
          </div>
        </div>
        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button @click="edit(t)" class="text-xs text-gray-400 hover:text-gray-600">Bearbeiten</button>
          <button @click="remove(t.id)" class="text-xs text-gray-400 hover:text-red-500">Loeschen</button>
        </div>
      </div>
      <p v-if="termine.length === 0" class="text-gray-400 text-sm py-4">Keine Termine vorhanden.</p>
    </div>
  </div>
</template>
