<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";
import { useEvents } from "../composables/useEvents";

interface DashboardData {
  notes: number;
  openTasks: number;
  totalTasks: number;
  todayTermine: string[];
  termine: number;
  projects: number;
  agents: string[];
}

interface DbStatus {
  enabled: boolean;
  mode?: string;
  healthy?: boolean;
  pgvector?: boolean;
}

interface EmbeddingStats {
  enabled: boolean;
  notes?: { total: number; embedded: number };
  files?: { total: number; embedded: number };
}

const data = ref<DashboardData | null>(null);
const dbStatus = ref<DbStatus | null>(null);
const embedStats = ref<EmbeddingStats | null>(null);
const error = ref("");

async function load() {
  try {
    data.value = await api.get<DashboardData>("/dashboard");
  } catch (e: any) {
    error.value = e.message;
  }
}

async function loadExtras() {
  try {
    [dbStatus.value, embedStats.value] = await Promise.all([
      api.get<DbStatus>("/dashboard/db-status"),
      api.get<EmbeddingStats>("/search/stats"),
    ]);
  } catch {
    // Optional — ignorieren wenn Endpoints nicht da
  }
}

onMounted(async () => {
  await load();
  loadExtras();
});

// Live-Updates
useEvents(["task", "termin", "note"], () => load());
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Dashboard</h2>

    <p v-if="error" class="text-red-600 text-sm">{{ error }}</p>

    <div v-if="data" class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.openTasks }}</p>
        <p class="text-sm text-gray-400">Offene Aufgaben</p>
      </div>
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.termine }}</p>
        <p class="text-sm text-gray-400">Termine</p>
      </div>
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.notes }}</p>
        <p class="text-sm text-gray-400">Notizen</p>
      </div>
      <div>
        <p class="text-2xl font-semibold text-gray-900">{{ data.projects }}</p>
        <p class="text-sm text-gray-400">Projekte</p>
      </div>
    </div>

    <!-- Heute -->
    <div v-if="data && data.todayTermine.length > 0" class="mb-8">
      <h3 class="text-sm font-medium text-gray-500 mb-2">Termine heute</h3>
      <ul class="divide-y divide-gray-100">
        <li v-for="t in data.todayTermine" :key="t" class="text-sm text-gray-700 py-2">{{ t }}</li>
      </ul>
    </div>

    <!-- System-Status -->
    <div v-if="dbStatus" class="mb-8">
      <h3 class="text-sm font-medium text-gray-500 mb-2">System</h3>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div class="flex items-center gap-2">
          <span :class="dbStatus.enabled && dbStatus.healthy ? 'bg-green-400' : dbStatus.enabled ? 'bg-red-400' : 'bg-gray-300'" class="w-2 h-2 rounded-full"></span>
          <span class="text-gray-600">{{ dbStatus.mode === 'database' ? 'PostgreSQL' : 'Filesystem' }}</span>
        </div>
        <div v-if="dbStatus.enabled" class="flex items-center gap-2">
          <span :class="dbStatus.pgvector ? 'bg-green-400' : 'bg-gray-300'" class="w-2 h-2 rounded-full"></span>
          <span class="text-gray-600">pgvector</span>
        </div>
        <div v-if="embedStats?.enabled && embedStats.notes" class="text-gray-600">
          Embeddings: {{ embedStats.notes.embedded }}/{{ embedStats.notes.total }}
        </div>
        <div v-if="data" class="text-gray-600">
          Agenten: {{ data.agents.length }}
        </div>
      </div>
    </div>

    <!-- Agenten -->
    <div v-if="data && data.agents.length > 0">
      <h3 class="text-sm font-medium text-gray-500 mb-2">Aktive Agenten</h3>
      <div class="flex flex-wrap gap-2">
        <span v-for="a in data.agents" :key="a" class="px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-600">{{ a }}</span>
      </div>
    </div>
  </div>
</template>
