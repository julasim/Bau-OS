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

onMounted(loadAll);
</script>

<template>
  <div class="max-w-3xl">
    <h2 class="text-lg font-semibold mb-1">Einstellungen</h2>
    <p class="text-xs text-gray-400 mb-6">
      Persoenliche Praeferenzen, Profil und Laufzeit-Optionen. System-Variablen (DATABASE_URL, BOT_TOKEN etc.)
      werden in der <code class="font-mono">.env</code>-Datei verwaltet.
    </p>

    <!-- Flash-Meldung -->
    <div
      v-if="message"
      :class="[
        'mb-4 px-3 py-2 text-sm border rounded',
        message.type === 'success'
          ? 'border-gray-200 bg-gray-50 text-gray-700'
          : 'border-red-200 bg-red-50 text-red-700',
      ]"
    >
      {{ message.text }}
    </div>

    <div v-if="loading" class="text-sm text-gray-400 py-8">Laedt...</div>

    <div v-else-if="data" class="space-y-8">
      <!-- ── Profil ─────────────────────────────────────────────────── -->
      <section>
        <h3 class="text-sm font-semibold text-gray-800 mb-3">Profil</h3>
        <div class="border border-gray-200 rounded-lg divide-y divide-gray-100">
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-gray-500">Benutzername</span>
            <span class="text-sm font-mono text-gray-800">{{ data.profile.username }}</span>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-gray-500">Rolle</span>
            <span class="text-sm text-gray-800">{{ data.profile.role }}</span>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-gray-500">Registriert</span>
            <span class="text-sm text-gray-800">{{ data.profile.createdAt }}</span>
          </div>
          <div class="flex items-center gap-3 px-4 py-3">
            <label class="text-sm text-gray-500 w-40 flex-shrink-0">Anzeige-Name</label>
            <input
              v-model="displayName"
              type="text"
              placeholder="z.B. Julius"
              class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
        </div>
      </section>

      <!-- ── Passwort ───────────────────────────────────────────────── -->
      <section>
        <h3 class="text-sm font-semibold text-gray-800 mb-3">Passwort aendern</h3>
        <div class="border border-gray-200 rounded-lg p-4 space-y-3">
          <div class="flex items-center gap-3">
            <label class="text-sm text-gray-500 w-40 flex-shrink-0">Altes Passwort</label>
            <input
              v-model="oldPassword"
              type="password"
              autocomplete="current-password"
              class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm text-gray-500 w-40 flex-shrink-0">Neues Passwort</label>
            <input
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div class="flex items-center gap-3">
            <label class="text-sm text-gray-500 w-40 flex-shrink-0">Bestaetigen</label>
            <input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div class="flex justify-end pt-1">
            <button
              @click="changePassword"
              :disabled="savingPassword || !oldPassword || !newPassword"
              class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50 transition"
            >
              {{ savingPassword ? "..." : "Passwort aendern" }}
            </button>
          </div>
        </div>
      </section>

      <!-- ── LLM / Laufzeit ─────────────────────────────────────────── -->
      <section>
        <h3 class="text-sm font-semibold text-gray-800 mb-3">LLM</h3>
        <div class="border border-gray-200 rounded-lg divide-y divide-gray-100">
          <div class="flex items-center gap-3 px-4 py-3">
            <label class="text-sm text-gray-500 w-40 flex-shrink-0">Aktives Modell</label>
            <input
              v-model="modelInput"
              type="text"
              class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm font-mono outline-none focus:ring-1 focus:ring-gray-400"
              :placeholder="data.system.defaultModel"
            />
            <button
              @click="applyModel"
              :disabled="savingModel || !modelInput.trim() || modelInput.trim() === data.runtime.currentModel"
              class="px-3 py-1.5 text-sm font-medium border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 transition"
            >
              Setzen
            </button>
          </div>
          <div class="px-4 py-3">
            <p class="text-xs text-gray-500 mb-2">Cloud-Modelle (Ollama Cloud):</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="m in CLOUD_MODELS"
                :key="m.id"
                @click="pickModel(m.id)"
                :title="m.desc"
                :class="[
                  'px-2.5 py-1 text-xs rounded border transition text-left',
                  modelInput === m.id
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                ]"
              >
                <span class="font-mono">{{ m.label }}</span>
              </button>
            </div>
            <p class="text-[11px] text-gray-400 mt-2">
              Klick waehlt das Modell vor — mit "Setzen" wird es aktiv. Braucht einen Ollama-Cloud-Account (<code class="font-mono">ollama signin</code>) und <code class="font-mono">OLLAMA_BASE_URL=https://ollama.com</code> in der .env.
            </p>
          </div>
          <div class="flex items-center justify-between px-4 py-3">
            <div>
              <p class="text-sm text-gray-700">Fast-Mode</p>
              <p class="text-xs text-gray-400">Nutzt das Schnell-Modell ({{ data.system.fastModel }}) statt {{ data.system.defaultModel }}</p>
            </div>
            <button
              @click="toggleFast"
              :class="[
                'px-3 py-1 text-xs font-medium rounded border transition',
                data.runtime.fastMode
                  ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              ]"
            >
              {{ data.runtime.fastMode ? "An" : "Aus" }}
            </button>
          </div>
          <div class="flex items-center justify-between px-4 py-3 text-xs text-gray-400">
            <span>Subagent-Modell</span>
            <span class="font-mono">{{ data.system.subagentModel }}</span>
          </div>
        </div>
      </section>

      <!-- ── Praeferenzen ───────────────────────────────────────────── -->
      <section>
        <h3 class="text-sm font-semibold text-gray-800 mb-3">Praeferenzen</h3>
        <div class="border border-gray-200 rounded-lg divide-y divide-gray-100">
          <label class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
            <div>
              <p class="text-sm text-gray-700">Benachrichtigungen</p>
              <p class="text-xs text-gray-400">Telegram-Toasts bei neuen Aufgaben und Terminen</p>
            </div>
            <input v-model="notificationsEnabled" type="checkbox" class="accent-gray-900" />
          </label>

          <label class="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
            <div>
              <p class="text-sm text-gray-700">Dateisuche im Chat standardmaessig an</p>
              <p class="text-xs text-gray-400">Der Chat startet mit aktiver Vault-Suche (+-Menue)</p>
            </div>
            <input v-model="chatSearchMode" type="checkbox" class="accent-gray-900" />
          </label>

          <div class="flex items-center gap-3 px-4 py-3">
            <label class="text-sm text-gray-500 w-40 flex-shrink-0">Standard-Projekt</label>
            <select
              v-model="defaultProject"
              class="flex-1 px-3 py-1.5 border border-gray-200 rounded text-sm outline-none focus:ring-1 focus:ring-gray-400"
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
            class="px-4 py-1.5 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50 transition"
          >
            {{ savingSettings ? "..." : "Speichern" }}
          </button>
        </div>
      </section>

      <!-- ── System-Info ───────────────────────────────────────────── -->
      <section>
        <h3 class="text-sm font-semibold text-gray-800 mb-3">System</h3>
        <div class="border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
          <div class="flex items-center justify-between px-4 py-2.5">
            <span class="text-gray-500">Datenbank</span>
            <span :class="data.runtime.dbEnabled ? 'text-gray-800' : 'text-gray-400'">
              {{ data.runtime.dbEnabled ? "Aktiv (PostgreSQL + pgvector)" : "Nicht aktiv (Dateisystem-Fallback)" }}
            </span>
          </div>
          <div class="flex items-center justify-between px-4 py-2.5">
            <span class="text-gray-500">Sprache</span>
            <span class="text-gray-800">{{ data.system.language }} ({{ data.system.locale }})</span>
          </div>
          <div class="flex items-center justify-between px-4 py-2.5">
            <span class="text-gray-500">Zeitzone</span>
            <span class="text-gray-800">{{ data.system.timezone }}</span>
          </div>
          <div class="flex items-center justify-between px-4 py-2.5">
            <span class="text-gray-500">Ollama-URL</span>
            <span class="text-gray-800 font-mono text-xs">{{ data.system.ollamaBaseUrl }}</span>
          </div>
          <div class="flex items-center justify-between px-4 py-2.5">
            <span class="text-gray-500">Auto-Kompaktieren ab</span>
            <span class="text-gray-800">{{ data.system.compactThreshold.toLocaleString() }} Zeichen</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
