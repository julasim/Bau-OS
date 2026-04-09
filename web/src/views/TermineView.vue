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
    <h2 class="text-xl font-bold mb-4">Termine</h2>

    <div class="bg-white p-4 rounded-xl shadow-sm border mb-4 space-y-2">
      <div class="flex gap-2">
        <input v-model="datum" placeholder="TT.MM.JJJJ" class="px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm w-36" />
        <input v-model="uhrzeit" placeholder="HH:MM (optional)" class="px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm w-36" />
        <input v-model="text" placeholder="Beschreibung..." @keyup.enter="create" class="flex-1 px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm" />
        <button @click="create" class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">Erstellen</button>
      </div>
    </div>

    <div class="space-y-1">
      <div v-for="t in termine" :key="t" class="bg-white p-3 rounded-lg border flex items-center justify-between">
        <span class="text-sm">{{ t }}</span>
        <button @click="remove(t)" class="text-xs text-red-500 hover:text-red-700">Loeschen</button>
      </div>
      <p v-if="termine.length === 0" class="text-gray-500 text-sm">Keine Termine vorhanden.</p>
    </div>
  </div>
</template>
