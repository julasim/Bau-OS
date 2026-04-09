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
    <h2 class="text-lg font-semibold mb-6">Agenten</h2>

    <div class="flex gap-2 mb-6">
      <button
        v-for="name in agents"
        :key="name"
        @click="selectAgent(name)"
        :class="selectedAgent === name ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'"
        class="px-3 py-1.5 text-sm rounded border border-gray-200 transition"
      >
        {{ name }}
      </button>
    </div>

    <div v-if="files.length > 0" class="divide-y divide-gray-100">
      <div
        v-for="f in files"
        :key="f.name"
        @click="openFile(f.name)"
        class="flex items-center justify-between py-2.5 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded transition"
      >
        <span class="text-sm font-mono text-gray-700">{{ f.name }}</span>
        <span class="text-xs text-gray-400">{{ f.chars }} Zeichen</span>
      </div>
    </div>

    <p v-if="agents.length === 0" class="text-gray-400 text-sm">Keine Agenten vorhanden.</p>
  </div>
</template>
