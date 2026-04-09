<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";

const termine = ref<string[]>([]);
const datum = ref("");
const text = ref("");
const uhrzeit = ref("");

async function load() {
  termine.value = await api.get<string[]>("/termine");
}

async function create() {
  if (!datum.value || !text.value) return;
  await api.post("/termine", { datum: datum.value, text: text.value, uhrzeit: uhrzeit.value || undefined });
  datum.value = "";
  text.value = "";
  uhrzeit.value = "";
  await load();
}

async function remove(line: string) {
  await api.delete("/termine", { text: line });
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Termine</h2>

    <div class="flex gap-2 mb-6">
      <input v-model="datum" placeholder="TT.MM.JJJJ" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-32" />
      <input v-model="uhrzeit" placeholder="HH:MM" class="px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 w-24" />
      <input v-model="text" placeholder="Beschreibung..." @keyup.enter="create" class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400" />
      <button @click="create" class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition">Erstellen</button>
    </div>

    <div class="divide-y divide-gray-100">
      <div v-for="t in termine" :key="t" class="flex items-center justify-between py-2.5">
        <span class="text-sm text-gray-700">{{ t }}</span>
        <button @click="remove(t)" class="text-xs text-gray-400 hover:text-red-500 transition">Loeschen</button>
      </div>
      <p v-if="termine.length === 0" class="text-gray-400 text-sm py-4">Keine Termine vorhanden.</p>
    </div>
  </div>
</template>
