<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

interface ProjectInfo {
  name: string;
  notes: number;
  openTasks: number;
  termine: number;
}

const router = useRouter();
const projects = ref<ProjectInfo[]>([]);

onMounted(async () => {
  projects.value = await api.get<ProjectInfo[]>("/projects");
});
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Projekte</h2>

    <div class="divide-y divide-gray-100">
      <div
        v-for="p in projects"
        :key="p.name"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
        class="flex items-center justify-between py-3 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded transition"
      >
        <span class="text-sm font-medium text-gray-900">{{ p.name }}</span>
        <div class="flex gap-4 text-xs text-gray-400">
          <span>{{ p.notes }} Notizen</span>
          <span>{{ p.openTasks }} Aufgaben</span>
          <span>{{ p.termine }} Termine</span>
        </div>
      </div>
    </div>

    <p v-if="projects.length === 0" class="text-gray-400 text-sm py-4">Keine Projekte vorhanden.</p>
  </div>
</template>
