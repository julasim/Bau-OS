<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { api } from "../api";
import { useConfirm } from "../composables/useConfirm";

const { confirm } = useConfirm();

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
    const res = await api.post<{ ticket: string; emailHint?: string }>("/settings/email/change/start", {
      email: emailNew.value.trim().toLowerCase(),
    });
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
  calendarMode: "default" | "patio";
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  accessTokenValid: boolean;
  /** Phase 4: Webhook-Subscription aktiv? Bedeutet Instant-Sync (<1s
   *  Latenz) statt 5-min-Polling. */
  webhookActive?: boolean;
  subscriptionExpiresAt?: string | null;
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
    if (msStatus.value.connected) {
      await loadMsCalendars();
    } else {
      msCalendars.value = [];
    }
  } catch {
    msStatus.value = { connected: false, available: false };
    msCalendars.value = [];
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
      if (!ev.data || ev.data.type !== "patio:ms-oauth") return;
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
  if (
    !(await confirm({
      message: "Microsoft-Verbindung wirklich trennen? Synchronisierte Termine bleiben in PATIO erhalten.",
      confirmDanger: true,
    }))
  )
    return;
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

async function updateMsSettings(patch: { calendarMode?: "default" | "patio"; syncEnabled?: boolean }) {
  msBusy.value = true;
  try {
    await api.patch("/auth/microsoft/settings", patch);
    await loadMsStatus();
    // Master-Toggle erfordert ggf. neue Calendar-Liste (z.B. wenn Subs
    // gerade angelegt werden — dann zeigt webhookActive sonst nicht).
    await loadMsCalendars();
  } catch (e) {
    msMessage.value = { type: "err", text: e instanceof Error ? e.message : "Update fehlgeschlagen" };
  } finally {
    msBusy.value = false;
  }
}

// ── Multi-Calendar (Phase 5c) ───────────────────────────────────────────────

interface MsUserCalendar {
  userId: string;
  calendarId: string;
  displayName: string | null;
  enabled: boolean;
  direction: "both" | "pull-only" | "push-only";
  subscriptionId: string | null;
  subscriptionExpiresAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  addedAt: string;
}

const msCalendars = ref<MsUserCalendar[]>([]);
const msCalendarsBusy = ref(false);

async function loadMsCalendars() {
  if (!msStatus.value.connected) {
    msCalendars.value = [];
    return;
  }
  try {
    const res = await api.get<{ calendars: MsUserCalendar[] }>("/auth/microsoft/calendars");
    msCalendars.value = res.calendars ?? [];
  } catch {
    msCalendars.value = [];
  }
}

async function refreshMsCalendars() {
  msCalendarsBusy.value = true;
  msMessage.value = null;
  try {
    const res = await api.post<{ calendars: MsUserCalendar[] }>("/auth/microsoft/calendars/refresh", {});
    msCalendars.value = res.calendars ?? [];
    msMessage.value = { type: "ok", text: "Kalender-Liste aktualisiert." };
  } catch (e) {
    msMessage.value = { type: "err", text: e instanceof Error ? e.message : "Refresh fehlgeschlagen" };
  } finally {
    msCalendarsBusy.value = false;
  }
}

async function toggleMsCalendar(cal: MsUserCalendar, enabled: boolean) {
  msCalendarsBusy.value = true;
  msMessage.value = null;
  try {
    await api.patch(`/auth/microsoft/calendars/${encodeURIComponent(cal.calendarId)}`, { enabled });
    await loadMsCalendars();
    await loadMsStatus();
  } catch (e) {
    msMessage.value = { type: "err", text: e instanceof Error ? e.message : "Toggle fehlgeschlagen" };
  } finally {
    msCalendarsBusy.value = false;
  }
}

// Hinweis: Die Telegram-Bot-Verwaltung wurde aus den User-Settings
// entfernt — Admin verwaltet Bot-Token und Pairing zentral via
// /admin/users (Bot-Token-Dialog + Pair-Dialog). Self-Service-Endpoint
// /me/telegram-bot bleibt im Backend erhalten als Recovery-Pfad, wird
// aber im UI nicht mehr exponiert.

// ── Lokale Modelle (eigenes Ollama) ──────────────────────────────────────────
// Schnellauswahl fuer lokal per `ollama pull` installierte Modelle. Laufen
// vollstaendig auf der eigenen Maschine — keine Cloud, keine Kosten pro Token.
const LOCAL_MODELS: { id: string; label: string; desc: string }[] = [
  { id: "qwen2.5:7b", label: "qwen2.5 7B", desc: "Standard-Modell, guter Allrounder" },
  { id: "qwen2.5:14b", label: "qwen2.5 14B", desc: "Staerker, braucht mehr RAM/VRAM" },
  { id: "llama3.1:8b", label: "llama3.1 8B", desc: "Meta, solide bei Tools" },
  { id: "mistral:7b", label: "mistral 7B", desc: "Schnell, sparsam" },
  { id: "gemma2:9b", label: "gemma2 9B", desc: "Google, gut bei Sprache" },
];

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

// ── Theme + UI-Praeferenzen (Phase 6f) ─────────────────────────────────────
import { useTheme } from "../composables/useTheme";
import { useWorkspaceShell } from "../composables/useWorkspaceShell";

const themeApi = useTheme();
const shell = useWorkspaceShell();
type ThemeMode = "light" | "dark" | "system";
type FontSize = "small" | "medium" | "large";

interface ServerPreferences {
  theme: ThemeMode;
  accentColor: string;
  fontSize: FontSize;
  compactUI: boolean;
  weekStart: "monday" | "sunday";
  calendarDefaultView: "month" | "week" | "day" | "list";
  dateFormat: "DD.MM.YYYY" | "YYYY-MM-DD";
  telegramNotifications: {
    termine: boolean;
    tasks: boolean;
    meetings: boolean;
    bautagebuch: boolean;
  };
}

const serverPrefs = ref<ServerPreferences | null>(null);
const prefsBusy = ref(false);

const ACCENT_PRESETS: { hex: string; name: string }[] = [
  { hex: "#111827", name: "Schwarz (Default)" },
  { hex: "#0078d4", name: "Microsoft-Blau" },
  { hex: "#16a34a", name: "Grün" },
  { hex: "#f59e0b", name: "Bernstein" },
  { hex: "#dc2626", name: "Rot" },
  { hex: "#7c3aed", name: "Violett" },
  { hex: "#0891b2", name: "Türkis" },
  { hex: "#db2777", name: "Pink" },
];

async function loadPreferences() {
  try {
    serverPrefs.value = await api.get<ServerPreferences>("/me/preferences");
    // Lokales useTheme an den Server-Stand syncen.
    themeApi.applyFromServer({
      theme: serverPrefs.value.theme,
      accentColor: serverPrefs.value.accentColor,
      fontSize: serverPrefs.value.fontSize,
      compactUI: serverPrefs.value.compactUI,
    });
  } catch {
    serverPrefs.value = null;
  }
}

// Patch erlaubt auch Teil-Updates fuer telegramNotifications (Backend
// macht Deep-Merge), daher loosere Signatur.
type PreferencesPatch = Partial<Omit<ServerPreferences, "telegramNotifications">> & {
  telegramNotifications?: Partial<ServerPreferences["telegramNotifications"]>;
};

async function patchPreferences(patch: PreferencesPatch) {
  prefsBusy.value = true;
  try {
    const updated = await api.patch<ServerPreferences>("/me/preferences", patch);
    serverPrefs.value = updated;
    // Theme-relevante Felder lokal sofort anwenden.
    themeApi.applyFromServer({
      theme: updated.theme,
      accentColor: updated.accentColor,
      fontSize: updated.fontSize,
      compactUI: updated.compactUI,
    });
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    prefsBusy.value = false;
  }
}

// ── Projekt-Module (Phase 6e) ──────────────────────────────────────────────
// Globale Defaults welche Tabs/Module in Projekten verfuegbar sind.

interface ProjectModuleFlags {
  stammdaten: boolean;
  notes: boolean;
  tasks: boolean;
  termine: boolean;
  files: boolean;
  team: boolean;
  bautagebuch: boolean;
  meetings: boolean;
  time_entries: boolean;
}

const PROJECT_MODULES: { key: keyof ProjectModuleFlags; label: string; help: string }[] = [
  { key: "stammdaten", label: "Stammdaten", help: "Projektnummer, Bauherr, Standort, Phase…" },
  { key: "notes", label: "Notizen", help: "Markdown-Notizen zum Projekt." },
  { key: "tasks", label: "Aufgaben", help: "To-Dos mit Zuweisung + Fälligkeit." },
  { key: "termine", label: "Termine", help: "Kalender-Termine für dieses Projekt." },
  { key: "files", label: "Dateien", help: "Pläne, Verträge, Fotos." },
  { key: "team", label: "Team", help: "Beteiligte Personen + Rollen." },
  { key: "bautagebuch", label: "Bautagebuch", help: "Tagesberichte mit Wetter, Personal, Vorkommnissen." },
  { key: "meetings", label: "Meetings", help: "Bauherrenmeetings, Baubesprechungen." },
  { key: "time_entries", label: "Stunden", help: "Stundenerfassung pro Mitarbeiter." },
];

const projectModules = ref<ProjectModuleFlags | null>(null);
const projectModulesBusy = ref(false);

async function loadProjectModules() {
  try {
    const res = await api.get<{ modules: ProjectModuleFlags }>("/project-modules");
    projectModules.value = res.modules;
  } catch {
    projectModules.value = null;
  }
}

async function toggleProjectModule(key: keyof ProjectModuleFlags, value: boolean) {
  if (!projectModules.value) return;
  projectModulesBusy.value = true;
  try {
    const res = await api.patch<{ modules: ProjectModuleFlags }>("/project-modules", { [key]: value });
    projectModules.value = res.modules;
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    projectModulesBusy.value = false;
  }
}

// ── Word-Export-Templates (Phase 6d) ────────────────────────────────────────
type ExportKind = "meeting" | "bautagebuch" | "time-entry" | "project-summary";

interface ExportTemplate {
  id: string;
  kind: ExportKind;
  name: string;
  description: string | null;
  filename: string;
  isDefault: boolean;
  uploadedAt: string;
  sizeBytes: number;
}

const EXPORT_KINDS: { id: ExportKind; label: string; help: string }[] = [
  { id: "meeting", label: "Meeting-Protokolle", help: "Word-Vorlage für Meeting-Exports." },
  { id: "bautagebuch", label: "Bautagebuch", help: "Tagesberichte als Word-Datei." },
  { id: "time-entry", label: "Stundenzettel", help: "Stunden-Auszüge im eigenen Layout." },
  { id: "project-summary", label: "Projekt-Übersicht", help: "Stammdaten als Deckblatt o.ä." },
];

const exportTemplates = ref<ExportTemplate[]>([]);
const exportKindFilter = ref<ExportKind>("meeting");
const exportBusy = ref(false);
const exportVariables = ref<{ tag: string; description: string }[]>([]);

const exportTemplatesByKind = computed(() => exportTemplates.value.filter((t) => t.kind === exportKindFilter.value));

async function loadExportTemplates() {
  try {
    exportTemplates.value = await api.get<ExportTemplate[]>("/export-templates");
  } catch {
    exportTemplates.value = [];
  }
}

async function loadExportVariables() {
  try {
    exportVariables.value = await api.get<{ tag: string; description: string }[]>(
      `/export-templates/_variables?kind=${exportKindFilter.value}`,
    );
  } catch {
    exportVariables.value = [];
  }
}

watch(exportKindFilter, () => void loadExportVariables());

async function uploadExportTemplate(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!/\.docx$/i.test(file.name)) {
    flash("error", "Nur .docx-Dateien erlaubt");
    input.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    flash("error", "Datei zu groß (max 10 MB)");
    input.value = "";
    return;
  }
  const name = file.name.replace(/\.docx$/i, "");
  exportBusy.value = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", exportKindFilter.value);
    fd.append("name", name);
    if (exportTemplatesByKind.value.length === 0) fd.append("isDefault", "true");
    const res = await fetch("/api/export-templates", {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("patio-token") ?? ""}` },
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload fehlgeschlagen" }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await loadExportTemplates();
    flash("success", `Vorlage "${name}" hochgeladen`);
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Upload fehlgeschlagen");
  } finally {
    exportBusy.value = false;
    input.value = "";
  }
}

async function setExportTemplateDefault(t: ExportTemplate) {
  exportBusy.value = true;
  try {
    await api.post(`/export-templates/${t.id}/default`, {});
    await loadExportTemplates();
    flash("success", `"${t.name}" ist jetzt Standard`);
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Default-Setzen fehlgeschlagen");
  } finally {
    exportBusy.value = false;
  }
}

async function removeExportTemplate(t: ExportTemplate) {
  if (!(await confirm({ message: `Vorlage "${t.name}" wirklich löschen?`, confirmDanger: true }))) return;
  exportBusy.value = true;
  try {
    await api.delete(`/export-templates/${t.id}`);
    await loadExportTemplates();
    flash("success", "Vorlage gelöscht");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Löschen fehlgeschlagen");
  } finally {
    exportBusy.value = false;
  }
}

function downloadExportOriginal(t: ExportTemplate) {
  void (async () => {
    try {
      const res = await fetch(`/api/export-templates/${t.id}/file`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("patio-token") ?? ""}` },
      });
      if (!res.ok) throw new Error("Download fehlgeschlagen");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = t.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Download fehlgeschlagen");
    }
  })();
}

function testRenderExportTemplate(t: ExportTemplate) {
  void (async () => {
    try {
      const res = await fetch(`/api/export-templates/${t.id}/test`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("patio-token") ?? ""}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Test-Render fehlgeschlagen" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `test-${t.filename}`;
      a.click();
      URL.revokeObjectURL(url);
      flash("success", "Test-Datei wurde erzeugt");
    } catch (e) {
      flash("error", e instanceof Error ? e.message : "Test-Render fehlgeschlagen");
    }
  })();
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ── Vorlagen (Phase 6c) ─────────────────────────────────────────────────────
// Markdown-Vorlagen fuer Notizen, Meetings, Bautagebuch-Eintraege.
// Settings-UI: links Liste pro Kind, rechts Editor mit Live-Preview.

type TemplateKind = "note" | "meeting" | "bautagebuch";

interface Template {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  body: string;
  isDefault: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

const TEMPLATE_KINDS: { id: TemplateKind; label: string }[] = [
  { id: "meeting", label: "Meetings" },
  { id: "note", label: "Notizen" },
  { id: "bautagebuch", label: "Bautagebuch" },
];

const templates = ref<Template[]>([]);
const templateKindFilter = ref<TemplateKind>("meeting");
const templateEditing = ref<Template | null>(null);
const templateDraft = ref<{
  kind: TemplateKind;
  name: string;
  description: string;
  body: string;
  isDefault: boolean;
}>({
  kind: "meeting",
  name: "",
  description: "",
  body: "",
  isDefault: false,
});
const templateBusy = ref(false);
const templateVariables = ref<{ name: string; description: string }[]>([]);
const templatePreview = ref<string>("");

const templatesByKind = computed(() => {
  return templates.value.filter((t) => t.kind === templateKindFilter.value);
});

async function loadTemplates() {
  try {
    templates.value = await api.get<Template[]>("/templates");
  } catch {
    templates.value = [];
  }
}

async function loadTemplateVariables() {
  try {
    templateVariables.value = await api.get<{ name: string; description: string }[]>("/templates/_variables");
  } catch {
    templateVariables.value = [];
  }
}

function startNewTemplate() {
  templateEditing.value = null;
  templateDraft.value = {
    kind: templateKindFilter.value,
    name: "",
    description: "",
    body: "",
    isDefault: false,
  };
  templatePreview.value = "";
}

function startEditTemplate(t: Template) {
  templateEditing.value = t;
  templateDraft.value = {
    kind: t.kind,
    name: t.name,
    description: t.description ?? "",
    body: t.body,
    isDefault: t.isDefault,
  };
  void renderTemplatePreview();
}

function cancelTemplate() {
  templateEditing.value = null;
  templateDraft.value = { kind: templateKindFilter.value, name: "", description: "", body: "", isDefault: false };
  templatePreview.value = "";
}

async function saveTemplate() {
  if (!templateDraft.value.name.trim()) {
    flash("error", "Name ist Pflicht");
    return;
  }
  templateBusy.value = true;
  try {
    if (templateEditing.value) {
      const updated = await api.patch<Template>(`/templates/${templateEditing.value.id}`, {
        name: templateDraft.value.name.trim(),
        description: templateDraft.value.description.trim() || null,
        body: templateDraft.value.body,
        isDefault: templateDraft.value.isDefault,
      });
      templateEditing.value = updated;
      flash("success", "Vorlage gespeichert");
    } else {
      await api.post<Template>("/templates", {
        kind: templateDraft.value.kind,
        name: templateDraft.value.name.trim(),
        description: templateDraft.value.description.trim() || null,
        body: templateDraft.value.body,
        isDefault: templateDraft.value.isDefault,
      });
      flash("success", "Vorlage angelegt");
      cancelTemplate();
    }
    await loadTemplates();
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    templateBusy.value = false;
  }
}

async function removeTemplate(t: Template) {
  if (!(await confirm({ message: `Vorlage "${t.name}" wirklich loeschen?`, confirmDanger: true }))) return;
  templateBusy.value = true;
  try {
    await api.delete(`/templates/${t.id}`);
    if (templateEditing.value?.id === t.id) cancelTemplate();
    await loadTemplates();
    flash("success", "Vorlage geloescht");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Loeschen fehlgeschlagen");
  } finally {
    templateBusy.value = false;
  }
}

async function setTemplateDefault(t: Template) {
  templateBusy.value = true;
  try {
    await api.patch<Template>(`/templates/${t.id}`, { isDefault: true });
    await loadTemplates();
    flash("success", `"${t.name}" ist jetzt Standard fuer ${t.kind}`);
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Default-Setzen fehlgeschlagen");
  } finally {
    templateBusy.value = false;
  }
}

/** Rendert den Body mit Variablen ersetzt. Nutzt das render-Endpoint mit
 *  einem Test-Project das es vermutlich gibt — falls keiner gegeben ist,
 *  bleiben Projekt-Placeholder leer. */
async function renderTemplatePreview() {
  if (!templateEditing.value) {
    // Bei "Neu" rendern wir mit Dummy-Vars clientseitig.
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yy = today.getFullYear();
    const datum = `${dd}.${mm}.${yy}`;
    const dummy: Record<string, string> = {
      Datum: datum,
      Tag: datum,
      Heute: datum,
      Projekt: "(Beispiel-Projekt)",
      Bauherr: "(Bauherr)",
      Firma: "(deine Firma)",
      User: "(du)",
    };
    templatePreview.value = templateDraft.value.body.replace(
      /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g,
      (m: string, name: string) => dummy[name] ?? m,
    );
    return;
  }
  try {
    const res = await api.get<{ rendered: string }>(`/templates/${templateEditing.value.id}/render`);
    templatePreview.value = res.rendered;
  } catch {
    templatePreview.value = templateDraft.value.body;
  }
}

let _tplPreviewTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => templateDraft.value.body,
  () => {
    if (_tplPreviewTimer) clearTimeout(_tplPreviewTimer);
    _tplPreviewTimer = setTimeout(() => {
      void renderTemplatePreview();
    }, 400);
  },
);

/** Liefert "{{Name}}" als String — Helper damit die innere ""-Notation
 *  in templates nicht den Vue-SFC-Parser verwirrt (siehe Phase-6a-Hotfix). */
function placeholderRef(name: string): string {
  return "{{" + name + "}}";
}
watch(templateKindFilter, () => {
  if (!templateEditing.value) {
    templateDraft.value.kind = templateKindFilter.value;
  }
});

// ── Branding (Phase 6b) ─────────────────────────────────────────────────────
// Firmen-Logo + Stammdaten (wird in Word-/PDF-Exports verwendet).
//
// Logo-Upload geht direkt als multipart/form-data, der Rest patcht via
// JSON. Logo-Vorschau zeigt /api/branding/logo?bust=<ts> damit Browser-
// Cache nach einem Re-Upload nicht das alte Bild zeigt.

interface BrandingState {
  companyName: string | null;
  logoUrl: string | null;
  logoMimeType: string | null;
  logoFilename: string | null;
  primaryColor: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  updatedAt: string;
}

const branding = ref<BrandingState | null>(null);
const brandingDraft = ref({
  companyName: "",
  primaryColor: "",
  address: "",
  phone: "",
  email: "",
  website: "",
});
const brandingBusy = ref(false);
const brandingLogoBust = ref(0); // Cache-Buster fuer <img>-src nach Upload

async function loadBranding() {
  try {
    const data = await api.get<BrandingState | null>("/branding");
    branding.value = data;
    if (data) {
      brandingDraft.value = {
        companyName: data.companyName ?? "",
        primaryColor: data.primaryColor ?? "",
        address: data.address ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        website: data.website ?? "",
      };
    }
  } catch {
    branding.value = null;
  }
}

const brandingDirty = computed(() => {
  if (!branding.value) return false;
  const d = brandingDraft.value;
  const b = branding.value;
  return (
    d.companyName !== (b.companyName ?? "") ||
    d.primaryColor !== (b.primaryColor ?? "") ||
    d.address !== (b.address ?? "") ||
    d.phone !== (b.phone ?? "") ||
    d.email !== (b.email ?? "") ||
    d.website !== (b.website ?? "")
  );
});

async function saveBranding() {
  brandingBusy.value = true;
  try {
    const body = {
      companyName: brandingDraft.value.companyName.trim() || null,
      primaryColor: brandingDraft.value.primaryColor.trim() || null,
      address: brandingDraft.value.address.trim() || null,
      phone: brandingDraft.value.phone.trim() || null,
      email: brandingDraft.value.email.trim() || null,
      website: brandingDraft.value.website.trim() || null,
    };
    branding.value = await api.patch<BrandingState>("/branding", body);
    flash("success", "Branding gespeichert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    brandingBusy.value = false;
  }
}

async function uploadLogoFile(file: File) {
  if (!file) return;
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/i.test(file.type)) {
    flash("error", "Nur PNG, JPEG, SVG oder WebP erlaubt");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    flash("error", "Logo zu groß (max 2 MB)");
    return;
  }
  brandingBusy.value = true;
  try {
    const fd = new FormData();
    fd.append("logo", file);
    const res = await fetch("/api/branding/logo", {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("patio-token") ?? ""}` },
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload fehlgeschlagen" }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    branding.value = (await res.json()) as BrandingState;
    brandingLogoBust.value = Date.now();
    flash("success", "Logo hochgeladen");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Logo-Upload fehlgeschlagen");
  } finally {
    brandingBusy.value = false;
  }
}

async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await uploadLogoFile(file);
  input.value = "";
}

// Drag & Drop fuer Logo-Upload (Phase 6g)
const logoDragActive = ref(false);
function onLogoDragOver(e: DragEvent) {
  e.preventDefault();
  logoDragActive.value = true;
}
function onLogoDragLeave(e: DragEvent) {
  e.preventDefault();
  logoDragActive.value = false;
}
async function onLogoDrop(e: DragEvent) {
  e.preventDefault();
  logoDragActive.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) await uploadLogoFile(file);
}

async function removeLogo() {
  if (!(await confirm({ message: "Logo wirklich entfernen?", confirmDanger: true }))) return;
  brandingBusy.value = true;
  try {
    branding.value = await api.delete<BrandingState>("/branding/logo");
    brandingLogoBust.value = Date.now();
    flash("success", "Logo entfernt");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Entfernen fehlgeschlagen");
  } finally {
    brandingBusy.value = false;
  }
}

// ── Custom Template Variables ──────────────────────────────────────────────
interface CustomVariable {
  id: string;
  name: string;
  description: string | null;
  value: string;
  createdAt: string;
  updatedAt: string;
}

const customVars = ref<CustomVariable[]>([]);
const customVarsBusy = ref(false);
const customVarDraft = ref({ name: "", description: "", value: "" });
const customVarEditing = ref<CustomVariable | null>(null);

async function loadCustomVars() {
  try {
    customVars.value = await api.get<CustomVariable[]>("/templates/custom-variables");
  } catch {
    customVars.value = [];
  }
}

function startEditCustomVar(cv: CustomVariable) {
  customVarEditing.value = cv;
  customVarDraft.value = { name: cv.name, description: cv.description ?? "", value: cv.value };
}

function cancelCustomVar() {
  customVarEditing.value = null;
  customVarDraft.value = { name: "", description: "", value: "" };
}

async function saveCustomVar() {
  if (!customVarDraft.value.name.trim()) return;
  customVarsBusy.value = true;
  try {
    if (customVarEditing.value) {
      const updated = await api.patch<CustomVariable>(`/templates/custom-variables/${customVarEditing.value.id}`, {
        name: customVarDraft.value.name.trim(),
        description: customVarDraft.value.description.trim() || null,
        value: customVarDraft.value.value,
      });
      customVars.value = customVars.value.map((v) => (v.id === updated.id ? updated : v));
      customVarEditing.value = null;
    } else {
      const created = await api.post<CustomVariable>("/templates/custom-variables", {
        name: customVarDraft.value.name.trim(),
        description: customVarDraft.value.description.trim() || null,
        value: customVarDraft.value.value,
      });
      customVars.value = [...customVars.value, created];
    }
    customVarDraft.value = { name: "", description: "", value: "" };
    customVarEditing.value = null;
    flash("success", "Platzhalter gespeichert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    customVarsBusy.value = false;
  }
}

async function deleteCustomVar(cv: CustomVariable) {
  if (!(await confirm({ message: `Platzhalter "${cv.name}" löschen?`, confirmDanger: true }))) return;
  customVarsBusy.value = true;
  try {
    await api.delete(`/templates/custom-variables/${cv.id}`);
    customVars.value = customVars.value.filter((v) => v.id !== cv.id);
    if (customVarEditing.value?.id === cv.id) cancelCustomVar();
    flash("success", "Platzhalter gelöscht");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Löschen fehlgeschlagen");
  } finally {
    customVarsBusy.value = false;
  }
}

// ── Custom Project Modules ─────────────────────────────────────────────────
interface CustomProjectModule {
  id: string;
  key: string;
  label: string;
  description: string | null;
  icon: string;
  enabledByDefault: boolean;
  sortOrder: number;
  createdAt: string;
}

const customModules = ref<CustomProjectModule[]>([]);
const customModulesBusy = ref(false);
const customModuleDraft = ref({ key: "", label: "", description: "", enabledByDefault: true });

async function loadCustomModules() {
  try {
    customModules.value = await api.get<CustomProjectModule[]>("/project-modules/custom");
  } catch {
    customModules.value = [];
  }
}

async function saveCustomModule() {
  if (!customModuleDraft.value.key.trim() || !customModuleDraft.value.label.trim()) return;
  customModulesBusy.value = true;
  try {
    const created = await api.post<CustomProjectModule>("/project-modules/custom", {
      key: customModuleDraft.value.key.trim().toLowerCase().replace(/\s+/g, "_"),
      label: customModuleDraft.value.label.trim(),
      description: customModuleDraft.value.description.trim() || null,
      enabledByDefault: customModuleDraft.value.enabledByDefault,
    });
    customModules.value = [...customModules.value, created];
    customModuleDraft.value = { key: "", label: "", description: "", enabledByDefault: true };
    flash("success", "Modul angelegt");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Anlegen fehlgeschlagen");
  } finally {
    customModulesBusy.value = false;
  }
}

async function deleteCustomModule(m: CustomProjectModule) {
  if (!(await confirm({ message: `Modul "${m.label}" löschen?`, confirmDanger: true }))) return;
  customModulesBusy.value = true;
  try {
    await api.delete(`/project-modules/custom/${m.id}`);
    customModules.value = customModules.value.filter((c) => c.id !== m.id);
    flash("success", "Modul gelöscht");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Löschen fehlgeschlagen");
  } finally {
    customModulesBusy.value = false;
  }
}

// ── Sidebar-Navigation (Phase 6a) ───────────────────────────────────────────
// Settings ist als Apple-Settings-style Sidebar aufgebaut: links Sektionen-
// Liste, rechts der Inhalt der aktiven Sektion. Der gewaehlte Tab bleibt
// in localStorage, damit Refresh nicht zurueck auf "profil" springt.

type SettingsSection =
  | "profil"
  | "email"
  | "microsoft"
  | "modelle"
  | "praeferenzen"
  | "branding"
  | "vorlagen"
  | "word-export"
  | "projekt-module"
  | "system";

const SETTINGS_NAV: { id: SettingsSection; label: string; icon: string; group: string }[] = [
  { id: "profil", label: "Profil & Sicherheit", icon: "user", group: "Konto" },
  { id: "email", label: "Email & 2FA", icon: "mail", group: "Konto" },
  { id: "microsoft", label: "Microsoft Outlook", icon: "calendar", group: "Konto" },
  { id: "modelle", label: "KI-Modelle", icon: "cpu", group: "System" },
  { id: "praeferenzen", label: "Präferenzen", icon: "sliders", group: "System" },
  { id: "branding", label: "Branding", icon: "image", group: "Vorlagen" },
  { id: "vorlagen", label: "Vorlagen", icon: "file-text", group: "Vorlagen" },
  { id: "word-export", label: "Word-Export", icon: "download", group: "Vorlagen" },
  { id: "projekt-module", label: "Projekt-Module", icon: "layers", group: "Vorlagen" },
  { id: "system", label: "System-Info", icon: "info", group: "System" },
];

const SECTION_KEY = "patio-settings-section";
const activeSection = ref<SettingsSection>(
  ((): SettingsSection => {
    const stored = localStorage.getItem(SECTION_KEY) as SettingsSection | null;
    if (stored && SETTINGS_NAV.some((n) => n.id === stored)) return stored;
    return "profil";
  })(),
);

watch(activeSection, (v) => localStorage.setItem(SECTION_KEY, v));

const WIDE_SECTIONS = new Set(["vorlagen", "word-export", "branding", "projekt-module"]);
const isWideSection = computed(() => WIDE_SECTIONS.has(activeSection.value));

const settingsNavGroups = computed(() => {
  const map = new Map<string, typeof SETTINGS_NAV>();
  for (const item of SETTINGS_NAV) {
    if (!map.has(item.group)) map.set(item.group, []);
    map.get(item.group)!.push(item);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
});

onMounted(() => {
  void loadAll();
  void loadMsStatus();
  void loadBranding();
  void loadTemplates();
  void loadTemplateVariables();
  void loadExportTemplates();
  void loadExportVariables();
  void loadProjectModules();
  void loadPreferences();
  void loadCustomVars();
  void loadCustomModules();
});
</script>

<template>
  <div class="settings-layout">
    <!-- Sidebar-Navigation (Phase 6a) — links, scrollt unabhaengig vom Content -->
    <aside class="settings-sidebar">
      <div style="padding: 24px 20px 12px">
        <div class="eyebrow" style="margin-bottom: 6px">System</div>
        <h1 style="font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -0.01em">Einstellungen</h1>
      </div>
      <nav class="settings-nav">
        <div v-for="grp in settingsNavGroups" :key="grp.group" class="settings-nav-group">
          <div class="settings-nav-group-title">{{ grp.group }}</div>
          <button
            v-for="item in grp.items"
            :key="item.id"
            type="button"
            :class="['settings-nav-item', activeSection === item.id ? 'settings-nav-item-active' : '']"
            @click="activeSection = item.id"
          >
            <span class="settings-nav-dot" aria-hidden="true"></span>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </nav>
    </aside>

    <!-- Content-Pane: aktive Sektion -->
    <div :class="['settings-content', isWideSection ? 'settings-content-wide' : '']">
      <!-- Flash-Meldung — global, sektion-uebergreifend -->
      <div
        v-if="message"
        :class="[
          'settings-flash mb-4 px-3 py-2 text-sm rounded',
          message.type === 'success' ? 'settings-flash-ok' : 'settings-flash-err',
        ]"
      >
        {{ message.text }}
      </div>

      <div v-if="loading" class="text-sm py-8" style="color: var(--color-text-tertiary)">Laedt...</div>

      <div v-else-if="data" class="settings-section-wrap">
        <!-- ── Profil & Sicherheit ────────────────────────────────────── -->
        <template v-if="activeSection === 'profil'">
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
                  :disabled="savingPassword || !oldPassword || !newPassword || !confirmPassword"
                  class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
                  :style="{ opacity: savingPassword || !oldPassword || !newPassword || !confirmPassword ? 0.5 : 1 }"
                >
                  {{ savingPassword ? "..." : "Passwort aendern" }}
                </button>
              </div>
            </div>
          </section>
        </template>

        <!-- ── Email (2FA via Email-OTP) ────────────────────────────── -->
        <template v-if="activeSection === 'email'">
          <section>
            <h3 class="settings-h3 mb-3">
              Email (Zwei-Faktor-Login)
              <span
                class="ml-2 text-xs px-2 py-0.5 rounded-full"
                :style="data.profile.email ? 'background:#dcfce7; color:#166534' : 'background:#fef3c7; color:#92400e'"
                >{{ data.profile.email ? "Aktiv" : "Nicht gesetzt" }}</span
              >
            </h3>

            <div v-if="!emailEditing" class="settings-card p-4">
              <p class="text-sm" style="color: var(--color-text-muted); margin-bottom: 12px">
                Bei jedem Login wird nach dem Passwort ein 6-stelliger Code an deine Email-Adresse gesendet.
                Pflicht-Feld — ohne Email ist kein Login möglich.
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
                Wir senden einen Bestätigungs-Code an die neue Adresse. Erst nach erfolgreicher Bestätigung wird die
                Adresse aktiv.
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
                  style="background: transparent; border: 1px solid var(--color-border)"
                >
                  Abbrechen
                </button>
                <button
                  @click="startEmailChange"
                  :disabled="emailBusy || !emailNewValid"
                  class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
                  :style="{ opacity: emailBusy || !emailNewValid ? 0.5 : 1 }"
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
                geschickt. Code unten eingeben, um die Email-Aenderung zu bestaetigen. 10 Minuten gültig.
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
                  style="background: transparent; border: 1px solid var(--color-border)"
                >
                  Abbrechen
                </button>
                <button
                  @click="verifyEmailChange"
                  :disabled="emailBusy || !emailVerifyCode"
                  class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
                  :style="{ opacity: emailBusy || !emailVerifyCode ? 0.5 : 1 }"
                >
                  {{ emailBusy ? "..." : "Bestätigen" }}
                </button>
              </div>
            </div>
          </section>
        </template>

        <!-- ── Microsoft-Konto (Outlook-Calendar) ─────────────────────── -->
        <template v-if="activeSection === 'microsoft'">
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
                {{ !msStatus.available ? "Nicht konfiguriert" : msStatus.connected ? "Verbunden" : "Nicht verbunden" }}
              </span>
            </h3>

            <!-- Backend ist nicht konfiguriert -->
            <div v-if="!msStatus.available" class="settings-card p-4">
              <p class="text-sm" style="color: var(--color-text-muted); margin: 0">
                Microsoft-Integration ist auf diesem Server nicht aktiviert.
                <span v-if="msStatus.reason">{{ msStatus.reason }}</span>
                <span v-else
                  >Admin muss <code class="font-mono">MS_CLIENT_ID</code>,
                  <code class="font-mono">MS_CLIENT_SECRET</code> und <code class="font-mono">MS_TENANT_ID</code> in der
                  <code class="font-mono">.env</code> setzen.</span
                >
              </p>
            </div>

            <!-- Nicht verbunden — Connect-Button -->
            <div v-else-if="!msStatus.connected" class="settings-card p-4">
              <p class="text-sm" style="color: var(--color-text-muted); margin-bottom: 12px">
                Verbinde dein Microsoft-Konto, um Outlook-Kalender mit PATIO zu synchronisieren. Termine landen in
                deinem Outlook und Outlook-Termine erscheinen in PATIO.
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
                    <span style="background: #f25022"></span>
                    <span style="background: #7fba00"></span>
                    <span style="background: #00a4ef"></span>
                    <span style="background: #ffb900"></span>
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
              <div
                v-if="msStatus.account?.msDisplayName"
                class="settings-row flex items-center justify-between px-0 py-1"
              >
                <span class="text-sm settings-label">Name</span>
                <span class="text-sm settings-value">{{ msStatus.account.msDisplayName }}</span>
              </div>

              <!-- Multi-Calendar-Liste (Phase 5c).
               User waehlt aus seinen Outlook-Kalendern beliebig viele aus
               die mit PATIO gesyncet werden sollen. Pro aktiviertem
               Kalender legt das Backend eine eigene Webhook-Subscription
               an. Default-Push-Ziel fuer neue PATIO-Termine ist der
               Kalender mit Anzeigename "PATIO" (wird beim Connect
               automatisch erstellt). -->
              <div class="settings-row flex flex-col gap-2 px-0 py-2">
                <div class="flex items-center justify-between">
                  <label class="text-sm settings-label">Outlook-Kalender</label>
                  <button
                    @click="refreshMsCalendars"
                    :disabled="msCalendarsBusy"
                    class="text-xs"
                    style="
                      padding: 4px 10px;
                      border-radius: 4px;
                      background: transparent;
                      border: 1px solid var(--color-border);
                      cursor: pointer;
                    "
                  >
                    {{ msCalendarsBusy ? "..." : "Aus Outlook neu laden" }}
                  </button>
                </div>
                <div
                  v-if="msCalendars.length === 0"
                  class="text-xs"
                  style="
                    color: var(--color-text-muted);
                    padding: 12px;
                    background: var(--color-bg-subtle);
                    border: 1px dashed var(--color-border);
                    border-radius: 6px;
                  "
                >
                  Keine Kalender geladen. Klick „Aus Outlook neu laden".
                </div>
                <div v-else class="flex flex-col" style="gap: 4px">
                  <label
                    v-for="cal in msCalendars"
                    :key="cal.calendarId"
                    class="flex items-center gap-3"
                    style="
                      cursor: pointer;
                      padding: 8px 10px;
                      border-radius: 6px;
                      border: 1px solid var(--color-border-subtle);
                      background: var(--color-bg-subtle);
                    "
                  >
                    <input
                      type="checkbox"
                      :checked="cal.enabled"
                      :disabled="msCalendarsBusy"
                      @change="toggleMsCalendar(cal, ($event.target as HTMLInputElement).checked)"
                    />
                    <div style="flex: 1; min-width: 0">
                      <div class="text-sm" style="font-weight: 500">
                        {{ cal.displayName || cal.calendarId }}
                      </div>
                      <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 2px">
                        <span v-if="cal.enabled && cal.subscriptionId">Instant-Sync · </span>
                        <span v-else-if="cal.enabled">Polling · </span>
                        <span v-if="cal.lastSyncAt">letzter Sync: {{ cal.lastSyncAt }}</span>
                        <span v-else>noch nicht synchronisiert</span>
                      </div>
                      <div
                        v-if="cal.lastSyncError"
                        class="text-xs ms-msg-err"
                        style="margin-top: 4px; padding: 4px 6px; border-radius: 4px"
                      >
                        Fehler: {{ cal.lastSyncError }}
                      </div>
                    </div>
                  </label>
                </div>
                <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 4px">
                  Aktivierte Kalender werden bidirektional mit PATIO synchronisiert. Neue PATIO-Termine landen im
                  Kalender „PATIO" (oder im ersten aktivierten falls keiner so heißt).
                </div>
              </div>

              <!-- Sync-Schalter -->
              <label class="settings-row flex items-center gap-3 px-0 py-2" style="cursor: pointer">
                <input
                  type="checkbox"
                  :checked="msStatus.account?.syncEnabled"
                  :disabled="msBusy"
                  @change="updateMsSettings({ syncEnabled: ($event.target as HTMLInputElement).checked })"
                />
                <div style="flex: 1">
                  <div class="text-sm">Sync aktiv</div>
                  <div class="text-xs" style="color: var(--color-text-muted); margin-top: 2px">
                    Wenn aktiviert: PATIO-Termine werden in Outlook angelegt und Outlook-Termine in PATIO importiert.
                  </div>
                </div>
              </label>

              <!-- Phase 4: Webhook-Status. Wenn aktiv, hat PATIO bei Microsoft
               eine Subscription registriert und bekommt Push-Notifications
               sobald sich was im Outlook-Calendar aendert (<1s Latenz).
               Wenn nicht aktiv, laeuft das 5-min-Polling als Fallback. -->
              <div
                v-if="msStatus.account?.syncEnabled"
                class="flex items-center"
                style="
                  gap: 8px;
                  padding: 8px 10px;
                  border-radius: 6px;
                  background: var(--color-bg-subtle);
                  border: 1px solid var(--color-border-subtle);
                "
              >
                <span
                  :style="{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: msStatus.account.webhookActive ? '#16a34a' : '#f59e0b',
                    flexShrink: 0,
                  }"
                ></span>
                <div class="text-xs" style="flex: 1">
                  <span v-if="msStatus.account.webhookActive">
                    <strong>Instant-Sync aktiv</strong> — Aenderungen in Outlook erscheinen sofort in PATIO.
                  </span>
                  <span v-else>
                    <strong>Polling-Modus</strong> — Sync alle 5 Minuten. Webhook-Subscription wird beim naechsten Lauf
                    eingerichtet.
                  </span>
                </div>
              </div>

              <div v-if="msStatus.account?.lastSyncAt" class="text-xs" style="color: var(--color-text-tertiary)">
                Letzte Synchronisation: {{ msStatus.account.lastSyncAt }}
              </div>
              <div
                v-if="msStatus.account?.lastSyncError"
                class="text-xs ms-msg-err"
                style="padding: 8px 10px; border-radius: 6px"
              >
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
                  style="background: transparent; border: 1px solid #dc2626; color: #dc2626"
                >
                  Verbindung trennen
                </button>
              </div>
            </div>
          </section>
        </template>

        <!-- ── LLM / Laufzeit ─────────────────────────────────────────── -->
        <template v-if="activeSection === 'modelle'">
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
                <p class="text-xs settings-label mb-2">Lokale Modelle (eigenes Ollama):</p>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="m in LOCAL_MODELS"
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
                  Laufen vollstaendig auf der eigenen Maschine — keine Kosten. Das Modell muss vorher per
                  <code class="font-mono">ollama pull &lt;name&gt;</code> installiert sein.
                </p>
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
                  Klick waehlt das Modell vor — mit "Setzen" wird es aktiv. Braucht einen Ollama-Cloud-Account (<code
                    class="font-mono"
                    >ollama signin</code
                  >) und <code class="font-mono">OLLAMA_BASE_URL=https://ollama.com</code> in der .env.
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
        </template>

        <!-- ── Praeferenzen ───────────────────────────────────────────── -->
        <template v-if="activeSection === 'praeferenzen'">
          <section>
            <h3 class="settings-h3 mb-3">Erscheinungsbild</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Theme, Akzentfarbe und Schriftgröße. Änderungen werden sofort live übernommen.
            </p>

            <!-- Variant: Studio (neutral) vs Atelier (warm) — Workspace v2 -->
            <div class="settings-card p-4" style="margin-bottom: 12px">
              <div class="text-sm" style="font-weight: 600; margin-bottom: 8px">Workspace-Variante</div>
              <div class="flex" style="gap: 8px; flex-wrap: wrap">
                <button
                  v-for="v in ['studio', 'atelier'] as const"
                  :key="v"
                  @click="shell.setVariant(v)"
                  :class="['settings-chip', shell.state.value.variant === v ? 'settings-chip-active' : '']"
                  style="padding: 6px 14px; border-radius: 6px; font-size: 12px"
                >
                  {{ v === "studio" ? "Studio (neutral, dicht)" : "Atelier (warm, ruhig)" }}
                </button>
              </div>
              <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 6px">
                Studio = Schwarz, dichte Listen, scharfe Kanten. Atelier = warmes Papier-Farbschema, weichere Radien,
                Slate-Akzent.
              </div>
            </div>

            <!-- Density: compact vs cozy -->
            <div class="settings-card p-4" style="margin-bottom: 12px">
              <div class="text-sm" style="font-weight: 600; margin-bottom: 8px">Dichte</div>
              <div class="flex" style="gap: 8px">
                <button
                  v-for="d in ['compact', 'cozy'] as const"
                  :key="d"
                  @click="shell.setDensity(d)"
                  :class="['settings-chip', shell.state.value.density === d ? 'settings-chip-active' : '']"
                  style="padding: 6px 14px; border-radius: 6px; font-size: 12px"
                >
                  {{ d === "compact" ? "Kompakt" : "Locker" }}
                </button>
              </div>
              <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 6px">
                Wirkt auf Listen-Höhe, Card-Padding, Detail-Padding.
              </div>
            </div>

            <!-- Theme-Kacheln: Hell / Dunkel / System -->
            <div class="theme-tile-grid" v-if="serverPrefs">
              <button
                v-for="opt in [
                  { id: 'light', label: 'Hell', desc: 'Klassisch hell' },
                  { id: 'dark', label: 'Dunkel', desc: 'Schwarz, kontrastreich' },
                  { id: 'system', label: 'System', desc: 'Folgt dem OS' },
                ] as const"
                :key="opt.id"
                @click="patchPreferences({ theme: opt.id })"
                :class="['theme-tile', serverPrefs.theme === opt.id ? 'theme-tile-active' : '']"
                :disabled="prefsBusy"
              >
                <div :class="['theme-tile-preview', `theme-tile-preview-${opt.id}`]">
                  <div class="theme-tile-bar"></div>
                  <div class="theme-tile-content"></div>
                </div>
                <div class="theme-tile-label">{{ opt.label }}</div>
                <div class="theme-tile-desc">{{ opt.desc }}</div>
              </button>
            </div>

            <!-- Akzentfarbe -->
            <div class="settings-card p-4" style="margin-top: 16px" v-if="serverPrefs">
              <div class="text-sm" style="font-weight: 600; margin-bottom: 10px">Akzentfarbe</div>
              <div class="flex items-center" style="gap: 8px; flex-wrap: wrap">
                <button
                  v-for="c in ACCENT_PRESETS"
                  :key="c.hex"
                  @click="patchPreferences({ accentColor: c.hex })"
                  :title="c.name"
                  :disabled="prefsBusy"
                  :style="{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: c.hex,
                    border:
                      serverPrefs.accentColor.toLowerCase() === c.hex.toLowerCase()
                        ? '3px solid var(--color-text)'
                        : '2px solid var(--color-border)',
                    cursor: 'pointer',
                  }"
                ></button>
                <input
                  type="color"
                  :value="serverPrefs.accentColor"
                  :disabled="prefsBusy"
                  @change="patchPreferences({ accentColor: ($event.target as HTMLInputElement).value })"
                  style="
                    width: 32px;
                    height: 32px;
                    border: 1px dashed var(--color-border);
                    border-radius: 50%;
                    cursor: pointer;
                    padding: 0;
                    background: transparent;
                  "
                  title="Eigene Farbe wählen"
                />
                <span class="text-xs font-mono" style="color: var(--color-text-tertiary); margin-left: 8px">
                  {{ serverPrefs.accentColor }}
                </span>
              </div>
              <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 8px">
                Die Akzentfarbe wirkt auf Buttons, Active-States und Highlights. Bei Schwarz wird das Theme-Default
                verwendet.
              </div>
            </div>

            <!-- Schriftgröße + Compact -->
            <div class="settings-card settings-divide" style="margin-top: 16px" v-if="serverPrefs">
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Schriftgröße</label>
                <div class="flex" style="gap: 6px">
                  <button
                    v-for="s in ['small', 'medium', 'large'] as FontSize[]"
                    :key="s"
                    @click="patchPreferences({ fontSize: s })"
                    :disabled="prefsBusy"
                    :class="['settings-chip', serverPrefs.fontSize === s ? 'settings-chip-active' : '']"
                    style="padding: 4px 12px; border-radius: 6px; font-size: 12px"
                  >
                    {{ s === "small" ? "Klein" : s === "medium" ? "Mittel" : "Groß" }}
                  </button>
                </div>
              </div>
              <label class="settings-row flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
                <div>
                  <p class="text-sm" style="color: var(--color-text-secondary)">Kompakte Oberfläche</p>
                  <p class="text-xs" style="color: var(--color-text-tertiary)">
                    Engere Paddings für mehr Inhalt am Bildschirm
                  </p>
                </div>
                <input
                  type="checkbox"
                  :checked="serverPrefs.compactUI"
                  :disabled="prefsBusy"
                  @change="patchPreferences({ compactUI: ($event.target as HTMLInputElement).checked })"
                />
              </label>
            </div>

            <h3 class="settings-h3 mb-3" style="margin-top: 28px">Kalender & Datum</h3>
            <div class="settings-card settings-divide" v-if="serverPrefs">
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Wochenstart</label>
                <div class="flex" style="gap: 6px">
                  <button
                    v-for="w in ['monday', 'sunday'] as const"
                    :key="w"
                    @click="patchPreferences({ weekStart: w })"
                    :disabled="prefsBusy"
                    :class="['settings-chip', serverPrefs.weekStart === w ? 'settings-chip-active' : '']"
                    style="padding: 4px 12px; border-radius: 6px; font-size: 12px"
                  >
                    {{ w === "monday" ? "Montag" : "Sonntag" }}
                  </button>
                </div>
              </div>
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Kalender-Default</label>
                <select
                  :value="serverPrefs.calendarDefaultView"
                  :disabled="prefsBusy"
                  @change="
                    patchPreferences({
                      calendarDefaultView: ($event.target as HTMLSelectElement)
                        .value as ServerPreferences['calendarDefaultView'],
                    })
                  "
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
                >
                  <option value="month">Monat</option>
                  <option value="week">Woche</option>
                  <option value="day">Tag</option>
                  <option value="list">Liste</option>
                </select>
              </div>
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Datums-Format</label>
                <div class="flex" style="gap: 6px">
                  <button
                    v-for="f in ['DD.MM.YYYY', 'YYYY-MM-DD'] as const"
                    :key="f"
                    @click="patchPreferences({ dateFormat: f })"
                    :disabled="prefsBusy"
                    :class="['settings-chip', serverPrefs.dateFormat === f ? 'settings-chip-active' : '']"
                    style="padding: 4px 12px; border-radius: 6px; font-size: 12px; font-family: ui-monospace, monospace"
                  >
                    {{ f }}
                  </button>
                </div>
              </div>
            </div>

            <h3 class="settings-h3 mb-3" style="margin-top: 28px">Telegram-Benachrichtigungen</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 8px">
              Welche Events sollen via Telegram gesendet werden?
            </p>
            <div class="settings-card settings-divide" v-if="serverPrefs">
              <label
                v-for="t in [
                  { key: 'termine', label: 'Termine', desc: 'Neue Einladungen, Änderungen' },
                  { key: 'tasks', label: 'Aufgaben', desc: 'Zugewiesene To-Dos' },
                  { key: 'meetings', label: 'Meetings', desc: 'Neue Action-Items' },
                  { key: 'bautagebuch', label: 'Bautagebuch', desc: 'Tägliche Erinnerung' },
                ] as const"
                :key="t.key"
                class="settings-row flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
              >
                <div>
                  <p class="text-sm" style="color: var(--color-text-secondary)">{{ t.label }}</p>
                  <p class="text-xs" style="color: var(--color-text-tertiary)">{{ t.desc }}</p>
                </div>
                <input
                  type="checkbox"
                  :checked="serverPrefs.telegramNotifications[t.key]"
                  :disabled="prefsBusy"
                  @change="
                    patchPreferences({
                      telegramNotifications: { [t.key]: ($event.target as HTMLInputElement).checked },
                    })
                  "
                />
              </label>
            </div>

            <h3 class="settings-h3 mb-3" style="margin-top: 28px">Sonstiges</h3>
            <div class="settings-card settings-divide">
              <label class="settings-row flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
                <div>
                  <p class="text-sm" style="color: var(--color-text-secondary)">Globale Telegram-Benachrichtigungen</p>
                  <p class="text-xs" style="color: var(--color-text-tertiary)">
                    Master-Schalter — wenn aus, werden keine Telegram-Toasts gesendet
                  </p>
                </div>
                <input v-model="notificationsEnabled" type="checkbox" class="settings-checkbox" />
              </label>
              <label class="settings-row flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
                <div>
                  <p class="text-sm" style="color: var(--color-text-secondary)">Dateisuche im Chat standardmäßig an</p>
                  <p class="text-xs" style="color: var(--color-text-tertiary)">
                    Der Chat startet mit aktiver Vault-Suche (+-Menü)
                  </p>
                </div>
                <input v-model="chatSearchMode" type="checkbox" class="settings-checkbox" />
              </label>
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Standard-Projekt</label>
                <select v-model="defaultProject" class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none">
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
                :style="{ opacity: savingSettings || !dirty ? 0.5 : 1 }"
              >
                {{ savingSettings ? "..." : "Sonstiges speichern" }}
              </button>
            </div>
          </section>
        </template>

        <!-- ── Branding (Phase 6b) ────────────────────────────────────── -->
        <template v-if="activeSection === 'branding'">
          <section>
            <h3 class="settings-h3 mb-3">Branding</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 16px">
              Logo und Firmenstammdaten. Werden in Word-/PDF-Exports, Visitenkarten-Drucken und Email-Templates
              verwendet.
            </p>

            <!-- Logo-Upload + Vorschau -->
            <div class="settings-card p-5" style="margin-bottom: 16px">
              <div class="text-sm" style="font-weight: 600; margin-bottom: 12px">Logo</div>
              <div class="flex items-center" style="gap: 16px; flex-wrap: wrap">
                <div
                  @dragover.prevent="onLogoDragOver"
                  @dragleave.prevent="onLogoDragLeave"
                  @drop.prevent="onLogoDrop"
                  :style="{
                    width: '160px',
                    height: '100px',
                    border: logoDragActive ? '2px solid var(--color-primary)' : '1px dashed var(--color-border)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: logoDragActive ? 'var(--color-bg-muted)' : 'var(--color-bg-subtle)',
                    flexShrink: 0,
                    overflow: 'hidden',
                    transition: 'all 120ms ease',
                    position: 'relative',
                  }"
                >
                  <img
                    v-if="branding?.logoUrl"
                    :src="`${branding.logoUrl}?bust=${brandingLogoBust}`"
                    :alt="branding.companyName ?? 'Logo'"
                    style="max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none"
                  />
                  <span
                    v-else
                    class="text-xs"
                    style="color: var(--color-text-tertiary); pointer-events: none; text-align: center; padding: 8px"
                  >
                    Logo hier hinziehen<br />oder unten auswählen
                  </span>
                  <div
                    v-if="logoDragActive"
                    class="text-xs"
                    style="
                      position: absolute;
                      inset: 0;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      background: rgba(0, 0, 0, 0.05);
                      color: var(--color-text);
                      font-weight: 500;
                      pointer-events: none;
                    "
                  >
                    Loslassen…
                  </div>
                </div>
                <div style="flex: 1; min-width: 200px">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    :disabled="brandingBusy"
                    @change="uploadLogo"
                    style="font-size: 13px"
                  />
                  <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 6px">
                    PNG, JPEG, SVG oder WebP. Max 2 MB.
                    <span v-if="branding?.logoFilename">Aktuell: {{ branding.logoFilename }}</span>
                  </div>
                  <button
                    v-if="branding?.logoUrl"
                    @click="removeLogo"
                    :disabled="brandingBusy"
                    class="text-xs"
                    style="
                      margin-top: 10px;
                      padding: 4px 10px;
                      border-radius: 4px;
                      background: transparent;
                      border: 1px solid #dc2626;
                      color: #dc2626;
                      cursor: pointer;
                    "
                  >
                    Logo entfernen
                  </button>
                </div>
              </div>
            </div>

            <!-- Stammdaten-Formular -->
            <div class="settings-card settings-divide">
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Firmenname</label>
                <input
                  v-model="brandingDraft.companyName"
                  placeholder="Sima Architecture e.U."
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
                />
              </div>
              <div class="settings-row flex items-start gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Adresse</label>
                <textarea
                  v-model="brandingDraft.address"
                  rows="2"
                  placeholder="Straße, PLZ Ort, Land"
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
                  style="resize: vertical; font-family: inherit"
                ></textarea>
              </div>
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Telefon</label>
                <input
                  v-model="brandingDraft.phone"
                  placeholder="+43 ..."
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
                />
              </div>
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Email</label>
                <input
                  v-model="brandingDraft.email"
                  type="email"
                  placeholder="kontakt@firma.at"
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
                />
              </div>
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Website</label>
                <input
                  v-model="brandingDraft.website"
                  placeholder="https://firma.at"
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
                />
              </div>
              <div class="settings-row flex items-center gap-3 px-4 py-3">
                <label class="text-sm settings-label w-40 flex-shrink-0">Primärfarbe</label>
                <input
                  v-model="brandingDraft.primaryColor"
                  placeholder="#111827"
                  class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none font-mono"
                  style="max-width: 140px"
                />
                <span
                  v-if="brandingDraft.primaryColor"
                  :style="{
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    background: brandingDraft.primaryColor,
                    border: '1px solid var(--color-border)',
                  }"
                ></span>
              </div>
              <div class="flex justify-end px-4 py-3" style="gap: 8px">
                <button
                  @click="saveBranding"
                  :disabled="brandingBusy || !brandingDirty"
                  class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
                  :style="{ opacity: brandingBusy || !brandingDirty ? 0.5 : 1 }"
                >
                  {{ brandingBusy ? "..." : "Speichern" }}
                </button>
              </div>
            </div>
          </section>
        </template>

        <!-- ── Vorlagen (Phase 6c) ────────────────────────────────────── -->
        <template v-if="activeSection === 'vorlagen'">
          <section>
            <h3 class="settings-h3 mb-3">Vorlagen</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Markdown-Vorlagen mit Platzhaltern wie
              <code class="font-mono">&#123;&#123;Projekt&#125;&#125;</code>,
              <code class="font-mono">&#123;&#123;Bauherr&#125;&#125;</code>,
              <code class="font-mono">&#123;&#123;Datum&#125;&#125;</code>. Beim Anlegen einer Notiz oder eines Meetings
              wird die gewählte Vorlage mit Live-Daten gerendert.
            </p>

            <!-- Kind-Tabs -->
            <div class="flex" style="gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--color-border)">
              <button
                v-for="k in TEMPLATE_KINDS"
                :key="k.id"
                :class="['tpl-kind-tab', templateKindFilter === k.id ? 'tpl-kind-tab-active' : '']"
                @click="templateKindFilter = k.id"
              >
                {{ k.label }}
              </button>
            </div>

            <div class="tpl-grid">
              <!-- Liste links -->
              <div class="tpl-list">
                <button @click="startNewTemplate" class="tpl-list-item tpl-new-btn">
                  <span class="font-mono">+</span> Neue Vorlage
                </button>
                <button
                  v-for="t in templatesByKind"
                  :key="t.id"
                  @click="startEditTemplate(t)"
                  :class="['tpl-list-item', templateEditing?.id === t.id ? 'tpl-list-item-active' : '']"
                >
                  <div class="flex items-center" style="gap: 6px">
                    <span style="font-weight: 500; flex: 1">{{ t.name }}</span>
                    <span v-if="t.isDefault" class="tpl-default-pill" title="Standard-Vorlage fuer diese Kategorie"
                      >Standard</span
                    >
                    <button
                      @click.stop="removeTemplate(t)"
                      :disabled="templateBusy"
                      class="tpl-delete-btn"
                      title="Vorlage löschen"
                    >
                      ×
                    </button>
                  </div>
                  <div v-if="t.description" class="text-xs" style="color: var(--color-text-tertiary); margin-top: 2px">
                    {{ t.description }}
                  </div>
                </button>
                <div
                  v-if="templatesByKind.length === 0"
                  class="text-xs"
                  style="color: var(--color-text-tertiary); padding: 12px; text-align: center"
                >
                  Keine Vorlagen — leg eine neue an.
                </div>
              </div>

              <!-- Editor rechts -->
              <div class="tpl-editor">
                <div class="tpl-editor-row">
                  <input
                    v-model="templateDraft.name"
                    placeholder="Name der Vorlage"
                    class="settings-input flex-1 px-3 py-1.5 rounded text-sm outline-none"
                    style="font-weight: 500"
                  />
                  <select
                    v-if="!templateEditing"
                    v-model="templateDraft.kind"
                    class="settings-input px-3 py-1.5 rounded text-sm outline-none"
                  >
                    <option value="meeting">Meeting</option>
                    <option value="note">Notiz</option>
                    <option value="bautagebuch">Bautagebuch</option>
                  </select>
                </div>
                <input
                  v-model="templateDraft.description"
                  placeholder="Kurzbeschreibung (optional)"
                  class="settings-input w-full px-3 py-1.5 rounded text-sm outline-none"
                  style="margin-top: 8px"
                />

                <div class="tpl-body-grid">
                  <div class="tpl-body-col">
                    <div class="eyebrow" style="margin-bottom: 6px">Markdown-Body</div>
                    <textarea
                      v-model="templateDraft.body"
                      rows="22"
                      placeholder="Body mit &#123;&#123;Platzhaltern&#125;&#125;…"
                      class="settings-input w-full px-3 py-2 rounded text-sm outline-none font-mono"
                      style="resize: vertical; font-family: ui-monospace, SFMono-Regular, monospace"
                    ></textarea>
                  </div>
                  <div class="tpl-body-col">
                    <div class="eyebrow" style="margin-bottom: 6px">
                      Vorschau
                      <span style="color: var(--color-text-tertiary); font-weight: normal">
                        (Platzhalter ersetzt)
                      </span>
                    </div>
                    <pre class="tpl-preview" style="white-space: pre-wrap; word-break: break-word">{{
                      templatePreview || templateDraft.body || "(leer)"
                    }}</pre>
                  </div>
                </div>

                <details class="tpl-vars-help">
                  <summary>Verfügbare Platzhalter</summary>
                  <div class="tpl-vars-grid">
                    <div v-for="v in templateVariables" :key="v.name" class="tpl-var-item">
                      <code class="font-mono" v-text="placeholderRef(v.name)"></code>
                      <span style="color: var(--color-text-tertiary)">— {{ v.description }}</span>
                    </div>
                  </div>
                </details>

                <div class="flex items-center justify-between" style="margin-top: 12px">
                  <label class="flex items-center" style="gap: 6px; cursor: pointer">
                    <input type="checkbox" v-model="templateDraft.isDefault" />
                    <span class="text-xs">Als Standard für {{ templateDraft.kind }} setzen</span>
                  </label>
                  <div class="flex" style="gap: 8px">
                    <button
                      v-if="templateEditing"
                      @click="removeTemplate(templateEditing)"
                      :disabled="templateBusy"
                      class="text-sm px-3 py-1.5 rounded"
                      style="background: transparent; border: 1px solid #dc2626; color: #dc2626; cursor: pointer"
                    >
                      Löschen
                    </button>
                    <button
                      v-if="templateEditing && !templateEditing.isDefault"
                      @click="setTemplateDefault(templateEditing)"
                      :disabled="templateBusy"
                      class="text-sm px-3 py-1.5 rounded settings-ghost-btn"
                    >
                      Als Standard
                    </button>
                    <button
                      @click="cancelTemplate"
                      :disabled="templateBusy"
                      class="text-sm px-3 py-1.5 rounded settings-ghost-btn"
                    >
                      Abbrechen
                    </button>
                    <button
                      @click="saveTemplate"
                      :disabled="templateBusy || !templateDraft.name.trim()"
                      class="primary-btn text-sm px-4 py-1.5 rounded font-medium"
                      :style="{ opacity: templateBusy || !templateDraft.name.trim() ? 0.5 : 1 }"
                    >
                      {{ templateBusy ? "..." : templateEditing ? "Speichern" : "Anlegen" }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- ── Eigene Platzhalter ─────────────────────────── -->
            <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--color-border)">
              <h4 class="settings-h3" style="font-size: 13px; margin-bottom: 4px">Eigene Platzhalter</h4>
              <p class="text-xs" style="color: var(--color-text-muted); margin: 0 0 12px">
                Definiere eigene <code class="font-mono">&#123;&#123;Platzhalter&#125;&#125;</code> mit einem festen
                Wert — z.B. <code class="font-mono">&#123;&#123;Bauleiter&#125;&#125;</code> → "Max Muster". Diese Werte
                werden beim Rendern einer Vorlage eingesetzt.
              </p>

              <!-- Bestehende custom vars -->
              <div v-if="customVars.length > 0" class="settings-card settings-divide" style="margin-bottom: 12px">
                <div v-for="cv in customVars" :key="cv.id" class="settings-row flex items-center gap-2 px-4 py-2.5">
                  <code class="font-mono text-xs" style="min-width: 120px; color: var(--color-text)">
                    {{ placeholderRef(cv.name) }}
                  </code>
                  <span class="flex-1 text-sm" style="color: var(--color-text-secondary)">{{ cv.value || "—" }}</span>
                  <span v-if="cv.description" class="text-xs" style="color: var(--color-text-tertiary)">{{
                    cv.description
                  }}</span>
                  <button
                    @click="startEditCustomVar(cv)"
                    class="text-xs px-2 py-1 rounded settings-ghost-btn"
                    :disabled="customVarsBusy"
                  >
                    Bearbeiten
                  </button>
                  <button
                    @click="deleteCustomVar(cv)"
                    class="text-xs px-2 py-1 rounded"
                    style="background: transparent; border: 1px solid #dc2626; color: #dc2626; cursor: pointer"
                    :disabled="customVarsBusy"
                  >
                    ×
                  </button>
                </div>
              </div>

              <!-- Form zum Anlegen / Bearbeiten -->
              <div class="settings-card" style="padding: 14px 16px">
                <div style="font-size: 12px; font-weight: 600; margin-bottom: 10px; color: var(--color-text-secondary)">
                  {{ customVarEditing ? "Platzhalter bearbeiten" : "Neuer Platzhalter" }}
                </div>
                <div class="flex" style="gap: 8px; flex-wrap: wrap">
                  <input
                    v-model="customVarDraft.name"
                    placeholder="Name (z.B. Bauleiter)"
                    class="settings-input px-3 py-1.5 rounded text-sm outline-none"
                    style="flex: 1; min-width: 120px"
                    :title="'Wird zu ' + placeholderRef(customVarDraft.name || '...')"
                  />
                  <input
                    v-model="customVarDraft.value"
                    placeholder="Wert (z.B. Max Muster)"
                    class="settings-input px-3 py-1.5 rounded text-sm outline-none"
                    style="flex: 1; min-width: 140px"
                  />
                  <input
                    v-model="customVarDraft.description"
                    placeholder="Beschreibung (optional)"
                    class="settings-input px-3 py-1.5 rounded text-sm outline-none"
                    style="flex: 1.5; min-width: 160px"
                  />
                </div>
                <div class="flex" style="gap: 8px; margin-top: 10px; justify-content: flex-end">
                  <button
                    v-if="customVarEditing"
                    @click="cancelCustomVar"
                    class="text-sm px-3 py-1.5 rounded settings-ghost-btn"
                    :disabled="customVarsBusy"
                  >
                    Abbrechen
                  </button>
                  <button
                    @click="saveCustomVar"
                    :disabled="customVarsBusy || !customVarDraft.name.trim()"
                    class="primary-btn text-sm px-4 py-1.5 rounded font-medium"
                    :style="{ opacity: customVarsBusy || !customVarDraft.name.trim() ? 0.5 : 1 }"
                  >
                    {{ customVarsBusy ? "..." : customVarEditing ? "Speichern" : "Anlegen" }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </template>

        <!-- ── Word-Export (Phase 6d) ─────────────────────────────────── -->
        <template v-if="activeSection === 'word-export'">
          <section>
            <h3 class="settings-h3 mb-3">Word-Export-Vorlagen</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Lade Word-Dokumente (.docx) als Layout-Template hoch. Im Word-File verwendest du Tags wie
              <code class="font-mono">{Datum}</code>, <code class="font-mono">{Projekt}</code>,
              <code class="font-mono">{Meeting.Titel}</code> oder Loops:
              <code class="font-mono">{#Teilnehmer}{Name}{/Teilnehmer}</code>. Beim Export werden die Tags durch
              Live-Daten ersetzt.
            </p>

            <div class="flex" style="gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--color-border)">
              <button
                v-for="k in EXPORT_KINDS"
                :key="k.id"
                :class="['tpl-kind-tab', exportKindFilter === k.id ? 'tpl-kind-tab-active' : '']"
                @click="exportKindFilter = k.id"
              >
                {{ k.label }}
              </button>
            </div>

            <div class="settings-card p-4" style="margin-bottom: 12px">
              <div class="flex items-center" style="gap: 12px; flex-wrap: wrap">
                <input
                  type="file"
                  accept=".docx"
                  :disabled="exportBusy"
                  @change="uploadExportTemplate"
                  style="font-size: 13px"
                />
                <span class="text-xs" style="color: var(--color-text-tertiary)">
                  Max 10 MB. Erste Vorlage wird automatisch Standard.
                </span>
              </div>
            </div>

            <div class="settings-card settings-divide">
              <div
                v-for="t in exportTemplatesByKind"
                :key="t.id"
                class="settings-row flex items-center"
                style="gap: 12px; padding: 12px 14px"
              >
                <div style="flex: 1; min-width: 0">
                  <div class="flex items-center" style="gap: 8px; flex-wrap: wrap">
                    <span style="font-size: 13px; font-weight: 500">{{ t.name }}</span>
                    <span v-if="t.isDefault" class="tpl-default-pill">Standard</span>
                  </div>
                  <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 2px">
                    {{ t.filename }} · {{ formatBytes(t.sizeBytes) }} · hochgeladen am
                    {{ new Date(t.uploadedAt).toLocaleDateString("de-AT") }}
                  </div>
                </div>
                <div class="flex items-center" style="gap: 6px; flex-wrap: wrap">
                  <button
                    @click="testRenderExportTemplate(t)"
                    :disabled="exportBusy"
                    class="text-xs settings-ghost-btn px-2 py-1 rounded"
                    title="Mit Dummy-Daten rendern und herunterladen"
                  >
                    Test
                  </button>
                  <button
                    @click="downloadExportOriginal(t)"
                    :disabled="exportBusy"
                    class="text-xs settings-ghost-btn px-2 py-1 rounded"
                    title="Original-Vorlage herunterladen"
                  >
                    Download
                  </button>
                  <button
                    v-if="!t.isDefault"
                    @click="setExportTemplateDefault(t)"
                    :disabled="exportBusy"
                    class="text-xs settings-ghost-btn px-2 py-1 rounded"
                  >
                    Als Standard
                  </button>
                  <button
                    @click="removeExportTemplate(t)"
                    :disabled="exportBusy"
                    class="text-xs px-2 py-1 rounded"
                    style="background: transparent; border: 1px solid #dc2626; color: #dc2626; cursor: pointer"
                  >
                    Löschen
                  </button>
                </div>
              </div>
              <div
                v-if="exportTemplatesByKind.length === 0"
                class="text-xs"
                style="color: var(--color-text-tertiary); padding: 24px; text-align: center"
              >
                Keine Vorlagen für diese Kategorie. Lade ein .docx hoch.
              </div>
            </div>

            <details class="tpl-vars-help" style="margin-top: 12px">
              <summary>Verfügbare Tags für diese Kategorie</summary>
              <div class="tpl-vars-grid">
                <div v-for="v in exportVariables" :key="v.tag" class="tpl-var-item">
                  <code class="font-mono">{{ v.tag }}</code>
                  <span style="color: var(--color-text-tertiary)">— {{ v.description }}</span>
                </div>
              </div>
            </details>
          </section>
        </template>

        <!-- ── Projekt-Module (Phase 6e) ──────────────────────────────── -->
        <template v-if="activeSection === 'projekt-module'">
          <section>
            <h3 class="settings-h3 mb-3">Projekt-Module</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Welche Bereiche stehen in Projekten zur Verfügung? Diese globalen Defaults gelten für alle Projekte —
              einzelne Projekte können davon abweichen (Override im Projekt-Detail).
            </p>
            <div class="settings-card settings-divide" v-if="projectModules">
              <label
                v-for="m in PROJECT_MODULES"
                :key="m.key"
                class="settings-row flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
              >
                <div style="flex: 1; min-width: 0">
                  <div style="font-size: 13px; font-weight: 500; color: var(--color-text)">{{ m.label }}</div>
                  <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 2px">{{ m.help }}</div>
                </div>
                <input
                  type="checkbox"
                  :checked="projectModules[m.key]"
                  :disabled="projectModulesBusy"
                  @change="toggleProjectModule(m.key, ($event.target as HTMLInputElement).checked)"
                />
              </label>
            </div>
            <div v-else class="text-xs" style="color: var(--color-text-tertiary); padding: 12px">
              Lade Module-Konfiguration…
            </div>
            <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 12px">
              <strong style="color: var(--color-text-secondary)">Tipp:</strong>
              Im Projekt-Detail oben rechts kannst du diese Defaults pro Projekt überschreiben — z.B. bei reinen
              Planungs-Projekten ohne Baustelle das Bautagebuch ausblenden.
            </div>

            <!-- ── Eigene Module anlegen ─────────────────────────── -->
            <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--color-border)">
              <h4 class="settings-h3" style="font-size: 13px; margin-bottom: 4px">Eigene Module</h4>
              <p class="text-xs" style="color: var(--color-text-muted); margin: 0 0 12px">
                Definiere eigene Projektkategorien — z.B. "Gewährleistung", "Mängelverfolgung". Eigene Module erscheinen
                zusätzlich zu den Standard-Modulen und können pro Projekt aktiviert/deaktiviert werden.
              </p>

              <!-- Liste bestehender custom modules -->
              <div v-if="customModules.length > 0" class="settings-card settings-divide" style="margin-bottom: 12px">
                <div v-for="m in customModules" :key="m.id" class="settings-row flex items-center gap-3 px-4 py-2.5">
                  <div style="flex: 1; min-width: 0">
                    <div style="font-size: 13px; font-weight: 500; color: var(--color-text)">{{ m.label }}</div>
                    <div class="text-xs font-mono" style="color: var(--color-text-tertiary)">Key: {{ m.key }}</div>
                    <div v-if="m.description" class="text-xs" style="color: var(--color-text-tertiary)">
                      {{ m.description }}
                    </div>
                  </div>
                  <span
                    class="text-xs px-2 py-0.5 rounded"
                    :style="{
                      background: m.enabledByDefault ? 'var(--color-bg-subtle)' : 'transparent',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-tertiary)',
                    }"
                    >{{ m.enabledByDefault ? "Standard: An" : "Standard: Aus" }}</span
                  >
                  <button
                    @click="deleteCustomModule(m)"
                    class="text-xs px-2 py-1 rounded"
                    style="
                      background: transparent;
                      border: 1px solid #dc2626;
                      color: #dc2626;
                      cursor: pointer;
                      flex-shrink: 0;
                    "
                    :disabled="customModulesBusy"
                    title="Modul löschen"
                  >
                    Löschen
                  </button>
                </div>
              </div>
              <div v-else class="text-xs" style="color: var(--color-text-tertiary); margin-bottom: 12px">
                Noch keine eigenen Module angelegt.
              </div>

              <!-- Formular neues Modul -->
              <div class="settings-card" style="padding: 14px 16px">
                <div style="font-size: 12px; font-weight: 600; margin-bottom: 10px; color: var(--color-text-secondary)">
                  Neues Modul anlegen
                </div>
                <div class="flex" style="gap: 8px; flex-wrap: wrap">
                  <input
                    v-model="customModuleDraft.label"
                    placeholder="Bezeichnung (z.B. Gewährleistung)"
                    class="settings-input px-3 py-1.5 rounded text-sm outline-none"
                    style="flex: 1.5; min-width: 160px"
                  />
                  <input
                    v-model="customModuleDraft.key"
                    placeholder="Schlüssel (z.B. gewaehrleistung)"
                    class="settings-input px-3 py-1.5 rounded text-sm outline-none font-mono"
                    style="flex: 1; min-width: 140px"
                  />
                  <input
                    v-model="customModuleDraft.description"
                    placeholder="Beschreibung (optional)"
                    class="settings-input px-3 py-1.5 rounded text-sm outline-none"
                    style="flex: 1.5; min-width: 160px"
                  />
                </div>
                <div class="flex items-center justify-between" style="margin-top: 10px">
                  <label class="flex items-center" style="gap: 6px; cursor: pointer; font-size: 12px">
                    <input type="checkbox" v-model="customModuleDraft.enabledByDefault" />
                    <span>Standardmäßig aktiv</span>
                  </label>
                  <button
                    @click="saveCustomModule"
                    :disabled="customModulesBusy || !customModuleDraft.label.trim() || !customModuleDraft.key.trim()"
                    class="primary-btn text-sm px-4 py-1.5 rounded font-medium"
                    :style="{ opacity: customModulesBusy || !customModuleDraft.label.trim() ? 0.5 : 1 }"
                  >
                    {{ customModulesBusy ? "..." : "Modul anlegen" }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </template>

        <!-- ── System-Info ───────────────────────────────────────────── -->
        <template v-if="activeSection === 'system'">
          <section>
            <h3 class="settings-h3 mb-3">System</h3>
            <div class="settings-card settings-divide text-sm">
              <div class="settings-row flex items-center justify-between px-4 py-2.5">
                <span class="settings-label">Datenbank</span>
                <span
                  :style="{
                    color: data.runtime.dbEnabled ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
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
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.primary-btn {
  background: var(--accent, var(--color-primary));
  color: var(--accent-fg, var(--color-bg));
  border: 1px solid var(--accent, var(--color-primary));
  border-radius: var(--radius-lg, 8px);
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
  font-weight: var(--fw-medium, 500);
  transition:
    background-color var(--t-fast, 120ms) var(--ease, ease),
    opacity var(--t-fast, 120ms) var(--ease, ease);
}
.primary-btn:hover:not(:disabled) {
  background: var(--accent-hover, var(--color-primary));
}
.primary-btn:disabled {
  cursor: not-allowed;
}

.settings-h3 {
  font-family: var(--font-display, "Inter Tight", "Inter", sans-serif);
  font-size: var(--fs-13, 13px);
  font-weight: var(--fw-semibold, 600);
  letter-spacing: var(--tracking-tight, -0.015em);
  color: var(--fg, var(--color-text));
}

.settings-card {
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-lg, 8px);
  background: var(--surface, var(--color-bg));
}

.settings-divide > .settings-row + .settings-row,
.settings-divide > label.settings-row + .settings-row,
.settings-divide > .settings-row + label.settings-row,
.settings-divide > label.settings-row + label.settings-row {
  border-top: 1px solid var(--hairline, var(--color-border-subtle));
}

.settings-label {
  color: var(--fg-muted, var(--color-text-muted));
}
.settings-value {
  color: var(--fg-body, var(--color-text));
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
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-md, 6px);
  background: var(--surface, var(--color-bg));
  color: var(--fg-body, var(--color-text));
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
  transition:
    border-color var(--t-fast, 120ms) var(--ease, ease),
    box-shadow var(--t-fast, 120ms) var(--ease, ease);
}
.settings-input:focus {
  border-color: var(--fg, var(--color-text-faint));
  box-shadow: var(--shadow-focus, 0 0 0 2px rgba(10, 10, 10, 0.1));
}

.settings-ghost-btn {
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-md, 6px);
  background: var(--surface, var(--color-bg));
  color: var(--fg-body, var(--color-text-secondary));
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
  font-weight: var(--fw-medium, 500);
  cursor: pointer;
  transition:
    background-color var(--t-fast, 120ms) var(--ease, ease),
    color var(--t-fast, 120ms) var(--ease, ease);
}
.settings-ghost-btn:hover:not(:disabled) {
  background: var(--surface-subtle, var(--color-bg-subtle));
  color: var(--fg, var(--color-text));
}

.settings-chip {
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-md, 6px);
  background: var(--surface, var(--color-bg));
  color: var(--fg-muted, var(--color-text-secondary));
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
  cursor: pointer;
  transition:
    background-color var(--t-fast, 120ms) var(--ease, ease),
    border-color var(--t-fast, 120ms) var(--ease, ease),
    color var(--t-fast, 120ms) var(--ease, ease);
}
.settings-chip:hover {
  background: var(--surface-subtle, var(--color-bg-subtle));
  color: var(--fg, var(--color-text));
}
.settings-chip-active {
  border-color: var(--accent, var(--color-primary));
  background: var(--accent, var(--color-primary));
  color: var(--accent-fg, var(--color-bg));
}
.settings-chip-active:hover {
  background: var(--accent-hover, var(--color-primary));
  color: var(--accent-fg, var(--color-bg));
  opacity: 1;
}

.settings-checkbox {
  accent-color: var(--accent, var(--color-primary));
}

.settings-flash {
  border: 1px solid;
}
.settings-flash {
  border-radius: var(--radius-md, 6px);
}
.settings-flash-ok {
  border-color: var(--border, var(--color-border));
  background: var(--surface-subtle, var(--color-bg-subtle));
  color: var(--fg-body, var(--color-text-secondary));
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

/* ── Sidebar-Layout (Phase 6a) ─────────────────────────────────────── */
.settings-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100%;
  color: var(--fg-body, var(--color-text));
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
}
.settings-sidebar {
  border-right: 1px solid var(--border, var(--color-border));
  background: var(--surface-subtle, var(--color-bg-subtle));
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  overflow-y: auto;
}
.settings-content {
  padding: 28px 32px 48px;
  max-width: 720px;
}
.settings-content-wide {
  max-width: none;
  padding: 28px 40px 48px;
}
.settings-section-wrap > * + * {
  margin-top: 32px;
}

.settings-nav {
  display: flex;
  flex-direction: column;
  padding: 0 12px 24px;
}
.settings-nav-group {
  display: flex;
  flex-direction: column;
  margin-top: 16px;
}
.settings-nav-group-title {
  font-size: var(--fs-11, 10px);
  text-transform: uppercase;
  letter-spacing: var(--tracking-label, 0.08em);
  color: var(--fg-subtle, var(--color-text-tertiary));
  font-weight: var(--fw-semibold, 600);
  padding: 0 8px 6px;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-md, 6px);
  border-left: 2px solid transparent;
  font-size: var(--fs-13, 13px);
  font-weight: var(--fw-medium, 500);
  color: var(--fg-muted, var(--color-text-secondary));
  background: transparent;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  cursor: pointer;
  text-align: left;
  transition:
    background-color var(--t-fast, 120ms) var(--ease, ease),
    color var(--t-fast, 120ms) var(--ease, ease);
}
.settings-nav-item:hover {
  background: var(--surface-muted, var(--color-border-subtle));
  color: var(--fg-body, var(--color-text));
}
.settings-nav-item-active {
  background: var(--surface, var(--color-bg));
  color: var(--fg, var(--color-text));
  font-weight: var(--fw-semibold, 600);
  border-left-color: var(--fg, var(--color-primary));
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(10, 10, 10, 0.04));
}
.settings-nav-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full, 50%);
  background: var(--fg-subtle, var(--color-text-faint));
  flex-shrink: 0;
}
.settings-nav-item-active .settings-nav-dot {
  background: var(--accent, var(--color-primary, #111827));
}

/* Mobile: Sidebar wird zur Top-Bar (horizontale Tabs). */
@media (max-width: 767.98px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
  .settings-sidebar {
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }
  .settings-nav {
    flex-direction: row;
    flex-wrap: wrap;
    overflow-x: auto;
    padding: 0 12px 12px;
  }
  .settings-nav-group {
    margin-top: 0;
  }
  .settings-nav-group-title {
    display: none;
  }
  .settings-content {
    padding: 20px 16px 40px;
  }
}

/* ── Theme-Tiles (Phase 6f) ────────────────────────────────────────── */
.theme-tile-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.theme-tile {
  background: var(--surface, var(--color-bg));
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-xl, 10px);
  padding: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 200ms var(--ease, ease);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.theme-tile:hover {
  border-color: var(--fg-subtle, var(--color-text-faint));
  transform: translateY(-1px);
}
.theme-tile-active {
  border-color: var(--accent, var(--color-primary));
  box-shadow: 0 0 0 2px var(--accent, var(--color-primary));
}
.theme-tile-preview {
  height: 80px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  position: relative;
  overflow: hidden;
}
.theme-tile-preview-light {
  background: #ffffff;
}
.theme-tile-preview-dark {
  background: #0f0f11;
}
.theme-tile-preview-system {
  background: linear-gradient(135deg, #ffffff 50%, #0f0f11 50%);
}
.theme-tile-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 12px;
  background: rgba(0, 0, 0, 0.06);
}
.theme-tile-preview-dark .theme-tile-bar {
  background: rgba(255, 255, 255, 0.08);
}
.theme-tile-content {
  position: absolute;
  top: 20px;
  left: 8px;
  width: 60%;
  height: 4px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 2px;
  box-shadow:
    0 8px rgba(0, 0, 0, 0.15),
    0 16px rgba(0, 0, 0, 0.12),
    -10px 24px 0 -10px rgba(0, 0, 0, 0.08);
}
.theme-tile-preview-dark .theme-tile-content {
  background: rgba(255, 255, 255, 0.3);
  box-shadow:
    0 8px rgba(255, 255, 255, 0.2),
    0 16px rgba(255, 255, 255, 0.15),
    -10px 24px 0 -10px rgba(255, 255, 255, 0.1);
}
.theme-tile-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.theme-tile-desc {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

@media (max-width: 600px) {
  .theme-tile-grid {
    grid-template-columns: 1fr;
  }
}

/* ── Vorlagen-Editor (Phase 6c) ────────────────────────────────────── */
.tpl-kind-tab {
  background: transparent;
  border: 0;
  padding: 8px 14px;
  font-size: var(--fs-13, 13px);
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
  color: var(--fg-muted, var(--color-text-muted));
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--t-fast, 120ms) var(--ease, ease);
}
.tpl-kind-tab:hover {
  color: var(--fg, var(--color-text));
}
.tpl-kind-tab-active {
  color: var(--fg, var(--color-text));
  font-weight: var(--fw-medium, 500);
  border-bottom-color: var(--fg, var(--color-text));
}

.tpl-grid {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  align-items: start;
}
.tpl-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-lg, 8px);
  padding: 6px;
  background: var(--surface, var(--color-bg));
}
.tpl-list-item {
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius-md, 6px);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: var(--fs-13, 13px);
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
  color: var(--fg-body, var(--color-text));
  transition: background-color var(--t-fast, 120ms) var(--ease, ease);
}
.tpl-list-item:hover {
  background: var(--surface-subtle, var(--color-bg-subtle));
}
.tpl-list-item-active {
  background: var(--surface-muted, var(--color-border-subtle));
}
.tpl-new-btn {
  color: var(--fg-muted, var(--color-text-muted));
  font-style: italic;
  border-bottom: 1px dashed var(--hairline, var(--color-border-subtle));
  border-radius: 0;
  padding-bottom: 8px;
  margin-bottom: 4px;
}
.tpl-delete-btn {
  display: none;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tpl-list-item:hover .tpl-delete-btn {
  display: inline-flex;
}
.tpl-delete-btn:hover {
  background: #fee2e2;
  color: #dc2626;
}
.tpl-default-pill {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide, 0.05em);
  padding: 2px 6px;
  border-radius: var(--radius-xs, 3px);
  background: var(--accent, var(--color-text));
  color: var(--accent-fg, var(--color-bg));
  font-weight: var(--fw-semibold, 600);
}

.tpl-editor {
  background: var(--surface, var(--color-bg));
  border: 1px solid var(--border, var(--color-border));
  border-radius: var(--radius-lg, 8px);
  padding: 14px;
}
.tpl-editor-row {
  display: flex;
  gap: 8px;
}
.tpl-body-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 10px;
}
.tpl-body-col {
  display: flex;
  flex-direction: column;
}
.tpl-preview {
  flex: 1;
  border: 1px solid var(--hairline, var(--color-border-subtle));
  border-radius: var(--radius-md, 6px);
  padding: 12px;
  background: var(--surface-subtle, var(--color-bg-subtle));
  font-size: var(--fs-13, 13px);
  color: var(--fg-body, var(--color-text));
  min-height: 440px;
  max-height: 560px;
  overflow-y: auto;
  margin: 0;
  font-family: inherit;
}
.tpl-vars-help {
  margin-top: 12px;
  padding: 10px;
  background: var(--surface-subtle, var(--color-bg-subtle));
  border: 1px solid var(--hairline, var(--color-border-subtle));
  border-radius: var(--radius-md, 6px);
  font-size: var(--fs-12, 12px);
}
.tpl-vars-help summary {
  cursor: pointer;
  font-weight: var(--fw-medium, 500);
  color: var(--fg-body, var(--color-text-secondary));
}
.tpl-vars-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  margin-top: 8px;
}
.tpl-var-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
}

@media (max-width: 900px) {
  .tpl-grid {
    grid-template-columns: 1fr;
  }
  .tpl-body-grid {
    grid-template-columns: 1fr;
  }
}
</style>
