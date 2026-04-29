<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api, setToken } from "../api";

const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

// 2FA-Step-Zustand
const twoFaTicket = ref<string | null>(null);
const twoFaUsername = ref<string | null>(null);
const totpToken = ref("");
const useBackup = ref(false);

// Hostname aus dem Browser uebernehmen — keine hardcoded Firma mehr.
const hostname = computed(() =>
  typeof window !== "undefined" ? window.location.host : "bau-os",
);

// Beim Mount: pruefen, ob noch gar kein Admin existiert. In dem Fall fuehrt
// /setup den User durchs Erstanlegen — die Login-Form macht ohne Admin-Konto
// keinen Sinn.
onMounted(async () => {
  try {
    const status = await api.get<{ needsSetup: boolean }>("/setup/status");
    if (status.needsSetup) router.replace("/setup");
  } catch {
    // Setup-Endpoint nicht da → Backend ist alt oder im FS-Mode. Kein
    // Wizard-Redirect, normaler Login wird einfach versucht.
  }
});

async function login() {
  error.value = "";
  loading.value = true;
  try {
    // Username trimmen — Browser-Autofill schmuggelt gern Leerzeichen rein.
    // Passwort bleibt unangetastet (Whitespace darf Teil sein).
    const res = await api.post<{
      token?: string;
      requires2fa?: boolean;
      ticket?: string;
      username?: string;
    }>("/auth/login", {
      username: username.value.trim(),
      password: password.value,
    });

    // 2FA-Pfad: Backend liefert ein kurzes Ticket statt JWT.
    if (res.requires2fa && res.ticket) {
      twoFaTicket.value = res.ticket;
      twoFaUsername.value = res.username ?? username.value.trim();
      totpToken.value = "";
      useBackup.value = false;
      // Passwort-Feld leeren — kein Grund es im DOM zu halten
      password.value = "";
      return;
    }

    if (res.token) {
      setToken(res.token);
      router.push("/");
    }
  } catch (e: any) {
    error.value = e.message || "Login fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}

async function submitTotp() {
  if (!twoFaTicket.value || !totpToken.value) return;
  error.value = "";
  loading.value = true;
  try {
    const cleanToken = totpToken.value.replace(/\s/g, "");
    const payload = useBackup.value
      ? { ticket: twoFaTicket.value, backupCode: cleanToken }
      : { ticket: twoFaTicket.value, token: cleanToken };
    const res = await api.post<{ token: string }>("/auth/login/2fa", payload);
    setToken(res.token);
    router.push("/");
  } catch (e: any) {
    error.value = e.message || "Code ungueltig";
  } finally {
    loading.value = false;
  }
}

function abortTwoFa() {
  twoFaTicket.value = null;
  twoFaUsername.value = null;
  totpToken.value = "";
  useBackup.value = false;
  error.value = "";
}
</script>

<template>
  <div class="login-container">
    <!-- Linke Hälfte: dunkel, Brand-Panel — auf Mobile (<768px) hidden -->
    <div
      class="login-hero flex flex-col"
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
          KI-Plattform für Architekturbüros und Büros in der Baubranche.
        </h1>
        <p
          style="
            font-size: 14px;
            color: var(--color-login-text-secondary);
            line-height: 1.6;
            margin: 0 0 24px 0;
          "
        >
          Büro-Werkzeug für Planung, Bauleitung und Projektsteuerung —
          nicht für die Baustelle. Self-hosted, DSGVO-konform, lokales LLM.
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

    <!-- Rechte Hälfte: Login-Form (auf Mobile: einzige sichtbare Sektion) -->
    <div
      class="login-form-wrap flex items-center justify-center"
      style="flex: 1; padding: 48px; background: var(--color-bg)"
    >
      <div style="width: 100%; max-width: 320px">
        <!-- 2FA-Step: nach erfolgreichem Passwort, Token-Eingabe -->
        <template v-if="twoFaTicket">
          <h2
            style="
              font-size: 20px;
              font-weight: 600;
              color: var(--color-text);
              margin: 0 0 4px 0;
            "
          >
            Zwei-Faktor-Code
          </h2>
          <p
            style="
              font-size: 13px;
              color: var(--color-text-muted);
              margin: 0 0 24px 0;
            "
          >
            <span v-if="!useBackup">
              Bitte den 6-stelligen Code aus der Authenticator-App eingeben.
            </span>
            <span v-else>
              Backup-Code eingeben (Format: <code class="font-mono">abcd-1234-5678</code>).
              Jeder Code ist genau einmal nutzbar.
            </span>
          </p>

          <form @submit.prevent="submitTotp" class="flex flex-col" style="gap: 16px">
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">
                {{ useBackup ? "Backup-Code" : "Code" }}
              </label>
              <input
                v-model="totpToken"
                type="text"
                :inputmode="useBackup ? 'text' : 'numeric'"
                :pattern="useBackup ? undefined : '[0-9]*'"
                :maxlength="useBackup ? 14 : 7"
                autocomplete="one-time-code"
                autofocus
                required
                class="login-input"
                style="font-family: 'JetBrains Mono', monospace; letter-spacing: 0.05em"
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
              :disabled="loading || !totpToken"
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
              :style="{ opacity: (loading || !totpToken) ? 0.5 : 1 }"
            >
              {{ loading ? "…" : "Bestätigen" }}
            </button>

            <div class="flex justify-between" style="margin-top: 4px">
              <button
                type="button"
                @click="useBackup = !useBackup; totpToken = ''; error = ''"
                style="
                  background: none;
                  border: none;
                  font-size: 12px;
                  color: var(--color-text-muted);
                  cursor: pointer;
                  padding: 0;
                "
              >
                {{ useBackup ? "Authenticator-Code verwenden" : "Backup-Code verwenden" }}
              </button>
              <button
                type="button"
                @click="abortTwoFa"
                style="
                  background: none;
                  border: none;
                  font-size: 12px;
                  color: var(--color-text-muted);
                  cursor: pointer;
                  padding: 0;
                "
              >
                Abbrechen
              </button>
            </div>
          </form>
        </template>

        <!-- Normaler Login-Step -->
        <template v-else>
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
        </template>

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
