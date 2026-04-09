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
    <h2 class="text-lg font-semibold mb-6">Dashboard</h2>

    <p v-if="error" class="text-red-600 text-sm">{{ error }}</p>

    <div v-if="data" class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.notes }}</p>
        <p class="text-sm text-gray-400">Notizen</p>
      </div>
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.openTasks }}</p>
        <p class="text-sm text-gray-400">Offene Aufgaben</p>
      </div>
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.termine }}</p>
        <p class="text-sm text-gray-400">Termine</p>
      </div>
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.agents.length }}</p>
        <p class="text-sm text-gray-400">Agenten</p>
      </div>
    </div>

    <div v-if="data && data.todayTermine.length > 0">
      <h3 class="text-sm font-medium text-gray-500 mb-2">Termine heute</h3>
      <ul class="space-y-1">
        <li v-for="t in data.todayTermine" :key="t" class="text-sm text-gray-700">{{ t }}</li>
      </ul>
    </div>
  </div>
</template>
