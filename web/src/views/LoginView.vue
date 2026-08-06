<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api, setToken } from "../api";

const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

// Ein Schritt: Benutzername + Passwort. Bis zum Umbau auf den Firmenserver
// waren es sechs — Code aus der Email, Anmelde-Link, erzwungene
// Email-Einrichtung, Passwort-vergessen und Code-Eingabe. Alle fuenf hingen
// am Mailversand und liessen sich ohne Internet nicht durchlaufen.
//
// Passwort vergessen laeuft jetzt ueber den Admin (Benutzerverwaltung →
// Passwort setzen). Das ist im Buero der kuerzere Weg als eine Mail.

// Hostname aus dem Browser uebernehmen — keine hardcoded Firma mehr.
const hostname = computed(() => (typeof window !== "undefined" ? window.location.host : "patio"));

// Beim Mount: pruefen, ob noch gar kein Admin existiert. In dem Fall fuehrt
// /setup den User durchs Erstanlegen — die Login-Form macht ohne Admin-Konto
// keinen Sinn.
onMounted(async () => {
  try {
    const status = await api.get<{ needsSetup: boolean }>("/setup/status");
    if (status.needsSetup) {
      router.replace("/setup");
    }
  } catch {
    // Setup-Endpunkt nicht erreichbar → Backend antwortet nicht wie erwartet.
    // Kein Wizard-Redirect, der normale Login wird einfach versucht.
  }
});

async function login() {
  error.value = "";
  loading.value = true;
  try {
    const res = await api.post<{ token?: string; username?: string; role?: string }>("/auth/login", {
      username: username.value.trim(),
      password: password.value,
    });

    if (res.token) {
      setToken(res.token);
      router.push("/");
      return;
    }
    // Kein Token und kein Fehler vom Server — das darf nicht vorkommen. Lieber
    // eine ehrliche Meldung als ein Formular, das scheinbar nichts tut.
    error.value = "Unerwartete Antwort vom Server. Bitte den Administrator informieren.";
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Anmeldung fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-container">
    <!-- Linke Hälfte: dunkel, Brand-Panel — auf Mobile (<768px) hidden -->
    <div
      class="login-hero flex flex-col"
      style="flex: 1; background: var(--color-login-bg); color: #fff; padding: 48px; justify-content: space-between"
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
          <div style="font-size: 14px; font-weight: 600">PATIO</div>
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
        <h1 style="font-size: 36px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 16px 0">
          PATIO
        </h1>
        <p style="font-size: 14px; color: var(--color-login-text-secondary); line-height: 1.6; margin: 0 0 24px 0">
          Planung, Termine und Projektsteuerung fürs Büro.
        </p>
      </div>

      <div style="font-size: 11px; color: var(--color-login-faint); font-family: &quot;JetBrains Mono&quot;, monospace">
        PATIO
      </div>
    </div>

    <!-- Rechte Hälfte: Login-Form (auf Mobile: einzige sichtbare Sektion) -->
    <div
      class="login-form-wrap flex items-center justify-center"
      style="flex: 1; padding: 48px; background: var(--color-bg)"
    >
      <div style="width: 100%; max-width: 320px">
        <!-- Benutzername + Passwort — der einzige Anmeldeweg. -->
        <div>
          <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">Anmelden</h2>
          <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 28px 0">Willkommen zurück.</p>

          <form @submit.prevent="login" class="flex flex-col" style="gap: 16px">
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Benutzername</label>
              <input v-model="username" type="text" autocomplete="username" required class="login-input" />
            </div>
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Passwort</label>
              <input v-model="password" type="password" autocomplete="current-password" required class="login-input" />
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

            <p style="text-align: center; font-size: 12px; color: var(--color-text-muted); margin: 4px 0 0 0">
              Passwort vergessen? Bitte an die Administration wenden.
            </p>
          </form>
        </div>

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
          <span style="display: inline-flex; align-items: center">
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
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
.login-container {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
}

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

/* Mobile: Hero-Panel ausblenden, Form in voller Breite */
@media (max-width: 767.98px) {
  .login-hero {
    display: none !important;
  }
  .login-form-wrap {
    padding: 32px 20px !important;
    /* Form klebt nicht oben — auf Phones mit hoher Toolbar passt das besser */
  }
  .login-input {
    /* Etwas groesser auf Touch — sonst schwierig zu treffen */
    padding: 10px 12px;
    font-size: 14px;
  }
}
</style>
