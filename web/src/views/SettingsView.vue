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

// ── Telegram-Bot (Phase 6) ───────────────────────────────────────────
interface BotStatus {
  loading: boolean;
  hasToken: boolean;
  enabled: boolean;
  chatId: string | null;
  /** Telegram-Username (ohne @) — nur gesetzt wenn Bot tatsaechlich
   *  laeuft (Backend hat erfolgreich getMe() ausgefuehrt). */
  botUsername: string | null;
  /** True wenn der Bot-Manager den Bot wirklich gespawnt hat. False wenn
   *  Token gesetzt aber Bot nicht startet (z.B. Decryption-Fehler oder
   *  ungueltiger Token). */
  botRunning: boolean;
}
const botStatus = ref<BotStatus>({
  loading: true,
  hasToken: false,
  enabled: true,
  chatId: null,
  botUsername: null,
  botRunning: false,
});
const botTokenInput = ref("");
const botSaving = ref(false);
const botMessage = ref<string | null>(null);
const botError = ref<string | null>(null);

// Telegram-Bot-Token-Format: 9-10 Ziffern, Doppelpunkt, dann ein 35-Zeichen
// Token aus Buchstaben/Ziffern/Bindestrich/Underscore. Wir sind etwas
// permissiv (Mindest-Laengen), damit wir nicht bei kleinen Format-Aenderungen
// von Telegram brechen.
const BOT_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const tokenValid = computed(() => BOT_TOKEN_RE.test(botTokenInput.value.trim()));

async function loadBotStatus() {
  botStatus.value.loading = true;
  try {
    const res = await api.get<Omit<BotStatus, "loading">>("/me/telegram-bot");
    botStatus.value = { loading: false, ...res };
  } catch {
    botStatus.value.loading = false;
  }
}

async function saveBotToken() {
  const token = botTokenInput.value.trim();
  if (!token || botSaving.value) return;
  // Frontend-Validation — Backend validiert auch nochmal.
  if (!BOT_TOKEN_RE.test(token)) {
    botError.value = "Bot-Token hat falsches Format. Erwartet: 123456789:ABC… (von @BotFather)";
    return;
  }
  botSaving.value = true;
  botError.value = null;
  botMessage.value = null;
  try {
    const res = await api.put<{ ok: boolean; botUsername: string | null; botRunning: boolean }>(
      "/me/telegram-bot",
      { token },
    );
    botTokenInput.value = "";
    if (res.botRunning && res.botUsername) {
      botMessage.value = `Bot @${res.botUsername} läuft. Jetzt /pair Code in Telegram schicken.`;
    } else {
      botMessage.value = "Token gespeichert, aber Bot startet nicht. Token von @BotFather noch gültig?";
    }
    setTimeout(() => (botMessage.value = null), 8000);
    await loadBotStatus();
  } catch (e) {
    botError.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    botSaving.value = false;
  }
}

async function removeBotToken() {
  if (!confirm("Telegram-Bot wirklich entfernen?")) return;
  botSaving.value = true;
  botError.value = null;
  try {
    await api.put("/me/telegram-bot", { token: null });
    botMessage.value = "Bot entfernt.";
    setTimeout(() => (botMessage.value = null), 3000);
    await loadBotStatus();
  } catch (e) {
    botError.value = e instanceof Error ? e.message : "Entfernen fehlgeschlagen";
  } finally {
    botSaving.value = false;
  }
}

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
  if (newPassword.value.length < 6) {
    flash("error", "Neues Passwort muss mindestens 6 Zeichen haben");
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
  void loadBotStatus();
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

      <!-- ── Telegram-Bot (Phase 6) ─────────────────────────────────── -->
      <section>
        <h3 class="settings-h3 mb-3">Mein Telegram-Bot</h3>
        <div class="settings-card p-4">
          <div v-if="botStatus.loading" class="text-sm" style="color: var(--color-text-muted)">
            Lade…
          </div>
          <template v-else>
            <!-- Status-Block: was läuft / was fehlt -->
            <div class="bot-status-row">
              <span
                class="bot-status-dot"
                :class="
                  botStatus.botRunning
                    ? 'bot-status-active'
                    : botStatus.hasToken
                      ? 'bot-status-error'
                      : 'bot-status-inactive'
                "
              ></span>
              <div style="flex: 1">
                <div style="font-size: 13px; font-weight: 600; color: var(--color-text)">
                  <template v-if="botStatus.botRunning && botStatus.botUsername">
                    Bot @{{ botStatus.botUsername }} läuft
                  </template>
                  <template v-else-if="botStatus.hasToken">
                    Token gesetzt, aber Bot läuft nicht
                  </template>
                  <template v-else>Noch kein Bot eingerichtet</template>
                </div>
                <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px">
                  <template v-if="botStatus.chatId">
                    ✓ gepairt mit Chat <span class="font-mono">{{ botStatus.chatId }}</span> — Notifications aktiv
                  </template>
                  <template v-else-if="botStatus.botRunning">
                    Noch nicht gepairt — siehe Schritt 3 unten.
                  </template>
                  <template v-else-if="botStatus.hasToken">
                    Token gespeichert, aber getMe() schlägt fehl. Token bei @BotFather prüfen oder revoken.
                  </template>
                  <template v-else>Folge der Anleitung unten.</template>
                </div>
              </div>
              <a
                v-if="botStatus.botRunning && botStatus.botUsername"
                :href="`https://t.me/${botStatus.botUsername}`"
                target="_blank"
                rel="noopener"
                class="settings-ghost-btn px-3 py-1.5 text-sm rounded"
                style="text-decoration: none"
              >
                Im Telegram öffnen
              </a>
            </div>

            <!-- Schritt-für-Schritt-Anleitung -->
            <ol class="bot-steps">
              <li>
                Bot bei
                <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="bot-link">@BotFather</a>
                anlegen → <code class="bot-inline-code">/newbot</code> → Anweisungen folgen → Token wie
                <code class="bot-inline-code">123456789:AAE…</code> erhalten.
              </li>
              <li>
                Token unten eintragen + speichern → Backend startet sofort deinen persönlichen Bot.
              </li>
              <li>
                Admin gibt dir einen Pair-Code → in deinem Bot
                <code class="bot-inline-code">/pair CODE</code> schicken → fertig.
              </li>
            </ol>

            <!-- Token-Eingabe -->
            <div class="flex items-center gap-3 mb-2">
              <input
                v-model="botTokenInput"
                type="password"
                placeholder="123456789:ABC-DEF... (von @BotFather)"
                class="settings-input flex-1 px-3 py-1.5 rounded text-sm font-mono outline-none"
                style="min-width: 0"
                :class="{
                  'bot-input-invalid':
                    botTokenInput.length > 0 && !tokenValid,
                }"
              />
              <button
                class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
                :disabled="botSaving || !tokenValid"
                :style="{ opacity: botSaving || !tokenValid ? 0.5 : 1 }"
                @click="saveBotToken"
              >
                {{ botSaving ? "…" : botStatus.hasToken ? "Bot wechseln" : "Bot einrichten" }}
              </button>
            </div>
            <div
              v-if="botTokenInput.length > 0 && !tokenValid"
              style="font-size: 11px; color: var(--color-warning-text, #b45309); margin-bottom: 8px"
            >
              Format passt nicht — Telegram-Tokens sehen so aus:
              <span class="font-mono">123456789:ABCdefGHI-JKL_mnoPQR_stuVWXyz0123456</span>
            </div>

            <div
              v-if="botStatus.hasToken"
              class="flex items-center justify-between"
              style="margin-top: 8px"
            >
              <button
                class="settings-ghost-btn px-3 py-1.5 text-sm rounded"
                @click="removeBotToken"
                :disabled="botSaving"
              >
                Bot entfernen
              </button>
              <span v-if="botMessage" style="font-size: 12px; color: var(--color-success-text)">
                {{ botMessage }}
              </span>
            </div>
            <p
              v-if="botError"
              style="
                margin-top: 12px;
                padding: 8px 12px;
                font-size: 12px;
                color: var(--color-danger-text);
                background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
                border-radius: 6px;
              "
            >
              {{ botError }}
            </p>
          </template>
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

/* ── Bot-Status-Dot ────────────────────────────────────── */
.bot-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.bot-status-active {
  background: var(--color-success-text, #16a34a);
}
.bot-status-inactive {
  background: var(--color-text-faint);
}
.bot-status-error {
  background: var(--color-warning-text, #b45309);
}

.bot-status-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  margin-bottom: 16px;
}
.bot-status-row .bot-status-dot {
  margin-top: 5px;
  flex-shrink: 0;
}

.bot-steps {
  list-style: decimal;
  padding-left: 20px;
  margin: 0 0 14px 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.7;
}
.bot-steps li {
  margin-bottom: 4px;
}
.bot-link {
  color: var(--color-primary);
  text-decoration: underline;
}
.bot-inline-code {
  font-family: var(--font-mono, monospace);
  background: var(--color-bg);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--color-border-subtle);
  font-size: 11px;
}
.bot-input-invalid {
  border-color: var(--color-warning-text, #b45309) !important;
}
</style>
