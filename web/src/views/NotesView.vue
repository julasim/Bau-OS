<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

const router = useRouter();
const notes = ref<string[]>([]);
const newContent = ref("");

async function load() {
  notes.value = await api.get<string[]>("/notes");
}

async function create() {
  if (!newContent.value.trim()) return;
  await api.post("/notes", { content: newContent.value });
  newContent.value = "";
  await load();
}

async function remove(name: string) {
  if (!confirm(`Notiz "${name}" wirklich loeschen?`)) return;
  await api.delete(`/notes/${encodeURIComponent(name)}`);
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <h2 class="text-lg font-semibold mb-6">Notizen</h2>

    <div class="mb-6">
      <textarea
        v-model="newContent"
        placeholder="Neue Notiz..."
        rows="3"
        class="w-full px-3 py-2 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 resize-y"
      ></textarea>
      <button
        @click="create"
        class="mt-2 px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 transition"
      >
        Speichern
      </button>
    </div>

    <div class="divide-y divide-gray-100">
      <div
        v-for="name in notes"
        :key="name"
        class="flex items-center justify-between py-2.5 cursor-pointer hover:bg-gray-50 -mx-2 px-2 rounded transition"
        @click="router.push(`/notes/${encodeURIComponent(name)}`)"
      >
        <span class="text-sm text-gray-700">{{ name }}</span>
        <button
          @click.stop="remove(name)"
          class="text-xs text-gray-400 hover:text-red-500 transition"
        >
          Loeschen
        </button>
      </div>
      <p v-if="notes.length === 0" class="text-gray-400 text-sm py-4">Keine Notizen vorhanden.</p>
    </div>
  </div>
</template>
