<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { api } from "../api";
import QRCode from "qrcode";

interface SettingsState {
  displayName?: string;
  notificationsEnabled?: boolean;
  defaultProject?: string | null;
  chatSearchMode?: boolean;
}

interface SettingsResponse {
  profile: { username: string; role: string; createdAt: string };
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

// ── 2FA / TOTP ──────────────────────────────────────────────────────────────
// Drei Zustaende:
//   - twoFaStatus.enabled === false + setupSecret == null  → Aus, Button "Aktivieren"
//   - twoFaStatus.enabled === false + setupSecret != null  → Setup laeuft (QR sichtbar)
//   - twoFaStatus.enabled === true                          → Aktiv, Button "Deaktivieren"
type TwoFaStatus = { enabled: boolean; available: boolean };
const twoFaStatus = ref<TwoFaStatus>({ enabled: false, available: false });
const setupSecret = ref<string | null>(null);
const setupUri = ref<string | null>(null);
const setupToken = ref("");
const backupCodes = ref<string[] | null>(null);
const twoFaBusy = ref(false);

const disableMode = ref(false);
const disablePassword = ref("");
const disableToken = ref("");

async function loadTwoFaStatus() {
  try {
    twoFaStatus.value = await api.get<TwoFaStatus>("/auth/2fa/status");
  } catch {
    /* still rendern, dann sieht der User halt "nicht verfuegbar" */
  }
}

async function start2faSetup() {
  twoFaBusy.value = true;
  try {
    const res = await api.post<{ secret: string; otpauthUri: string }>("/auth/2fa/setup", {});
    setupSecret.value = res.secret;
    setupUri.value = res.otpauthUri;
    setupToken.value = "";
    backupCodes.value = null;
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Setup fehlgeschlagen");
  } finally {
    twoFaBusy.value = false;
  }
}

async function verify2faSetup() {
  if (!setupToken.value || setupToken.value.replace(/\s/g, "").length !== 6) {
    flash("error", "Bitte 6-stelligen Token eingeben");
    return;
  }
  twoFaBusy.value = true;
  try {
    const res = await api.post<{ ok: boolean; backupCodes: string[] }>("/auth/2fa/verify", {
      token: setupToken.value.replace(/\s/g, ""),
    });
    backupCodes.value = res.backupCodes;
    setupSecret.value = null;
    setupUri.value = null;
    setupToken.value = "";
    twoFaStatus.value = { enabled: true, available: true };
    flash("success", "2FA aktiviert. Bitte Backup-Codes sichern!");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Verifikation fehlgeschlagen");
  } finally {
    twoFaBusy.value = false;
  }
}

function cancel2faSetup() {
  setupSecret.value = null;
  setupUri.value = null;
  setupToken.value = "";
}

function startDisable() {
  disableMode.value = true;
  disablePassword.value = "";
  disableToken.value = "";
}

function cancelDisable() {
  disableMode.value = false;
  disablePassword.value = "";
  disableToken.value = "";
}

async function confirmDisable() {
  if (!disablePassword.value || !disableToken.value) {
    flash("error", "Passwort und Token erforderlich");
    return;
  }
  twoFaBusy.value = true;
  try {
    const cleanToken = disableToken.value.replace(/\s/g, "");
    // Heuristik: 6 Ziffern = TOTP, sonst Backup-Code
    const payload =
      /^\d{6}$/.test(cleanToken)
        ? { password: disablePassword.value, token: cleanToken }
        : { password: disablePassword.value, backupCode: cleanToken };
    await api.post("/auth/2fa/disable", payload);
    twoFaStatus.value = { enabled: false, available: true };
    backupCodes.value = null;
    cancelDisable();
    flash("success", "2FA deaktiviert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Deaktivierung fehlgeschlagen");
  } finally {
    twoFaBusy.value = false;
  }
}

function copyBackupCodes() {
  if (!backupCodes.value) return;
  const text = backupCodes.value.join("\n");
  void navigator.clipboard?.writeText(text).catch(() => {});
  flash("success", "Backup-Codes in Zwischenablage kopiert");
}

function dismissBackupCodes() {
  backupCodes.value = null;
}

// QR-Code clientseitig als Data-URL rendern (kein externer Service —
// otpauth-URIs sind sensibel, dafuer wollen wir keinen Roundtrip).
const qrDataUrl = ref<string | null>(null);
watch(setupUri, async (uri) => {
  if (!uri) {
    qrDataUrl.value = null;
    return;
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(uri, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  } catch {
    qrDataUrl.value = null;
  }
});

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
  void loadTwoFaStatus();
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

      <!-- ── Zwei-Faktor-Authentifizierung ─────────────────────────── -->
      <section v-if="twoFaStatus.available">
        <h3 class="settings-h3 mb-3">
          Zwei-Faktor-Authentifizierung
          <span
            v-if="twoFaStatus.enabled"
            class="ml-2 text-xs px-2 py-0.5 rounded-full"
            style="background:#dcfce7; color:#166534"
          >Aktiv</span>
          <span
            v-else
            class="ml-2 text-xs px-2 py-0.5 rounded-full"
            style="background:#f4f4f5; color:#52525b"
          >Aus</span>
        </h3>

        <!-- Aus + nicht im Setup → Aktivieren-Button -->
        <div
          v-if="!twoFaStatus.enabled && !setupSecret && !backupCodes"
          class="settings-card p-4"
        >
          <p class="text-sm" style="color: var(--color-text-muted); margin-bottom: 12px">
            Zusaetzlicher Schutz beim Login: nach Passwort wird ein 6-stelliger
            Code aus deiner Authenticator-App (Google Authenticator, Aegis,
            1Password, Bitwarden, ...) verlangt.
          </p>
          <div class="flex justify-end">
            <button
              @click="start2faSetup"
              :disabled="twoFaBusy"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
              :style="{ opacity: twoFaBusy ? 0.5 : 1 }"
            >
              {{ twoFaBusy ? "..." : "2FA aktivieren" }}
            </button>
          </div>
        </div>

        <!-- Setup laeuft → QR + Token-Eingabe -->
        <div
          v-else-if="setupSecret && setupUri"
          class="settings-card p-4 space-y-4"
        >
          <p class="text-sm" style="color: var(--color-text-muted); margin: 0">
            Scanne den QR-Code in deiner Authenticator-App. Falls scannen nicht
            geht, kannst du den Secret manuell eingeben.
          </p>
          <div class="flex flex-wrap gap-4 items-start">
            <div
              v-if="qrDataUrl"
              style="background:#fff; padding:8px; border-radius:8px; flex-shrink:0"
            >
              <img :src="qrDataUrl" alt="2FA QR" style="display:block; width:220px; height:220px" />
            </div>
            <div class="flex-1" style="min-width: 240px">
              <label class="text-xs settings-label" style="display:block; margin-bottom:4px">
                Secret (Base32, manuell eingeben)
              </label>
              <code
                class="font-mono text-sm"
                style="display:block; padding:8px 10px; background:var(--color-surface-2,#f4f4f5); border-radius:6px; word-break:break-all"
              >{{ setupSecret }}</code>
              <div class="flex items-center gap-3 mt-3">
                <label class="text-sm settings-label flex-shrink-0">Aktueller Code</label>
                <input
                  v-model="setupToken"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  maxlength="7"
                  placeholder="123456"
                  autocomplete="one-time-code"
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm font-mono outline-none"
                />
              </div>
            </div>
          </div>
          <div class="flex gap-2 justify-end">
            <button
              @click="cancel2faSetup"
              :disabled="twoFaBusy"
              class="px-4 py-1.5 text-sm rounded"
              style="background:transparent; border:1px solid var(--color-border)"
            >
              Abbrechen
            </button>
            <button
              @click="verify2faSetup"
              :disabled="twoFaBusy || !setupToken"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
              :style="{ opacity: (twoFaBusy || !setupToken) ? 0.5 : 1 }"
            >
              {{ twoFaBusy ? "..." : "Bestaetigen & aktivieren" }}
            </button>
          </div>
        </div>

        <!-- Aktivierung erfolgreich → Backup-Codes anzeigen (einmalig!) -->
        <div
          v-else-if="backupCodes"
          class="settings-card p-4 space-y-3"
          style="border:2px solid #f59e0b"
        >
          <div class="flex items-start gap-2">
            <span style="font-size:18px">⚠️</span>
            <div>
              <strong class="text-sm">Bitte jetzt sichern</strong>
              <p class="text-xs" style="color: var(--color-text-muted); margin-top:4px">
                Diese 10 Backup-Codes ersetzen den Authenticator wenn du dein
                Geraet verlierst. Jeder Code ist genau <em>einmal</em> nutzbar.
                Speichere sie in einem Passwort-Manager — sie werden NICHT
                erneut angezeigt.
              </p>
            </div>
          </div>
          <pre
            class="font-mono text-sm"
            style="background:var(--color-surface-2,#f4f4f5); padding:12px; border-radius:6px; margin:0; overflow:auto"
          >{{ backupCodes.join("\n") }}</pre>
          <div class="flex gap-2 justify-end">
            <button
              @click="copyBackupCodes"
              class="px-4 py-1.5 text-sm rounded"
              style="background:transparent; border:1px solid var(--color-border)"
            >
              Kopieren
            </button>
            <button
              @click="dismissBackupCodes"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
            >
              Habe ich gespeichert
            </button>
          </div>
        </div>

        <!-- 2FA aktiv → Disable-Bereich -->
        <div
          v-else-if="twoFaStatus.enabled && !disableMode"
          class="settings-card p-4"
        >
          <p class="text-sm" style="color: var(--color-text-muted); margin-bottom: 12px">
            2FA ist aktiv. Beim Login wird nach dem Passwort der 6-stellige
            Code abgefragt.
          </p>
          <div class="flex justify-end">
            <button
              @click="startDisable"
              class="px-4 py-1.5 text-sm rounded"
              style="background:transparent; border:1px solid #dc2626; color:#dc2626"
            >
              Deaktivieren
            </button>
          </div>
        </div>

        <!-- Disable-Mode: Passwort + Token bestaetigen -->
        <div
          v-else-if="disableMode"
          class="settings-card p-4 space-y-3"
        >
          <p class="text-sm" style="color: var(--color-text-muted); margin: 0">
            Zur Bestaetigung Passwort und einen aktuellen Code (oder Backup-Code)
            eingeben.
          </p>
          <div class="flex items-center gap-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Passwort</label>
            <input
              v-model="disablePassword"
              type="password"
              autocomplete="current-password"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
            />
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm settings-label w-40 flex-shrink-0">Code / Backup</label>
            <input
              v-model="disableToken"
              type="text"
              autocomplete="one-time-code"
              placeholder="123456 oder abcd-1234-5678"
              class="settings-input flex-1 px-3 py-1.5 rounded text-sm font-mono outline-none"
            />
          </div>
          <div class="flex gap-2 justify-end pt-1">
            <button
              @click="cancelDisable"
              :disabled="twoFaBusy"
              class="px-4 py-1.5 text-sm rounded"
              style="background:transparent; border:1px solid var(--color-border)"
            >
              Abbrechen
            </button>
            <button
              @click="confirmDisable"
              :disabled="twoFaBusy || !disablePassword || !disableToken"
              class="px-4 py-1.5 text-sm font-medium rounded"
              style="background:#dc2626; color:white; border:none"
              :style="{ opacity: (twoFaBusy || !disablePassword || !disableToken) ? 0.5 : 1 }"
            >
              {{ twoFaBusy ? "..." : "2FA deaktivieren" }}
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

</style>
