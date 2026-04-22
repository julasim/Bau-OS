<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api, setToken } from "../api";

const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

// Hostname aus dem Browser uebernehmen — keine hardcoded Firma mehr.
const hostname = computed(() =>
  typeof window !== "undefined" ? window.location.host : "bau-os",
);

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
  <div class="flex" style="min-height: 100vh; background: var(--color-bg)">
    <!-- Linke Hälfte: dunkel, Brand-Panel -->
    <div
      class="flex flex-col"
      style="
        flex: 1;
        background: var(--color-login-bg);
        color: #fff;
        padding: 48px;
        justify-content: space-between;
      "
    >
      <div class="flex items-center" style="gap: 12px">
        <div
          style="
            width: 32px;
            height: 32px;
            border-radius: 6px;
            background: #fff;
            color: var(--color-login-bg);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 14px;
            letter-spacing: -0.02em;
          "
        >
          B
        </div>
        <div>
          <div style="font-size: 14px; font-weight: 600">Bau-OS</div>
          <div
            style="
              font-size: 10px;
              color: var(--color-login-text-secondary);
              text-transform: uppercase;
              letter-spacing: 0.08em;
              margin-top: 2px;
            "
          >
            Workspace
          </div>
        </div>
      </div>

      <div style="max-width: 480px">
        <h1
          style="
            font-size: 36px;
            font-weight: 600;
            letter-spacing: -0.02em;
            line-height: 1.2;
            margin: 0 0 16px 0;
          "
        >
          KI-Plattform für Büros und Bauunternehmen.
        </h1>
        <p
          style="
            font-size: 14px;
            color: var(--color-login-text-secondary);
            line-height: 1.6;
            margin: 0 0 24px 0;
          "
        >
          Self-hosted. DSGVO-konform. Obsidian + Telegram.
          Deine Daten bleiben auf deinem Server.
        </p>
        <div class="flex flex-wrap" style="gap: 8px">
          <span
            v-for="tag in ['Self-hosted', 'EU-Server', 'Art. 28', 'Open Source']"
            :key="tag"
            style="
              padding: 4px 10px;
              border: 1px solid var(--color-login-border);
              border-radius: 4px;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: var(--color-login-text-secondary);
            "
          >
            {{ tag }}
          </span>
        </div>
      </div>

      <div
        style="
          font-size: 11px;
          color: var(--color-login-faint);
          font-family: 'JetBrains Mono', monospace;
        "
      >
        Bau-OS v1.0 · Self-hosted · Open Source
      </div>
    </div>

    <!-- Rechte Hälfte: Login-Form -->
    <div
      class="flex items-center justify-center"
      style="flex: 1; padding: 48px; background: var(--color-bg)"
    >
      <div style="width: 100%; max-width: 320px">
        <h2
          style="
            font-size: 20px;
            font-weight: 600;
            color: var(--color-text);
            margin: 0 0 4px 0;
          "
        >
          Anmelden
        </h2>
        <p
          style="
            font-size: 13px;
            color: var(--color-text-muted);
            margin: 0 0 28px 0;
          "
        >
          Willkommen zurück.
        </p>

        <form @submit.prevent="login" class="flex flex-col" style="gap: 16px">
          <div>
            <label class="eyebrow" style="display: block; margin-bottom: 6px">Benutzername</label>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              required
              class="login-input"
            />
          </div>
          <div>
            <label class="eyebrow" style="display: block; margin-bottom: 6px">Passwort</label>
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              class="login-input"
            />
          </div>

          <p
            v-if="error"
            style="
              font-size: 12px;
              color: var(--color-danger-text);
              background: var(--color-danger-bg);
              border: 1px solid var(--color-danger-border);
              padding: 8px 12px;
              border-radius: 6px;
              margin: 0;
            "
          >
            {{ error }}
          </p>

          <button
            type="submit"
            :disabled="loading"
            style="
              width: 100%;
              padding: 10px;
              font-size: 13px;
              font-weight: 500;
              color: var(--color-bg);
              background: var(--color-primary);
              border: none;
              border-radius: 6px;
              cursor: pointer;
              transition: opacity 180ms ease;
            "
            :style="{ opacity: loading ? 0.5 : 1 }"
          >
            {{ loading ? "…" : "Anmelden" }}
          </button>

          <a
            href="#"
            style="
              text-align: center;
              font-size: 12px;
              color: var(--color-text-muted);
              text-decoration: none;
              margin-top: 4px;
            "
            >Passwort vergessen?</a
          >
        </form>

        <div
          style="
            margin-top: 24px;
            padding: 10px 12px;
            border: 1px solid var(--color-border-subtle);
            border-radius: 6px;
            background: var(--color-bg-subtle);
            font-size: 11px;
            color: var(--color-text-muted);
            display: flex;
            align-items: center;
            gap: 8px;
          "
        >
          <span>🔒</span>
          <span>
            Verbindung verschlüsselt · TLS 1.3 · JWT · bcrypt ·
            <span class="font-mono" style="color: var(--color-text)">{{ hostname }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
  transition: border-color 180ms ease;
}
.login-input:focus {
  border-color: var(--color-text);
}
</style>
