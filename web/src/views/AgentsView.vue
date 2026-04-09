<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

interface FileInfo {
  name: string;
  chars: number;
  tokens: number;
  loaded: boolean;
}

const router = useRouter();
const agents = ref<string[]>([]);
const selectedAgent = ref("");
const files = ref<FileInfo[]>([]);

async function loadAgents() {
  agents.value = await api.get<string[]>("/agents");
}

async function selectAgent(name: string) {
  selectedAgent.value = name;
  files.value = await api.get<FileInfo[]>(`/agents/${encodeURIComponent(name)}`);
}

function openFile(filename: string) {
  router.push(`/agents/${encodeURIComponent(selectedAgent.value)}/${encodeURIComponent(filename)}`);
}

onMounted(loadAgents);
</script>

<template>
  <div>
    <h2 class="text-xl font-bold mb-4">Agenten</h2>

    <div class="flex gap-2 mb-4">
      <button
        v-for="name in agents"
        :key="name"
        @click="selectAgent(name)"
        :class="selectedAgent === name ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border'"
        class="px-4 py-2 text-sm rounded-lg transition"
      >
        {{ name }}
      </button>
    </div>

    <div v-if="files.length > 0" class="space-y-1">
      <div
        v-for="f in files"
        :key="f.name"
        @click="openFile(f.name)"
        class="bg-white p-3 rounded-lg border flex items-center justify-between hover:bg-gray-50 cursor-pointer"
      >
        <span class="text-sm font-medium font-mono">{{ f.name }}</span>
        <span class="text-xs text-gray-400">{{ f.chars }} Zeichen</span>
      </div>
    </div>

    <p v-if="agents.length === 0" class="text-gray-500 text-sm">Keine Agenten vorhanden.</p>
  </div>
</template>
