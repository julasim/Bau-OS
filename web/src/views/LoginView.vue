<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api, setToken } from "../api";

const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

// Sechs moegliche Steps:
//   "login"        → Username + Passwort
//   "code"         → 6-stelliger Code aus der Email-2FA
//   "magic-link"   → Anmelde-Link wurde verschickt, User wartet auf Klick
//   "setup-email"  → User hat noch keine Email; muss sie hier setzen + verifizieren
//   "forgot"       → Passwort vergessen: Username eingeben, Code anfordern
//   "reset-code"   → Code + neues Passwort eingeben
type Step = "login" | "code" | "magic-link" | "setup-email" | "forgot" | "reset-code";
const step = ref<Step>("login");

// Step "code"
const ticket = ref<string | null>(null);
const otpCode = ref("");
const emailHint = ref<string | null>(null);
const magicLinkBusy = ref(false);
const magicLinkConsuming = ref(false);

// Step "setup-email" — sub-states: "enter-email" oder "verify-code"
type SetupSubStep = "enter-email" | "verify-code";
const setupSubStep = ref<SetupSubStep>("enter-email");
const setupTicket = ref<string | null>(null);
const setupEmail = ref("");
const setupCode = ref("");
const setupEmailHint = ref<string | null>(null);

// Step "forgot" / "reset-code"
const forgotUsername = ref("");
const resetToken = ref<string | null>(null);
const resetEmailHint = ref<string | null>(null);
const resetCode = ref("");
const resetNewPassword = ref("");
const resetNewPassword2 = ref("");
const resetPasswordMismatch = computed(
  () => resetNewPassword2.value.length > 0 && resetNewPassword.value !== resetNewPassword2.value,
);

// Hostname aus dem Browser uebernehmen — keine hardcoded Firma mehr.
const hostname = computed(() => (typeof window !== "undefined" ? window.location.host : "bau-os"));

const setupEmailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setupEmail.value.trim()));

// Beim Mount: pruefen, ob noch gar kein Admin existiert. In dem Fall fuehrt
// /setup den User durchs Erstanlegen — die Login-Form macht ohne Admin-Konto
// keinen Sinn.
//
// Zusaetzlich: ?magic=<token>-Param aus der URL pruefen — wenn vorhanden,
// versuchen wir direkt einzuloesen (Magic-Link-Klick aus Email).
onMounted(async () => {
  try {
    const status = await api.get<{ needsSetup: boolean }>("/setup/status");
    if (status.needsSetup) {
      router.replace("/setup");
      return;
    }
  } catch {
    // Setup-Endpoint nicht da → Backend ist alt oder im FS-Mode. Kein
    // Wizard-Redirect, normaler Login wird einfach versucht.
  }

  // Magic-Link aus URL einloesen
  const url = new URL(window.location.href);
  const magic = url.searchParams.get("magic");
  if (magic) {
    magicLinkConsuming.value = true;
    try {
      const res = await api.get<{ token: string }>(`/auth/login/magic-link/consume?token=${encodeURIComponent(magic)}`);
      // Magic-Param aus URL entfernen damit ein Reload nicht erneut versucht
      url.searchParams.delete("magic");
      window.history.replaceState({}, "", url.toString());
      setToken(res.token);
      router.push("/");
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Anmelde-Link ungueltig";
      // Param trotzdem entfernen damit der User retry kann
      url.searchParams.delete("magic");
      window.history.replaceState({}, "", url.toString());
    } finally {
      magicLinkConsuming.value = false;
    }
  }
});

async function login() {
  error.value = "";
  loading.value = true;
  try {
    const res = await api.post<{
      token?: string;
      requires2fa?: boolean;
      requiresEmailSetup?: boolean;
      ticket?: string;
      username?: string;
      emailHint?: string;
    }>("/auth/login", {
      username: username.value.trim(),
      password: password.value,
    });

    // Pfad A: 2FA-Code aus Email anfordern (User hat schon Email).
    if (res.requires2fa && res.ticket) {
      ticket.value = res.ticket;
      emailHint.value = res.emailHint ?? null;
      otpCode.value = "";
      step.value = "code";
      password.value = "";
      return;
    }

    // Pfad B: User hat noch keine Email → Setup-Flow erzwingen.
    if (res.requiresEmailSetup && res.ticket) {
      setupTicket.value = res.ticket;
      setupEmail.value = "";
      setupCode.value = "";
      setupEmailHint.value = null;
      setupSubStep.value = "enter-email";
      step.value = "setup-email";
      password.value = "";
      return;
    }

    // Pfad C: Legacy-JSON-User ohne 2FA — direkt JWT.
    if (res.token) {
      setToken(res.token);
      router.push("/");
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Login fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}

async function submitCode() {
  if (!ticket.value || !otpCode.value) return;
  error.value = "";
  loading.value = true;
  try {
    const cleanCode = otpCode.value.replace(/\s/g, "");
    const res = await api.post<{ token: string }>("/auth/login/2fa", {
      ticket: ticket.value,
      code: cleanCode,
    });
    setToken(res.token);
    router.push("/");
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Code ungueltig";
  } finally {
    loading.value = false;
  }
}

async function requestMagicLink() {
  if (!ticket.value || magicLinkBusy.value) return;
  error.value = "";
  magicLinkBusy.value = true;
  try {
    await api.post("/auth/login/magic-link/start", { ticket: ticket.value });
    step.value = "magic-link";
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Anmelde-Link konnte nicht gesendet werden";
  } finally {
    magicLinkBusy.value = false;
  }
}

async function startEmailSetup() {
  if (!setupTicket.value || !setupEmailValid.value) return;
  error.value = "";
  loading.value = true;
  try {
    const res = await api.post<{ ok: boolean; emailHint?: string }>("/auth/setup-email/start", {
      ticket: setupTicket.value,
      email: setupEmail.value.trim().toLowerCase(),
    });
    if (res.ok) {
      setupEmailHint.value = res.emailHint ?? setupEmail.value.trim().toLowerCase();
      setupSubStep.value = "verify-code";
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Code konnte nicht gesendet werden";
  } finally {
    loading.value = false;
  }
}

async function verifyEmailSetup() {
  if (!setupTicket.value || !setupCode.value) return;
  error.value = "";
  loading.value = true;
  try {
    const cleanCode = setupCode.value.replace(/\s/g, "");
    const res = await api.post<{ token: string }>("/auth/setup-email/verify", {
      ticket: setupTicket.value,
      code: cleanCode,
    });
    setToken(res.token);
    router.push("/");
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Code ungueltig";
  } finally {
    loading.value = false;
  }
}

async function requestPasswordReset() {
  if (!forgotUsername.value.trim()) return;
  error.value = "";
  loading.value = true;
  try {
    const res = await api.post<{ ok: boolean; resetToken?: string; emailHint?: string }>("/auth/forgot-password", {
      username: forgotUsername.value.trim(),
    });
    if (res.resetToken) {
      resetToken.value = res.resetToken;
      resetEmailHint.value = res.emailHint ?? null;
      resetCode.value = "";
      resetNewPassword.value = "";
      resetNewPassword2.value = "";
      step.value = "reset-code";
    } else {
      // Kein Token → kein passendes Konto mit Email. Trotzdem eine
      // neutrale Meldung — kein Enumeration-Leak.
      error.value = "Falls ein Konto mit dieser E-Mail existiert, wurde ein Code gesendet.";
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Anfrage fehlgeschlagen";
  } finally {
    loading.value = false;
  }
}

async function submitPasswordReset() {
  if (!resetToken.value || !resetCode.value || !resetNewPassword.value) return;
  if (resetPasswordMismatch.value) return;
  error.value = "";
  loading.value = true;
  try {
    await api.post("/auth/reset-password", {
      resetToken: resetToken.value,
      code: resetCode.value.replace(/\s/g, ""),
      newPassword: resetNewPassword.value,
    });
    // Erfolg → zurueck zum Login mit Erfolgsmeldung.
    abortFlow();
    error.value = "";
    // Kurze positive Bestaetigung im Login-Step.
    username.value = forgotUsername.value;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : "Fehler beim Setzen des Passworts";
  } finally {
    loading.value = false;
  }
}

function abortFlow() {
  step.value = "login";
  ticket.value = null;
  otpCode.value = "";
  emailHint.value = null;
  setupTicket.value = null;
  setupEmail.value = "";
  setupCode.value = "";
  setupSubStep.value = "enter-email";
  resetToken.value = null;
  resetEmailHint.value = null;
  resetCode.value = "";
  resetNewPassword.value = "";
  resetNewPassword2.value = "";
  error.value = "";
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
        <h1 style="font-size: 36px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 16px 0">
          KI-Plattform für Architekturbüros und Büros in der Baubranche.
        </h1>
        <p style="font-size: 14px; color: var(--color-login-text-secondary); line-height: 1.6; margin: 0 0 24px 0">
          Büro-Werkzeug für Planung, Bauleitung und Projektsteuerung — nicht für die Baustelle. Self-hosted,
          DSGVO-konform, lokales LLM.
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

      <div style="font-size: 11px; color: var(--color-login-faint); font-family: &quot;JetBrains Mono&quot;, monospace">
        Bau-OS v1.0 · Self-hosted · Open Source
      </div>
    </div>

    <!-- Rechte Hälfte: Login-Form (auf Mobile: einzige sichtbare Sektion) -->
    <div
      class="login-form-wrap flex items-center justify-center"
      style="flex: 1; padding: 48px; background: var(--color-bg)"
    >
      <div style="width: 100%; max-width: 320px">
        <!-- Auto-Consume Magic-Link: Spinner anzeigen -->
        <template v-if="magicLinkConsuming">
          <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">
            Anmelde-Link wird geprüft…
          </h2>
          <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
            Einen Moment, du wirst gleich angemeldet.
          </p>
        </template>

        <!-- Step "code": 6-stelliger Email-Code -->
        <template v-else-if="step === 'code'">
          <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">Code aus Email</h2>
          <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
            Wir haben dir einen 6-stelligen Code an
            <strong v-if="emailHint" class="font-mono">{{ emailHint }}</strong>
            <span v-else>deine Email-Adresse</span>
            geschickt. Der Code ist 10 Minuten gültig.
          </p>

          <form @submit.prevent="submitCode" class="flex flex-col" style="gap: 16px">
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Code</label>
              <input
                v-model="otpCode"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="7"
                autocomplete="one-time-code"
                autofocus
                required
                class="login-input"
                style="
                  font-family: &quot;JetBrains Mono&quot;, monospace;
                  letter-spacing: 0.15em;
                  text-align: center;
                  font-size: 18px;
                "
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
              :disabled="loading || !otpCode"
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
              :style="{ opacity: loading || !otpCode ? 0.5 : 1 }"
            >
              {{ loading ? "…" : "Bestätigen" }}
            </button>

            <div class="flex justify-between" style="margin-top: 4px">
              <span style="font-size: 12px; color: var(--color-text-muted)">
                Keine Mail bekommen? Spam-Ordner prüfen.
              </span>
              <button
                type="button"
                @click="abortFlow"
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

            <button
              type="button"
              @click="requestMagicLink"
              :disabled="magicLinkBusy"
              style="
                width: 100%;
                margin-top: 12px;
                padding: 9px;
                font-size: 12px;
                font-weight: 500;
                color: var(--color-text);
                background: transparent;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                cursor: pointer;
              "
              :style="{ opacity: magicLinkBusy ? 0.5 : 1 }"
            >
              {{ magicLinkBusy ? "Wird gesendet…" : "Lieber Anmelde-Link statt Code" }}
            </button>
          </form>
        </template>

        <!-- Step "magic-link": Mail wurde verschickt, User wartet auf Klick -->
        <template v-else-if="step === 'magic-link'">
          <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">
            Anmelde-Link verschickt
          </h2>
          <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
            Wir haben dir einen Anmelde-Link an
            <strong v-if="emailHint" class="font-mono">{{ emailHint }}</strong>
            <span v-else>deine Email-Adresse</span>
            geschickt. Öffne die Mail und klicke den Link — dann bist du angemeldet. Der Link ist 15 Minuten gültig.
          </p>
          <div
            style="
              padding: 12px 14px;
              background: var(--color-bg-subtle);
              border: 1px solid var(--color-border-subtle);
              border-radius: 6px;
              font-size: 12px;
              color: var(--color-text-muted);
              line-height: 1.5;
            "
          >
            Tipp: der Klick öffnet diese Seite automatisch in einem neuen Tab. Lass dieses Fenster offen — falls's hier
            nicht von alleine weiterspringt, kommt der Login einfach im neuen Tab.
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
              margin: 12px 0 0 0;
            "
          >
            {{ error }}
          </p>

          <div class="flex justify-between" style="margin-top: 16px">
            <button
              type="button"
              @click="
                step = 'code';
                error = '';
              "
              style="
                background: none;
                border: none;
                font-size: 12px;
                color: var(--color-text-muted);
                cursor: pointer;
                padding: 0;
              "
            >
              Doch lieber Code eingeben
            </button>
            <button
              type="button"
              @click="abortFlow"
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
        </template>

        <!-- Step "setup-email": Email-Adresse setzen + verifizieren -->
        <template v-else-if="step === 'setup-email'">
          <div
            style="
              padding: 10px 12px;
              border: 1px solid #f59e0b;
              background: #fffbeb;
              color: #92400e;
              border-radius: 6px;
              font-size: 12px;
              margin-bottom: 20px;
            "
          >
            Aus Sicherheitsgründen ist die Email-Verifikation jetzt Pflicht. Bitte hinterlege deine Email-Adresse — wir
            bestätigen sie sofort mit einem Code.
          </div>

          <!-- Sub-Step 1: Email eingeben -->
          <template v-if="setupSubStep === 'enter-email'">
            <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">
              Email-Adresse hinterlegen
            </h2>
            <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
              Diese Adresse wird ab jetzt für jeden Login per Code verwendet.
            </p>
            <form @submit.prevent="startEmailSetup" class="flex flex-col" style="gap: 16px">
              <div>
                <label class="eyebrow" style="display: block; margin-bottom: 6px">Email</label>
                <input
                  v-model="setupEmail"
                  type="email"
                  autocomplete="email"
                  autofocus
                  required
                  placeholder="name@firma.at"
                  class="login-input"
                />
                <div
                  v-if="setupEmail.length > 0 && !setupEmailValid"
                  style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px"
                >
                  Bitte eine gültige Email-Adresse.
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
                :disabled="loading || !setupEmailValid"
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
                "
                :style="{ opacity: loading || !setupEmailValid ? 0.5 : 1 }"
              >
                {{ loading ? "…" : "Code senden" }}
              </button>
              <button
                type="button"
                @click="abortFlow"
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
            </form>
          </template>

          <!-- Sub-Step 2: Code aus Email verifizieren -->
          <template v-else>
            <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">
              Code bestätigen
            </h2>
            <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
              Wir haben einen 6-stelligen Code an
              <strong v-if="setupEmailHint" class="font-mono">{{ setupEmailHint }}</strong>
              geschickt. 10 Minuten gültig.
            </p>
            <form @submit.prevent="verifyEmailSetup" class="flex flex-col" style="gap: 16px">
              <div>
                <label class="eyebrow" style="display: block; margin-bottom: 6px">Code</label>
                <input
                  v-model="setupCode"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="7"
                  autocomplete="one-time-code"
                  autofocus
                  required
                  class="login-input"
                  style="
                    font-family: &quot;JetBrains Mono&quot;, monospace;
                    letter-spacing: 0.15em;
                    text-align: center;
                    font-size: 18px;
                  "
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
                :disabled="loading || !setupCode"
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
                "
                :style="{ opacity: loading || !setupCode ? 0.5 : 1 }"
              >
                {{ loading ? "…" : "Email bestätigen" }}
              </button>
              <div class="flex justify-between" style="margin-top: 4px">
                <button
                  type="button"
                  @click="
                    setupSubStep = 'enter-email';
                    setupCode = '';
                    error = '';
                  "
                  style="
                    background: none;
                    border: none;
                    font-size: 12px;
                    color: var(--color-text-muted);
                    cursor: pointer;
                    padding: 0;
                  "
                >
                  Andere Adresse
                </button>
                <button
                  type="button"
                  @click="abortFlow"
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
        </template>

        <!-- Step "forgot": Passwort vergessen — Username eingeben -->
        <template v-else-if="step === 'forgot'">
          <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">
            Passwort zurücksetzen
          </h2>
          <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
            Gib deinen Benutzernamen ein. Falls ein Konto mit einer hinterlegten E-Mail-Adresse existiert, senden wir
            dir einen 6-stelligen Code.
          </p>

          <form @submit.prevent="requestPasswordReset" class="flex flex-col" style="gap: 16px">
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Benutzername</label>
              <input
                v-model="forgotUsername"
                type="text"
                autocomplete="username"
                autofocus
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
              :disabled="loading || !forgotUsername.trim()"
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
              :style="{ opacity: loading || !forgotUsername.trim() ? 0.5 : 1 }"
            >
              {{ loading ? "…" : "Code senden" }}
            </button>

            <button
              type="button"
              @click="abortFlow"
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
          </form>
        </template>

        <!-- Step "reset-code": Code + neues Passwort eingeben -->
        <template v-else-if="step === 'reset-code'">
          <h2 style="font-size: 20px; font-weight: 600; color: var(--color-text); margin: 0 0 4px 0">
            Neues Passwort setzen
          </h2>
          <p style="font-size: 13px; color: var(--color-text-muted); margin: 0 0 24px 0">
            Wir haben einen 6-stelligen Code an
            <strong v-if="resetEmailHint" class="font-mono">{{ resetEmailHint }}</strong>
            <span v-else>deine E-Mail-Adresse</span>
            geschickt. Gib den Code und dein neues Passwort ein. Der Code ist 10 Minuten gültig.
          </p>

          <form @submit.prevent="submitPasswordReset" class="flex flex-col" style="gap: 16px">
            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Code</label>
              <input
                v-model="resetCode"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="7"
                autocomplete="one-time-code"
                autofocus
                required
                class="login-input"
                style="
                  font-family: &quot;JetBrains Mono&quot;, monospace;
                  letter-spacing: 0.15em;
                  text-align: center;
                  font-size: 18px;
                "
              />
            </div>

            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Neues Passwort</label>
              <input
                v-model="resetNewPassword"
                type="password"
                autocomplete="new-password"
                minlength="8"
                required
                class="login-input"
              />
            </div>

            <div>
              <label class="eyebrow" style="display: block; margin-bottom: 6px">Passwort wiederholen</label>
              <input
                v-model="resetNewPassword2"
                type="password"
                autocomplete="new-password"
                minlength="8"
                required
                class="login-input"
              />
              <div
                v-if="resetPasswordMismatch"
                style="font-size: 11px; color: var(--color-danger-text); margin-top: 4px"
              >
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
              :disabled="loading || !resetCode || !resetNewPassword || resetPasswordMismatch"
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
              :style="{ opacity: loading || !resetCode || !resetNewPassword || resetPasswordMismatch ? 0.5 : 1 }"
            >
              {{ loading ? "…" : "Passwort setzen" }}
            </button>

            <div class="flex justify-between" style="margin-top: 4px">
              <button
                type="button"
                @click="
                  step = 'forgot';
                  error = '';
                "
                style="
                  background: none;
                  border: none;
                  font-size: 12px;
                  color: var(--color-text-muted);
                  cursor: pointer;
                  padding: 0;
                "
              >
                Neuer Code
              </button>
              <button
                type="button"
                @click="abortFlow"
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

        <!-- Step "login": Username + Passwort -->
        <template v-else>
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

            <button
              type="button"
              @click="
                step = 'forgot';
                error = '';
                forgotUsername = username;
              "
              style="
                background: none;
                border: none;
                text-align: center;
                font-size: 12px;
                color: var(--color-text-muted);
                cursor: pointer;
                padding: 0;
                margin-top: 4px;
              "
            >
              Passwort vergessen?
            </button>
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
