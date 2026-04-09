<script setup lang="ts">
import { useRouter } from "vue-router";
import { clearToken } from "../api";

const router = useRouter();

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/notes", label: "Notizen" },
  { to: "/tasks", label: "Aufgaben" },
  { to: "/termine", label: "Termine" },
  { to: "/projects", label: "Projekte" },
  { to: "/agents", label: "Agenten" },
  { to: "/search", label: "Suche" },
  { to: "/files", label: "Dateien" },
];

function logout() {
  clearToken();
  router.push("/login");
}
</script>

<template>
  <aside class="w-52 border-r border-gray-200 flex flex-col bg-white">
    <div class="px-5 py-5 border-b border-gray-200">
      <h1 class="text-base font-semibold text-gray-900">Bau-OS</h1>
      <p class="text-xs text-gray-400 mt-0.5">Vault-Editor</p>
    </div>

    <nav class="flex-1 px-3 py-3 space-y-0.5">
      <router-link
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="block px-3 py-1.5 rounded text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition"
        active-class="!text-gray-900 !font-medium !bg-gray-100"
      >
        {{ link.label }}
      </router-link>
    </nav>

    <div class="px-3 py-3 border-t border-gray-200">
      <button
        @click="logout"
        class="w-full px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 rounded transition text-left"
      >
        Abmelden
      </button>
    </div>
  </aside>
</template>
