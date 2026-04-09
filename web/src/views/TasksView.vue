<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";

const tasks = ref<string[]>([]);
const newTask = ref("");

async function load() {
  tasks.value = await api.get<string[]>("/tasks");
}

async function create() {
  if (!newTask.value.trim()) return;
  await api.post("/tasks", { text: newTask.value });
  newTask.value = "";
  await load();
}

async function complete(line: string) {
  const text = line.replace(/^- \[[ x]\] /, "");
  await api.patch("/tasks/complete", { text });
  await load();
}

function isOpen(line: string): boolean {
  return line.startsWith("- [ ]");
}

function taskText(line: string): string {
  return line.replace(/^- \[[ x]\] /, "");
}

onMounted(load);
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Aufgaben</h2>

    <div class="flex gap-2 mb-6">
      <input
        v-model="newTask"
        placeholder="Neue Aufgabe..."
        @keyup.enter="create"
        class="flex-1 px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
      />
      <button
        @click="create"
        class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition"
      >
        Hinzufuegen
      </button>
    </div>

    <div class="divide-y divide-gray-100">
      <div
        v-for="task in tasks"
        :key="task"
        class="flex items-center gap-3 py-2.5"
      >
        <input
          type="checkbox"
          :checked="!isOpen(task)"
          @change="complete(task)"
          :disabled="!isOpen(task)"
          class="w-4 h-4 rounded border-gray-300"
        />
        <span :class="{ 'line-through text-gray-300': !isOpen(task) }" class="text-sm text-gray-700">
          {{ taskText(task) }}
        </span>
      </div>
      <p v-if="tasks.length === 0" class="text-gray-400 text-sm py-4">Keine Aufgaben vorhanden.</p>
    </div>
  </div>
</template>
