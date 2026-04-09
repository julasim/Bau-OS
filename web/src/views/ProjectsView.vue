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
    <h2 class="text-xl font-bold mb-4">Projekte</h2>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="p in projects"
        :key="p.name"
        @click="router.push(`/projects/${encodeURIComponent(p.name)}`)"
        class="bg-white p-5 rounded-xl shadow-sm border hover:shadow-md hover:border-blue-300 cursor-pointer transition"
      >
        <h3 class="font-bold text-lg mb-3">{{ p.name }}</h3>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div>
            <p class="text-xl font-bold text-blue-600">{{ p.notes }}</p>
            <p class="text-xs text-gray-500">Notizen</p>
          </div>
          <div>
            <p class="text-xl font-bold text-amber-600">{{ p.openTasks }}</p>
            <p class="text-xs text-gray-500">Aufgaben</p>
          </div>
          <div>
            <p class="text-xl font-bold text-green-600">{{ p.termine }}</p>
            <p class="text-xs text-gray-500">Termine</p>
          </div>
        </div>
      </div>
    </div>

    <p v-if="projects.length === 0" class="text-gray-500 text-sm">Keine Projekte vorhanden.</p>
  </div>
</template>
