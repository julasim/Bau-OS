<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api, setToken } from "../api";

const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

async function login() {
  error.value = "";
  loading.value = true;
  try {
    const res = await api.post<{ token: string }>("/auth/login", {
      username: username.value,
      password: password.value,
    });
    setToken(res.token);
    router.push("/");
  } catch (e: any) {
    error.value = e.message || "Login fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="w-full max-w-xs">
      <h1 class="text-xl font-semibold text-center mb-1">Bau-OS</h1>
      <p class="text-gray-400 text-center text-sm mb-8">Workspace</p>

      <form @submit.prevent="login" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-600 mb-1">Benutzername</label>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            required
            class="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-gray-400 focus:border-gray-400 outline-none"
          />
        </div>
        <div>
          <label class="block text-sm text-gray-600 mb-1">Passwort</label>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:ring-1 focus:ring-gray-400 focus:border-gray-400 outline-none"
          />
        </div>

        <p v-if="error" class="text-red-600 text-sm">{{ error }}</p>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50 transition"
        >
          {{ loading ? "..." : "Anmelden" }}
        </button>
      </form>
    </div>
  </div>
</template>
