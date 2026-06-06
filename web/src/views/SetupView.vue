<script setup lang="ts">
// Erstanlage des Admin-Kontos. Ist nur erreichbar, solange kein User in der
// DB existiert — Server gibt sonst 410 zurueck.
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api, setToken } from "../api";

const router = useRouter();
const username = ref("");
const email = ref("");
const password = ref("");
const passwordConfirm = ref("");
const error = ref("");
const loading = ref(false);
const checkingStatus = ref(true);

const hostname = computed(() => (typeof window !== "undefined" ? window.location.host : "bau-os"));

const passwordTooShort = computed(() => password.value.length > 0 && password.value.length < 8);
const passwordsMismatch = computed(() => passwordConfirm.value.length > 0 && password.value !== passwordConfirm.value);
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()));
const canSubmit = computed(
  () =>
    !loading.value &&
    username.value.trim().length >= 3 &&
    emailValid.value &&
    password.value.length >= 8 &&
    password.value === passwordConfirm.value,
);

onMounted(async () => {
  try {
    const status = await api.get<{ needsSetup: boolean }>("/setup/status");
    if (!status.needsSetup) {
      // Setup ist bereits gelaufen → kein Wizard noetig, ab zum Login.
      router.replace("/login");
      return;
    }
  } catch {
    // Falls Backend nicht antwortet, lassen wir den Wizard sichtbar — der
    // POST faengt 410 sauber ab.
  } finally {
    checkingStatus.value = false;
  }
});

async function submit() {
  if (!canSubmit.value) return;
  error.value = "";
  loading.value = true;
  try {
    const res = await api.post<{ token: string }>("/setup/admin", {
      username: username.value.trim(),
      email: email.value.trim().toLowerCase(),
      password: password.value,
    });
    setToken(res.token);
    router.replace("/");
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Setup fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex" style="min-height: 100vh; background: var(--color-bg)">
    <!-- Linke Brand-Panel — wie LoginView -->
    <div
      class="flex flex-col"
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
            Erste Einrichtung
          </div>
        </div>
      </div>

      <div style="max-width: 480px">
        <h1 style="font-size: 36px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 16px 0">
          Willkommen — leg dein Admin-Konto an.
        </h1>
        <p style="font-size: 14px; color: var(--color-login-text-secondary); line-height: 1.6; margin: 0 0 24px 0">
          Dieses Konto ist <strong>permanent geschützt</strong> — niemand kann es herabstufen oder löschen. Es bleibt
          deine Rückversicherung, falls später ein anderer Admin etwas Falsches macht.
        </p>
        <ul
          style="
            list-style: none;
            padding: 0;
            margin: 0;
            font-size: 12px;
            color: var(--color-login-text-secondary);
            line-height: 1.8;
          "
        >
          <li>· Verwalte alle weiteren Nutzer und Projektzugriffe</li>
          <li>· Sieh sämtliche Projekte, Aufgaben und Dateien</li>
          <li>· Bestimme, wer welchem Projekt zugewiesen wird</li>
        </ul>
      </div>

      <div style="font-size: 11px; color: var(--color-login-faint); font-family: &quot;JetBrains Mono&quot;, monospace">
        PATIO
      </div>
    </div>

    <!-- Rechte Setup-Form -->
    <div class="flex items-center justify-center" style="flex: 1; padding: 48px; background: var(--color-bg)">
      <div style="width: 100%; max-width: 360px">
        <div v-if="checkingStatus" style="font-size: 13px; color: var(--color-text-muted)">Lade…</div>
        <template v-else>
          <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">
            Admin-Konto anlegen
          </h2>
          <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
            Du legst gerade den ersten Nutzer dieser PATIO-Installation an.
          </p>

          <form @submit.prevent="submit" class="flex flex-col" style="gap: 16px">
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Benutzername</label>
              <input
                v-model="username"
                type="text"
                autocomplete="username"
                required
                minlength="3"
                placeholder="z.B. admin oder ihr.name"
                class="login-input"
              />
              <div
                v-if="username.length > 0 && username.trim().length < 3"
                style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px"
              >
                Mindestens 3 Zeichen.
              </div>
            </div>
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Email-Adresse</label>
              <input
                v-model="email"
                type="email"
                autocomplete="email"
                required
                placeholder="name@firma.at"
                class="login-input"
              />
              <div
                v-if="email.length > 0 && !emailValid"
                style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px"
              >
                Bitte gültige Email-Adresse — wird für 2FA-Login per Code verwendet.
              </div>
            </div>
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Passwort</label>
              <input
                v-model="password"
                type="password"
                autocomplete="new-password"
                required
                minlength="8"
                class="login-input"
              />
              <div v-if="passwordTooShort" style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px">
                Mindestens 8 Zeichen.
              </div>
            </div>
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Passwort bestätigen</label>
              <input
                v-model="passwordConfirm"
                type="password"
                autocomplete="new-password"
                required
                class="login-input"
              />
              <div v-if="passwordsMismatch" style="font-size: 11px; color: var(--color-danger-text); margin-top: 4px">
                Passwörter stimmen nicht überein.
              </div>
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
              :disabled="!canSubmit"
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
              :style="{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }"
            >
              {{ loading ? "Lege an…" : "Admin-Konto erstellen" }}
            </button>
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
              Direkter Setup-Modus — nur erreichbar, solange kein Konto existiert.
              <span class="font-mono" style="color: var(--color-text)">{{ hostname }}</span>
            </span>
          </div>
        </template>
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
