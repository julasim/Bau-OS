<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { api } from "../api";

interface SettingsState {
  displayName?: string;
  notificationsEnabled?: boolean;
  defaultProject?: string | null;
  chatSearchMode?: boolean;
}

interface SettingsResponse {
  profile: { username: string; role: string; createdAt: string; email?: string | null };
  settings: SettingsState;
  runtime: { currentModel: string; fastMode: boolean; dbEnabled: boolean };
  system: {
    defaultModel: string;
    fastModel: string;
    subagentModel: string;
    ollamaBaseUrl: string;
    language: string;
    locale: string;
    timezone: string;
    compactThreshold: number;
  };
}

const data = ref<SettingsResponse | null>(null);
const loading = ref(true);
const savingSettings = ref(false);
const savingPassword = ref(false);
const savingModel = ref(false);
const message = ref<{ type: "success" | "error"; text: string } | null>(null);

const projects = ref<{ name: string }[]>([]);

// Formular-State
const displayName = ref("");
const notificationsEnabled = ref(true);
const defaultProject = ref<string | null>(null);
const chatSearchMode = ref(false);

const oldPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");

const modelInput = ref("");

// ── Email ───────────────────────────────────────────────────────────────────
// Pflicht-Feld fuer 2FA-Login (Migration 020). Anzeige im Profil + "Aendern"-
// Modus mit Code-Verifikation. Aequivalent zum Setup-Flow am Login: User
// gibt neue Email ein → Code wird gesendet → User bestaetigt → users.email
// wird ueberschrieben.
const emailEditing = ref(false);
const emailNew = ref("");
const emailVerifyTicket = ref<string | null>(null);
const emailVerifyCode = ref("");
const emailHint = ref<string | null>(null);
const emailBusy = ref(false);

const emailNewValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNew.value.trim()));

async function startEmailChange() {
  if (!emailNewValid.value) return;
  emailBusy.value = true;
  try {
    const res = await api.post<{ ticket: string; emailHint?: string }>(
      "/settings/email/change/start",
      { email: emailNew.value.trim().toLowerCase() },
    );
    emailVerifyTicket.value = res.ticket;
    emailHint.value = res.emailHint ?? emailNew.value.trim().toLowerCase();
    emailVerifyCode.value = "";
    flash("success", "Code wurde an die neue Adresse gesendet");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Code konnte nicht gesendet werden");
  } finally {
    emailBusy.value = false;
  }
}

async function verifyEmailChange() {
  if (!emailVerifyTicket.value || !emailVerifyCode.value) return;
  emailBusy.value = true;
  try {
    const res = await api.post<{ email: string }>("/settings/email/change/verify", {
      ticket: emailVerifyTicket.value,
      code: emailVerifyCode.value.replace(/\s/g, ""),
    });
    if (data.value?.profile) data.value.profile.email = res.email;
    cancelEmailChange();
    flash("success", "Email-Adresse aktualisiert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Code ungueltig");
  } finally {
    emailBusy.value = false;
  }
}

function cancelEmailChange() {
  emailEditing.value = false;
  emailNew.value = "";
  emailVerifyTicket.value = null;
  emailVerifyCode.value = "";
  emailHint.value = null;
}

// ── Microsoft-Konto (Phase 1: OAuth-Verbindung) ─────────────────────────────
// Status-Polling beim Mount + nach jeder Verbinden/Trennen-Aktion.
// Connect-Button oeffnet die MS-Authorize-URL als Popup —
// Backend-Callback macht Token-Storage, postMessage zurueck an opener,
// dieser triggert ein Status-Reload.
interface MsAccount {
  msEmail: string;
  msDisplayName: string | null;
  calendarMode: "default" | "bau-os";
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  accessTokenValid: boolean;
}
interface MsStatus {
  connected: boolean;
  available: boolean;
  reason?: string;
  account?: MsAccount;
}

const msStatus = ref<MsStatus>({ connected: false, available: false });
const msBusy = ref(false);
const msMessage = ref<{ type: "ok" | "err"; text: string } | null>(null);

async function loadMsStatus() {
  try {
    msStatus.value = await api.get<MsStatus>("/auth/microsoft/status");
  } catch {
    msStatus.value = { connected: false, available: false };
  }
}

async function connectMicrosoft() {
  msBusy.value = true;
  msMessage.value = null;
  try {
    const res = await api.post<{ url: string }>("/auth/microsoft/connect", {
      returnTo: "/settings",
    });
    const popup = window.open(res.url, "ms-oauth", "width=520,height=720");
    if (!popup) {
      msMessage.value = {
        type: "err",
        text: "Popup wurde blockiert. Bitte Popup-Blocker für diese Seite deaktivieren.",
      };
      return;
    }
    // Auf postMessage vom Callback-Tab warten.
    const onMsg = async (ev: MessageEvent) => {
      if (!ev.data || ev.data.type !== "bauos:ms-oauth") return;
      window.removeEventListener("message", onMsg);
      if (ev.data.kind === "success") {
        msMessage.value = { type: "ok", text: ev.data.message ?? "Microsoft-Konto verbunden." };
        await loadMsStatus();
      } else {
        msMessage.value = { type: "err", text: ev.data.message ?? "Verbindung fehlgeschlagen." };
      }
    };
    window.addEventListener("message", onMsg);
    // Failsafe: Popup geschlossen ohne Anmeldung → nach 1.5s Status pollen.
    const poll = setInterval(async () => {
      if (popup.closed) {
        clearInterval(poll);
        window.removeEventListener("message", onMsg);
        await loadMsStatus();
      }
    }, 1500);
  } catch (e) {
    msMessage.value = { type: "err", text: e instanceof Error ? e.message : "Verbinden fehlgeschlagen" };
  } finally {
    msBusy.value = false;
  }
}

async function disconnectMicrosoft() {
  if (!confirm("Microsoft-Verbindung wirklich trennen? Synchronisierte Termine bleiben in Bau-OS erhalten.")) return;
  msBusy.value = true;
  msMessage.value = null;
  try {
    await api.delete("/auth/microsoft/disconnect");
    msMessage.value = { type: "ok", text: "Verbindung getrennt." };
    await loadMsStatus();
  } catch (e) {
    msMessage.value = { type: "err", text: e instanceof Error ? e.message : "Trennen fehlgeschlagen" };
  } finally {
    msBusy.value = false;
  }
}

async function updateMsSettings(patch: { calendarMode?: "default" | "bau-os"; syncEnabled?: boolean }) {
  msBusy.value = true;
  try {
    await api.patch("/auth/microsoft/settings", patch);
    await loadMsStatus();
  } catch (e) {
    msMessage.value = { type: "err", text: e instanceof Error ? e.message : "Update fehlgeschlagen" };
  } finally {
    msBusy.value = false;
  }
}

// Hinweis: Die Telegram-Bot-Verwaltung wurde aus den User-Settings
// entfernt — Admin verwaltet Bot-Token und Pairing zentral via
// /admin/users (Bot-Token-Dialog + Pair-Dialog). Self-Service-Endpoint
// /me/telegram-bot bleibt im Backend erhalten als Recovery-Pfad, wird
// aber im UI nicht mehr exponiert.

// ── Cloud-Modelle (Ollama Cloud / Turbo) ─────────────────────────────────────
// Schnellauswahl fuer Ollama-gehostete Cloud-Modelle. Klick setzt den Input
// und laesst den User mit "Setzen" bestaetigen.
const CLOUD_MODELS: { id: string; label: string; desc: string }[] = [
  { id: "gpt-oss:20b-cloud", label: "gpt-oss 20B", desc: "OpenAI Open-Weight, schnell & guenstig" },
  { id: "gpt-oss:120b-cloud", label: "gpt-oss 120B", desc: "OpenAI Open-Weight, starkes Reasoning" },
  { id: "qwen3-coder:480b-cloud", label: "qwen3-coder 480B", desc: "Coder-Spezialist, Top bei Tools" },
  { id: "deepseek-v3.1:671b-cloud", label: "deepseek-v3.1 671B", desc: "Top Allrounder, sehr stark bei Reasoning" },
  { id: "kimi-k2:1t-cloud", label: "kimi-k2 1T", desc: "Agentic, lange Kontexte, 1 Billion Params" },
];

function pickModel(id: string) {
  modelInput.value = id;
}

const dirty = computed(() => {
  if (!data.value) return false;
  const s = data.value.settings;
  return (
    (s.displayName ?? "") !== displayName.value ||
    (s.notificationsEnabled ?? true) !== notificationsEnabled.value ||
    (s.defaultProject ?? null) !== defaultProject.value ||
    (s.chatSearchMode ?? false) !== chatSearchMode.value
  );
});

function flash(type: "success" | "error", text: string) {
  message.value = { type, text };
  setTimeout(() => {
    if (message.value?.text === text) message.value = null;
  }, 4000);
}

async function loadAll() {
  loading.value = true;
  try {
    const [res, proj] = await Promise.all([
      api.get<SettingsResponse>("/settings"),
      api.get<{ name: string }[]>("/projects").catch(() => []),
    ]);
    data.value = res;
    projects.value = proj;
    displayName.value = res.settings.displayName ?? "";
    notificationsEnabled.value = res.settings.notificationsEnabled ?? true;
    defaultProject.value = res.settings.defaultProject ?? null;
    chatSearchMode.value = res.settings.chatSearchMode ?? false;
    modelInput.value = res.runtime.currentModel;
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Laden fehlgeschlagen");
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  savingSettings.value = true;
  try {
    const res = await api.patch<{ ok: boolean; settings: SettingsState }>("/settings", {
      settings: {
        displayName: displayName.value || undefined,
        notificationsEnabled: notificationsEnabled.value,
        defaultProject: defaultProject.value,
        chatSearchMode: chatSearchMode.value,
      },
    });
    if (data.value) data.value.settings = res.settings;
    flash("success", "Einstellungen gespeichert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    savingSettings.value = false;
  }
}

async function changePassword() {
  if (!oldPassword.value || !newPassword.value) {
    flash("error", "Bitte altes und neues Passwort eingeben");
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    flash("error", "Neue Passwoerter stimmen nicht ueberein");
    return;
  }
  if (newPassword.value.length < 8) {
    flash("error", "Neues Passwort muss mindestens 8 Zeichen haben");
    return;
  }

  savingPassword.value = true;
  try {
    await api.post("/auth/password", {
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    });
    oldPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    flash("success", "Passwort geaendert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Passwort-Aenderung fehlgeschlagen");
  } finally {
    savingPassword.value = false;
  }
}

async function applyModel() {
  if (!modelInput.value.trim()) return;
  savingModel.value = true;
  try {
    const res = await api.post<{ ok: boolean; currentModel: string }>("/settings/model", {
      model: modelInput.value.trim(),
    });
    if (data.value) data.value.runtime.currentModel = res.currentModel;
    flash("success", `Modell gesetzt: ${res.currentModel}`);
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Modell konnte nicht gesetzt werden");
  } finally {
    savingModel.value = false;
  }
}

async function toggleFast() {
  try {
    const res = await api.post<{ ok: boolean; fastMode: boolean; currentModel: string }>("/settings/fast", {});
    if (data.value) {
      data.value.runtime.fastMode = res.fastMode;
      data.value.runtime.currentModel = res.currentModel;
    }
    modelInput.value = res.currentModel;
    flash("success", `Fast-Mode ${res.fastMode ? "aktiviert" : "deaktiviert"}`);
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Fast-Mode konnte nicht umgeschaltet werden");
  }
}

onMounted(() => {
  void loadAll();
  void loadMsStatus();
});
</script>

<template>
  <div
    style="
      max-width: 780px;
      margin: 0 auto;
      padding: 28px 32px 48px;
      color: var(--color-text);
    "
  >
    <div style="margin-bottom: 20px">
      <div class="eyebrow" style="margin-bottom: 6px">System</div>
      <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">
        Einstellungen
      </h1>
      <p style="font-size: 13px; color: var(--color-text-muted); margin-top: 4px">
        Persönliche Präferenzen, Profil und Laufzeit-Optionen. System-Variablen (DATABASE_URL,
        BOT_TOKEN etc.) werden in der <code class="font-mono">.env</code>-Datei verwaltet.
      </p>
    </div>

    <!-- Flash-Meldung -->
    <div
      v-if="message"
      :class="[
        'settings-flash mb-4 px-3 py-2 text-sm rounded',
        message.type === 'success' ? 'settings-flash-ok' : 'settings-flash-err',
      ]"
    >
      {{ message.text }}
    </div>

    <div
      v-if="loading"
      class="text-sm py-8"
      style="color: var(--color-text-tertiary)"
    >
      Laedt...
    </div>

    <div v-else-if="data" class="space-y-8">
      <!-- ── Profil ─────────────────────────────────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">Profil</h3>
        <div class="settings-card settings-divide">
          <div class="settings-row flex items-center justify-between px-4 py-3">
            <span class="text-sm settings-label">Benutzername</span>
            <span class="text-sm font-mono settings-value">{{ data.profile.username }}</span>
          </div>
          <div class="settings-row flex items-center justify-between px-4 py-3">
            <span class="text-sm settings-label">Rolle</span>
            <span class="text-sm settings-value">{{ data.profile.role }}</span>
          </div>
          <div class="settings-row flex items-center justify-between px-4 py-3">
            <span class="text-sm settings-label">Registriert</span>
            <span class="text-sm settings-value">{{ data.profile.createdAt }}</span>
          </div>
          <div class="settings-row flex items-center gap-3 px-4 py-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Anzeige-Name</label>
            <input
              v-model="displayName"
              type="text"
              placeholder="z.B. Julius"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            />
          </div>
        </div>
      </section>

      <!-- ── Passwort ───────────────────────────────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">Passwort aendern</h3>
        <div class="settings-card p-4 space-y-3">
          <div class="flex items-center gap-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Altes Passwort</label>
            <input
              v-model="oldPassword"
              type="password"
              autocomplete="current-password"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            />
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Neues Passwort</label>
            <input
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            />
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Bestaetigen</label>
            <input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            />
          </div>
          <div class="flex justify-end pt-1">
            <button
              @click="changePassword"
              :disabled="savingPassword || !oldPassword || !newPassword"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
              :style="{ opacity: (savingPassword || !oldPassword || !newPassword) ? 0.5 : 1 }"
            >
              {{ savingPassword ? "..." : "Passwort aendern" }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── Email (2FA via Email-OTP) ────────────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">
          Email (Zwei-Faktor-Login)
          <span
            class="ml-2 text-xs px-2 py-0.5 rounded-full"
            :style="data.profile.email
              ? 'background:#dcfce7; color:#166534'
              : 'background:#fef3c7; color:#92400e'"
          >{{ data.profile.email ? "Aktiv" : "Nicht gesetzt" }}</span>
        </h3>

        <div v-if="!emailEditing" class="settings-card p-4">
          <p class="text-sm" style="color: var(--color-text-muted); margin-bottom: 12px">
            Bei jedem Login wird nach dem Passwort ein 6-stelliger Code an deine
            Email-Adresse gesendet. Pflicht-Feld — ohne Email ist kein Login möglich.
          </p>
          <div class="settings-row flex items-center justify-between px-0 py-1">
            <span class="text-sm settings-label">Aktuelle Adresse</span>
            <span class="text-sm font-mono settings-value">
              {{ data.profile.email ?? "— nicht gesetzt —" }}
            </span>
          </div>
          <div class="flex justify-end" style="margin-top: 12px">
            <button
              @click="emailEditing = true"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
            >
              {{ data.profile.email ? "Email ändern" : "Email hinterlegen" }}
            </button>
          </div>
        </div>

        <!-- Email-Aenderung: Neue Adresse eingeben -->
        <div v-else-if="!emailVerifyTicket" class="settings-card p-4 space-y-3">
          <p class="text-sm" style="color: var(--color-text-muted); margin: 0">
            Wir senden einen Bestätigungs-Code an die neue Adresse.
            Erst nach erfolgreicher Bestätigung wird die Adresse aktiv.
          </p>
          <div class="flex items-center gap-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Neue Email</label>
            <input
              v-model="emailNew"
              type="email"
              autocomplete="email"
              placeholder="name@firma.at"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            />
          </div>
          <div class="flex gap-2 justify-end pt-1">
            <button
              @click="cancelEmailChange"
              :disabled="emailBusy"
              class="px-4 py-1.5 text-sm rounded"
              style="background:transparent; border:1px solid var(--color-border)"
            >
              Abbrechen
            </button>
            <button
              @click="startEmailChange"
              :disabled="emailBusy || !emailNewValid"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
              :style="{ opacity: (emailBusy || !emailNewValid) ? 0.5 : 1 }"
            >
              {{ emailBusy ? "..." : "Code senden" }}
            </button>
          </div>
        </div>

        <!-- Email-Aenderung: Code aus Mail bestätigen -->
        <div v-else class="settings-card p-4 space-y-3">
          <p class="text-sm" style="color: var(--color-text-muted); margin: 0">
            Wir haben einen 6-stelligen Code an
            <strong v-if="emailHint" class="font-mono">{{ emailHint }}</strong>
            geschickt. Code unten eingeben, um die Email-Aenderung zu bestaetigen.
            10 Minuten gültig.
          </p>
          <div class="flex items-center gap-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Code</label>
            <input
              v-model="emailVerifyCode"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="7"
              autocomplete="one-time-code"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm font-mono outline-none"
              style="letter-spacing: 0.15em"
            />
          </div>
          <div class="flex gap-2 justify-end pt-1">
            <button
              @click="cancelEmailChange"
              :disabled="emailBusy"
              class="px-4 py-1.5 text-sm rounded"
              style="background:transparent; border:1px solid var(--color-border)"
            >
              Abbrechen
            </button>
            <button
              @click="verifyEmailChange"
              :disabled="emailBusy || !emailVerifyCode"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
              :style="{ opacity: (emailBusy || !emailVerifyCode) ? 0.5 : 1 }"
            >
              {{ emailBusy ? "..." : "Bestätigen" }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── Microsoft-Konto (Outlook-Calendar) ─────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">
          Microsoft-Konto
          <span
            class="ml-2 text-xs px-2 py-0.5 rounded-full"
            :style="
              !msStatus.available
                ? 'background:#f4f4f5; color:#52525b'
                : msStatus.connected
                  ? 'background:#dcfce7; color:#166534'
                  : 'background:#fef3c7; color:#92400e'
            "
          >
            {{
              !msStatus.available
                ? "Nicht konfiguriert"
                : msStatus.connected
                  ? "Verbunden"
                  : "Nicht verbunden"
            }}
          </span>
        </h3>

        <!-- Backend ist nicht konfiguriert -->
        <div v-if="!msStatus.available" class="settings-card p-4">
          <p class="text-sm" style="color: var(--color-text-muted); margin: 0">
            Microsoft-Integration ist auf diesem Server nicht aktiviert.
            <span v-if="msStatus.reason">{{ msStatus.reason }}</span>
            <span v-else>Admin muss <code class="font-mono">MS_CLIENT_ID</code>, <code class="font-mono">MS_CLIENT_SECRET</code> und <code class="font-mono">MS_TENANT_ID</code> in der <code class="font-mono">.env</code> setzen.</span>
          </p>
        </div>

        <!-- Nicht verbunden — Connect-Button -->
        <div v-else-if="!msStatus.connected" class="settings-card p-4">
          <p class="text-sm" style="color: var(--color-text-muted); margin-bottom: 12px">
            Verbinde dein Microsoft-Konto, um Outlook-Kalender mit Bau-OS zu synchronisieren.
            Termine landen in deinem Outlook und Outlook-Termine erscheinen in Bau-OS.
          </p>
          <div v-if="msMessage" class="ms-message" :class="msMessage.type === 'ok' ? 'ms-msg-ok' : 'ms-msg-err'">
            {{ msMessage.text }}
          </div>
          <div class="flex justify-end" style="margin-top: 12px">
            <button
              @click="connectMicrosoft"
              :disabled="msBusy"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition flex items-center gap-2"
              :style="{ opacity: msBusy ? 0.5 : 1 }"
            >
              <!-- Microsoft-Logo: vier Quadrate als CSS -->
              <span class="ms-logo-mini">
                <span style="background:#F25022"></span>
                <span style="background:#7FBA00"></span>
                <span style="background:#00A4EF"></span>
                <span style="background:#FFB900"></span>
              </span>
              {{ msBusy ? "..." : "Mit Microsoft verbinden" }}
            </button>
          </div>
        </div>

        <!-- Verbunden — Anzeige + Settings + Trennen -->
        <div v-else class="settings-card p-4 space-y-3">
          <div class="settings-row flex items-center justify-between px-0 py-1">
            <span class="text-sm settings-label">Verbunden mit</span>
            <span class="text-sm font-mono settings-value">
              {{ msStatus.account?.msEmail }}
            </span>
          </div>
          <div v-if="msStatus.account?.msDisplayName" class="settings-row flex items-center justify-between px-0 py-1">
            <span class="text-sm settings-label">Name</span>
            <span class="text-sm settings-value">{{ msStatus.account.msDisplayName }}</span>
          </div>

          <!-- Calendar-Mode-Auswahl -->
          <div class="settings-row flex items-center gap-3 px-0 py-2">
            <label class="text-sm settings-label flex-shrink-0" style="width: 140px">Kalender</label>
            <select
              :value="msStatus.account?.calendarMode"
              :disabled="msBusy"
              @change="updateMsSettings({ calendarMode: ($event.target as HTMLSelectElement).value as 'default' | 'bau-os' })"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            >
              <option value="default">Standard-Kalender (Outlook-Default)</option>
              <option value="bau-os">Eigener „Bau-OS"-Kalender (wird automatisch angelegt)</option>
            </select>
          </div>

          <!-- Sync-Schalter -->
          <label
            class="settings-row flex items-center gap-3 px-0 py-2"
            style="cursor: pointer"
          >
            <input
              type="checkbox"
              :checked="msStatus.account?.syncEnabled"
              :disabled="msBusy"
              @change="updateMsSettings({ syncEnabled: ($event.target as HTMLInputElement).checked })"
            />
            <div style="flex: 1">
              <div class="text-sm">Sync aktiv</div>
              <div class="text-xs" style="color: var(--color-text-muted); margin-top: 2px">
                Wenn aktiviert: Bau-OS-Termine werden in Outlook angelegt und Outlook-Termine in Bau-OS importiert.
              </div>
            </div>
          </label>

          <div v-if="msStatus.account?.lastSyncAt" class="text-xs" style="color: var(--color-text-tertiary)">
            Letzte Synchronisation: {{ msStatus.account.lastSyncAt }}
          </div>
          <div v-if="msStatus.account?.lastSyncError" class="text-xs ms-msg-err" style="padding: 8px 10px; border-radius: 6px">
            Letzter Sync-Fehler: {{ msStatus.account.lastSyncError }}
          </div>

          <div v-if="msMessage" class="ms-message" :class="msMessage.type === 'ok' ? 'ms-msg-ok' : 'ms-msg-err'">
            {{ msMessage.text }}
          </div>

          <div class="flex justify-end" style="margin-top: 12px">
            <button
              @click="disconnectMicrosoft"
              :disabled="msBusy"
              class="px-4 py-1.5 text-sm rounded"
              style="background:transparent; border:1px solid #dc2626; color:#dc2626"
            >
              Verbindung trennen
            </button>
          </div>
        </div>
      </section>

      <!-- ── LLM / Laufzeit ─────────────────────────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">LLM</h3>
        <div class="settings-card settings-divide">
          <div class="settings-row flex items-center gap-3 px-4 py-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Aktives Modell</label>
            <input
              v-model="modelInput"
              type="text"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm font-mono outline-none"
              :placeholder="data.system.defaultModel"
            />
            <button
              @click="applyModel"
              :disabled="savingModel || !modelInput.trim() || modelInput.trim() === data.runtime.currentModel"
              class="settings-ghost-btn px-3 py-1.5 text-sm font-medium rounded disabled:opacity-50 transition"
            >
              Setzen
            </button>
          </div>
          <div class="settings-row px-4 py-3">
            <p class="text-xs settings-label mb-2">Cloud-Modelle (Ollama Cloud):</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="m in CLOUD_MODELS"
                :key="m.id"
                @click="pickModel(m.id)"
                :title="m.desc"
                :class="[
                  'settings-chip px-2.5 py-1 text-xs rounded transition text-left',
                  modelInput === m.id ? 'settings-chip-active' : '',
                ]"
              >
                <span class="font-mono">{{ m.label }}</span>
              </button>
            </div>
            <p class="text-[11px] mt-2" style="color: var(--color-text-tertiary)">
              Klick waehlt das Modell vor — mit "Setzen" wird es aktiv. Braucht einen Ollama-Cloud-Account (<code class="font-mono">ollama signin</code>) und <code class="font-mono">OLLAMA_BASE_URL=https://ollama.com</code> in der .env.
            </p>
          </div>
          <div class="settings-row flex items-center justify-between px-4 py-3">
            <div>
              <p class="text-sm" style="color: var(--color-text-secondary)">Fast-Mode</p>
              <p class="text-xs" style="color: var(--color-text-tertiary)">
                Nutzt das Schnell-Modell ({{ data.system.fastModel }}) statt {{ data.system.defaultModel }}
              </p>
            </div>
            <button
              @click="toggleFast"
              :class="[
                'px-3 py-1 text-xs font-medium rounded transition',
                data.runtime.fastMode ? 'primary-btn' : 'settings-ghost-btn',
              ]"
            >
              {{ data.runtime.fastMode ? "An" : "Aus" }}
            </button>
          </div>
          <div
            class="settings-row flex items-center justify-between px-4 py-3 text-xs"
            style="color: var(--color-text-tertiary)"
          >
            <span>Subagent-Modell</span>
            <span class="font-mono">{{ data.system.subagentModel }}</span>
          </div>
        </div>
      </section>

      <!-- ── Praeferenzen ───────────────────────────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">Praeferenzen</h3>
        <div class="settings-card settings-divide">
          <label class="settings-row flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
            <div>
              <p class="text-sm" style="color: var(--color-text-secondary)">Benachrichtigungen</p>
              <p class="text-xs" style="color: var(--color-text-tertiary)">
                Telegram-Toasts bei neuen Aufgaben und Terminen
              </p>
            </div>
            <input v-model="notificationsEnabled" type="checkbox" class="settings-checkbox" />
          </label>

          <label class="settings-row flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
            <div>
              <p class="text-sm" style="color: var(--color-text-secondary)">
                Dateisuche im Chat standardmaessig an
              </p>
              <p class="text-xs" style="color: var(--color-text-tertiary)">
                Der Chat startet mit aktiver Vault-Suche (+-Menue)
              </p>
            </div>
            <input v-model="chatSearchMode" type="checkbox" class="settings-checkbox" />
          </label>

          <div class="settings-row flex items-center gap-3 px-4 py-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Standard-Projekt</label>
            <select
              v-model="defaultProject"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            >
              <option :value="null">Kein Standard</option>
              <option v-for="p in projects" :key="p.name" :value="p.name">{{ p.name }}</option>
            </select>
          </div>
        </div>

        <div class="flex justify-end mt-3">
          <button
            @click="saveSettings"
            :disabled="savingSettings || !dirty"
            class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
            :style="{ opacity: (savingSettings || !dirty) ? 0.5 : 1 }"
          >
            {{ savingSettings ? "..." : "Speichern" }}
          </button>
        </div>
      </section>

      <!-- ── System-Info ───────────────────────────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">System</h3>
        <div class="settings-card settings-divide text-sm">
          <div class="settings-row flex items-center justify-between px-4 py-2.5">
            <span class="settings-label">Datenbank</span>
            <span
              :style="{
                color: data.runtime.dbEnabled
                  ? 'var(--color-text-secondary)'
                  : 'var(--color-text-tertiary)'
              }"
            >
              {{ data.runtime.dbEnabled ? "Aktiv (PostgreSQL + pgvector)" : "Nicht aktiv (Dateisystem-Fallback)" }}
            </span>
          </div>
          <div class="settings-row flex items-center justify-between px-4 py-2.5">
            <span class="settings-label">Sprache</span>
            <span class="settings-value">{{ data.system.language }} ({{ data.system.locale }})</span>
          </div>
          <div class="settings-row flex items-center justify-between px-4 py-2.5">
            <span class="settings-label">Zeitzone</span>
            <span class="settings-value">{{ data.system.timezone }}</span>
          </div>
          <div class="settings-row flex items-center justify-between px-4 py-2.5">
            <span class="settings-label">Ollama-URL</span>
            <span class="settings-value font-mono text-xs">{{ data.system.ollamaBaseUrl }}</span>
          </div>
          <div class="settings-row flex items-center justify-between px-4 py-2.5">
            <span class="settings-label">Auto-Kompaktieren ab</span>
            <span class="settings-value">{{ data.system.compactThreshold.toLocaleString() }} Zeichen</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.primary-btn {
  background: var(--color-primary);
  color: var(--color-bg);
  border: 1px solid var(--color-primary);
}
.primary-btn:hover:not(:disabled) {
  opacity: 0.9;
}
.primary-btn:disabled {
  cursor: not-allowed;
}

.settings-h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.settings-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
}

.settings-divide > .settings-row + .settings-row,
.settings-divide > label.settings-row + .settings-row,
.settings-divide > .settings-row + label.settings-row,
.settings-divide > label.settings-row + label.settings-row {
  border-top: 1px solid var(--color-border-subtle);
}

.settings-label {
  color: var(--color-text-muted);
}
.settings-value {
  color: var(--color-text);
}

/* Mobile: settings-rows duerfen wrappen statt zu quetschen.
   Label oben, Wert/Input darunter — sonst passt nichts auf 375px. */
@media (max-width: 767.98px) {
  .settings-row {
    flex-wrap: wrap !important;
    gap: 6px 12px !important;
  }
  .settings-row.flex.items-center.gap-3 {
    /* Input-Rows (Label + Input + Button): vertikal stapeln */
    flex-direction: column !important;
    align-items: stretch !important;
  }
  .settings-row .settings-label.w-40 {
    width: auto !important;
  }
  .settings-value {
    word-break: break-word;
    text-align: left;
  }
  .settings-row.justify-between .settings-value {
    text-align: right;
    margin-left: auto;
  }
}

.settings-input {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
}
.settings-input:focus {
  border-color: var(--color-text-faint);
  box-shadow: 0 0 0 1px var(--color-text-faint);
}

.settings-ghost-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.settings-ghost-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.settings-chip {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.settings-chip:hover {
  background: var(--color-bg-subtle);
}
.settings-chip-active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-bg);
}
.settings-chip-active:hover {
  background: var(--color-primary);
  opacity: 0.9;
}

.settings-checkbox {
  accent-color: var(--color-primary);
}

.settings-flash {
  border: 1px solid;
}
.settings-flash-ok {
  border-color: var(--color-border);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
}
.settings-flash-err {
  border-color: var(--color-danger-border, #fecaca);
  background: var(--color-danger-bg, #fef2f2);
  color: var(--color-danger-text, #b91c1c);
}

/* ── Microsoft-Sektion ─────────────────────────────────── */
.ms-message {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  margin-top: 12px;
}
.ms-msg-ok {
  background: #dcfce7;
  color: #166534;
}
.ms-msg-err {
  background: #fee2e2;
  color: #991b1b;
}

/* Microsoft 4-Quadrate-Logo, mini fuer Buttons */
.ms-logo-mini {
  display: inline-grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  width: 14px;
  height: 14px;
}
.ms-logo-mini > span {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
