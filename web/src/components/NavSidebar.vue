<script setup lang="ts">
import { useRouter } from "vue-router";
import { clearToken } from "../api";

const router = useRouter();

const links = [
  { to: "/", label: "Dashboard", icon: "~" },
  { to: "/notes", label: "Notizen", icon: "N" },
  { to: "/tasks", label: "Aufgaben", icon: "A" },
  { to: "/termine", label: "Termine", icon: "T" },
  { to: "/agents", label: "Agenten", icon: "G" },
  { to: "/search", label: "Suche", icon: "S" },
  { to: "/files", label: "Dateien", icon: "D" },
];

function logout() {
  clearToken();
  router.push("/login");
}
</script>

<template>
  <aside class="w-56 bg-white border-r border-gray-200 flex flex-col">
    <div class="p-4 border-b border-gray-200">
      <h1 class="text-lg font-bold">Bau-OS</h1>
      <p class="text-xs text-gray-500">Vault-Editor</p>
    </div>

    <nav class="flex-1 p-2 space-y-1">
      <router-link
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition"
        active-class="bg-blue-50 text-blue-700 font-medium"
      >
        <span class="w-5 h-5 flex items-center justify-center text-xs font-bold bg-gray-200 rounded">{{ link.icon }}</span>
        {{ link.label }}
      </router-link>
    </nav>

    <div class="p-2 border-t border-gray-200">
      <button
        @click="logout"
        class="w-full px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition text-left"
      >
        Abmelden
      </button>
    </div>
  </aside>
</template>
