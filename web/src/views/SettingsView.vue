<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
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

async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    flash("error", "Logo zu groß (max 2 MB)");
    input.value = "";
    return;
  }
  brandingBusy.value = true;
  try {
    const fd = new FormData();
    fd.append("logo", file);
    const res = await fetch("/api/branding/logo", {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("bau-os-token") ?? ""}` },
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
    input.value = "";
  }
}

async function removeLogo() {
  if (!confirm("Logo wirklich entfernen?")) return;
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

const SECTION_KEY = "bau-os-settings-section";
const activeSection = ref<SettingsSection>(
  ((): SettingsSection => {
    const stored = localStorage.getItem(SECTION_KEY) as SettingsSection | null;
    if (stored && SETTINGS_NAV.some((n) => n.id === stored)) return stored;
    return "profil";
  })(),
);

watch(activeSection, (v) => localStorage.setItem(SECTION_KEY, v));

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
});
</script>

<template>
  <div class="settings-layout">
    <!-- Sidebar-Navigation (Phase 6a) — links, scrollt unabhaengig vom Content -->
    <aside class="settings-sidebar">
      <div style="padding: 24px 20px 12px">
        <div class="eyebrow" style="margin-bottom: 6px">System</div>
        <h1
          style="
            font-size: 18px;
            font-weight: 600;
            margin: 0;
            letter-spacing: -0.01em;
          "
        >
          Einstellungen
        </h1>
      </div>
      <nav class="settings-nav">
        <div
          v-for="grp in settingsNavGroups"
          :key="grp.group"
          class="settings-nav-group"
        >
          <div class="settings-nav-group-title">{{ grp.group }}</div>
          <button
            v-for="item in grp.items"
            :key="item.id"
            type="button"
            :class="[
              'settings-nav-item',
              activeSection === item.id ? 'settings-nav-item-active' : '',
            ]"
            @click="activeSection = item.id"
          >
            <span class="settings-nav-dot" aria-hidden="true"></span>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </nav>
    </aside>

    <!-- Content-Pane: aktive Sektion -->
    <div class="settings-content">
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

      <div
        v-if="loading"
        class="text-sm py-8"
        style="color: var(--color-text-tertiary)"
      >
        Laedt...
      </div>

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
              :disabled="savingPassword || !oldPassword || !newPassword"
              class="primary-btn px-4 py-1.5 text-sm font-medium rounded transition"
              :style="{ opacity: (savingPassword || !oldPassword || !newPassword) ? 0.5 : 1 }"
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

          <!-- Multi-Calendar-Liste (Phase 5c).
               User waehlt aus seinen Outlook-Kalendern beliebig viele aus
               die mit Bau-OS gesyncet werden sollen. Pro aktiviertem
               Kalender legt das Backend eine eigene Webhook-Subscription
               an. Default-Push-Ziel fuer neue Bau-OS-Termine ist der
               Kalender mit Anzeigename "Bau-OS" (wird beim Connect
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
                  <div
                    class="text-xs"
                    style="color: var(--color-text-tertiary); margin-top: 2px"
                  >
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
              Aktivierte Kalender werden bidirektional mit Bau-OS synchronisiert.
              Neue Bau-OS-Termine landen im Kalender „Bau-OS" (oder im ersten
              aktivierten falls keiner so heißt).
            </div>
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

          <!-- Phase 4: Webhook-Status. Wenn aktiv, hat Bau-OS bei Microsoft
               eine Subscription registriert und bekommt Push-Notifications
               sobald sich was im Outlook-Calendar aendert (<1s Latenz).
               Wenn nicht aktiv, laeuft das 5-min-Polling als Fallback. -->
          <div
            v-if="msStatus.account?.syncEnabled"
            class="flex items-center"
            style="gap: 8px; padding: 8px 10px; border-radius: 6px; background: var(--color-bg-subtle); border: 1px solid var(--color-border-subtle)"
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
                <strong>Instant-Sync aktiv</strong> — Aenderungen in Outlook erscheinen sofort in Bau-OS.
              </span>
              <span v-else>
                <strong>Polling-Modus</strong> — Sync alle 5 Minuten. Webhook-Subscription wird beim naechsten Lauf eingerichtet.
              </span>
            </div>
          </div>

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
      </template>

      <!-- ── Praeferenzen ───────────────────────────────────────────── -->
      <template v-if="activeSection === 'praeferenzen'">
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
      </template>

      <!-- ── Branding (Phase 6b) ────────────────────────────────────── -->
      <template v-if="activeSection === 'branding'">
        <section>
          <h3 class="settings-h3 mb-3">Branding</h3>
          <p
            class="text-sm"
            style="color: var(--color-text-muted); margin: 0 0 16px"
          >
            Logo und Firmenstammdaten. Werden in Word-/PDF-Exports,
            Visitenkarten-Drucken und Email-Templates verwendet.
          </p>

          <!-- Logo-Upload + Vorschau -->
          <div class="settings-card p-5" style="margin-bottom: 16px">
            <div class="text-sm" style="font-weight: 600; margin-bottom: 12px">
              Logo
            </div>
            <div class="flex items-center" style="gap: 16px; flex-wrap: wrap">
              <div
                style="
                  width: 160px;
                  height: 100px;
                  border: 1px dashed var(--color-border);
                  border-radius: 8px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: var(--color-bg-subtle);
                  flex-shrink: 0;
                  overflow: hidden;
                "
              >
                <img
                  v-if="branding?.logoUrl"
                  :src="`${branding.logoUrl}?bust=${brandingLogoBust}`"
                  :alt="branding.companyName ?? 'Logo'"
                  style="max-width: 100%; max-height: 100%; object-fit: contain"
                />
                <span
                  v-else
                  class="text-xs"
                  style="color: var(--color-text-tertiary)"
                >
                  Kein Logo
                </span>
              </div>
              <div style="flex: 1; min-width: 200px">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  :disabled="brandingBusy"
                  @change="uploadLogo"
                  style="font-size: 13px"
                />
                <div
                  class="text-xs"
                  style="color: var(--color-text-tertiary); margin-top: 6px"
                >
                  PNG, JPEG, SVG oder WebP. Max 2 MB.
                  <span v-if="branding?.logoFilename"
                    >Aktuell: {{ branding.logoFilename }}</span
                  >
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
          <div class="settings-card p-6">
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Notiz- und Meeting-Vorlagen mit Platzhaltern wie
              <code class="font-mono">&#123;&#123;Projekt&#125;&#125;</code> oder
              <code class="font-mono">&#123;&#123;Datum&#125;&#125;</code>. Beim Anlegen einer
              neuen Notiz wird die ausgewählte Vorlage automatisch eingefügt.
            </p>
            <p class="text-xs" style="color: var(--color-text-tertiary)">
              ⚙ <em>In Vorbereitung</em> — kommt mit dem nächsten Deploy.
            </p>
          </div>
        </section>
      </template>

      <!-- ── Word-Export (Phase 6d) ─────────────────────────────────── -->
      <template v-if="activeSection === 'word-export'">
        <section>
          <h3 class="settings-h3 mb-3">Word-Export</h3>
          <div class="settings-card p-6">
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Lade Word-Dokumente (.docx) als Layout-Template hoch. Beim Export
              eines Meetings, Bautagebuch-Eintrags oder Stundenzettels werden die
              Daten in dein Layout eingefügt.
            </p>
            <p class="text-xs" style="color: var(--color-text-tertiary)">
              ⚙ <em>In Vorbereitung</em> — kommt mit dem nächsten Deploy.
            </p>
          </div>
        </section>
      </template>

      <!-- ── Projekt-Module (Phase 6e) ──────────────────────────────── -->
      <template v-if="activeSection === 'projekt-module'">
        <section>
          <h3 class="settings-h3 mb-3">Projekt-Module</h3>
          <div class="settings-card p-6">
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Welche Bereiche sollen in Projekten verfügbar sein? Hier
              aktivierst/deaktivierst du Notizen, Aufgaben, Termine,
              Bautagebuch, Meetings, Stundenerfassung etc.
            </p>
            <p class="text-xs" style="color: var(--color-text-tertiary)">
              ⚙ <em>In Vorbereitung</em> — kommt mit dem nächsten Deploy.
            </p>
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
      </template>
    </div>
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

/* ── Sidebar-Layout (Phase 6a) ─────────────────────────────────────── */
.settings-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100%;
  color: var(--color-text);
}
.settings-sidebar {
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
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
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  font-weight: 600;
  padding: 0 8px 6px;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}
.settings-nav-item:hover {
  background: var(--color-border-subtle);
  color: var(--color-text);
}
.settings-nav-item-active {
  background: var(--color-bg);
  color: var(--color-text);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.settings-nav-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-faint);
  flex-shrink: 0;
}
.settings-nav-item-active .settings-nav-dot {
  background: var(--color-primary, #111827);
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
</style>
