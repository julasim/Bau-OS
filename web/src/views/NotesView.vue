<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

const router = useRouter();
const notes = ref<string[]>([]);
const newContent = ref("");
const error = ref("");

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
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold">Notizen</h2>
    </div>

    <div class="bg-white p-4 rounded-xl shadow-sm border mb-4">
      <textarea
        v-model="newContent"
        placeholder="Neue Notiz..."
        rows="3"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-y"
      ></textarea>
      <button
        @click="create"
        class="mt-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
      >
        Speichern
      </button>
    </div>

    <div class="space-y-2">
      <div
        v-for="name in notes"
        :key="name"
        class="bg-white p-3 rounded-lg border flex items-center justify-between hover:bg-gray-50 cursor-pointer"
        @click="router.push(`/notes/${encodeURIComponent(name)}`)"
      >
        <span class="text-sm font-medium">{{ name }}</span>
        <button
          @click.stop="remove(name)"
          class="text-xs text-red-500 hover:text-red-700"
        >
          Loeschen
        </button>
      </div>
      <p v-if="notes.length === 0" class="text-gray-500 text-sm">Keine Notizen vorhanden.</p>
    </div>
  </div>
</template>
