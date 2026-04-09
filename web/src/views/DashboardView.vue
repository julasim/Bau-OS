<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";

interface DashboardData {
  notes: number;
  openTasks: number;
  totalTasks: number;
  todayTermine: string[];
  termine: number;
  projects: number;
  agents: string[];
}

const data = ref<DashboardData | null>(null);
const error = ref("");

onMounted(async () => {
  try {
    data.value = await api.get<DashboardData>("/dashboard");
  } catch (e: any) {
    error.value = e.message;
  }
});
</script>

<template>
  <div>
    <h2 class="text-xl font-bold mb-4">Dashboard</h2>

    <p v-if="error" class="text-red-600">{{ error }}</p>

    <div v-if="data" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white p-4 rounded-xl shadow-sm border">
        <p class="text-2xl font-bold">{{ data.notes }}</p>
        <p class="text-sm text-gray-500">Notizen</p>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm border">
        <p class="text-2xl font-bold">{{ data.openTasks }}</p>
        <p class="text-sm text-gray-500">Offene Aufgaben</p>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm border">
        <p class="text-2xl font-bold">{{ data.termine }}</p>
        <p class="text-sm text-gray-500">Termine</p>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm border">
        <p class="text-2xl font-bold">{{ data.agents.length }}</p>
        <p class="text-sm text-gray-500">Agenten</p>
      </div>
    </div>

    <div v-if="data && data.todayTermine.length > 0" class="bg-white p-4 rounded-xl shadow-sm border">
      <h3 class="font-semibold mb-2">Termine heute</h3>
      <ul class="space-y-1">
        <li v-for="t in data.todayTermine" :key="t" class="text-sm text-gray-700">{{ t }}</li>
      </ul>
    </div>
  </div>
</template>
