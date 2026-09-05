<script setup lang="ts">
import { formatDate } from "../utils/format";
import { ref, onMounted, computed, watch } from "vue";
import { api, ApiError } from "../api";
import { useConfirm } from "../composables/useConfirm";
import { PASSWORD_MIN_LENGTH } from "../constants";
import { useRoute, useRouter } from "vue-router";
import { SETTINGS_NAV, bereichNachRechten, sichtbareSektionen, type SettingsSection } from "./settings-nav";

const route = useRoute();
const router = useRouter();

const { confirm } = useConfirm();

// Nur die Werte, die die Oberflaeche auch anbietet. Die frueheren Felder
// notificationsEnabled und chatSearchMode hatten keine Bedienelemente mehr
// (Benachrichtigungen und Chat sind entfallen) — sie wurden nur noch
// geladen und unveraendert zurueckgeschrieben.
interface SettingsState {
  displayName?: string;
  defaultProject?: string | null;
}

interface SettingsResponse {
  profile: { username: string; role: string; createdAt: string; email?: string | null };
  settings: SettingsState;
  runtime: { dbEnabled: boolean };
  system: {
    language: string;
    locale: string;
    timezone: string;
  };
}

const data = ref<SettingsResponse | null>(null);
const loading = ref(true);
const savingSettings = ref(false);
const savingPassword = ref(false);
const message = ref<{ type: "success" | "error"; text: string } | null>(null);

const projects = ref<{ name: string }[]>([]);

// Formular-State
const displayName = ref("");
const defaultProject = ref<string | null>(null);

const oldPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");

const dirty = computed(() => {
  if (!data.value) return false;
  const s = data.value.settings;
  return (s.displayName ?? "") !== displayName.value || (s.defaultProject ?? null) !== defaultProject.value;
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
    defaultProject.value = res.settings.defaultProject ?? null;
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
        defaultProject: defaultProject.value,
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
  if (newPassword.value.length < PASSWORD_MIN_LENGTH) {
    flash("error", `Neues Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben`);
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

// ── Theme + UI-Praeferenzen (Phase 6f) ─────────────────────────────────────
import { useBranding } from "../composables/useBranding";
import { useTheme } from "../composables/useTheme";
import { useWorkspaceShell } from "../composables/useWorkspaceShell";
import BIcon from "../components/BIcon.vue";
import { useCurrentUser } from "../composables/useCurrentUser";

const themeApi = useTheme();
const shell = useWorkspaceShell();
const { reloadBranding } = useBranding();
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
  /** Welche Ereignisse eine Meldung auslösen (Migration 058). Hieß bis zur
   *  Umbenennung `telegramNotifications` — die Struktur stammt aus der
   *  Bot-Zeit, der Weg ist heute die Glocke im Programm. */
  benachrichtigungen: {
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

// Teil-Updates sind erlaubt — das Backend merged den Patch in den
// bestehenden Stand.
type PreferencesPatch = Partial<Omit<ServerPreferences, "benachrichtigungen">> & {
  // Teil-Patch: der Server merged die Benachrichtigungen tief, damit ein
  // einzelner Schalter genügt und die anderen nicht mitgeschickt werden müssen.
  benachrichtigungen?: Partial<ServerPreferences["benachrichtigungen"]>;
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
    // Die geteilte Quelle nachziehen, sonst zeigen Navigationsleiste und
    // Brotkrumen bis zum naechsten vollen Seitenaufbau den alten Firmennamen.
    await reloadBranding();
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

// ── KI-Freigabe ────────────────────────────────────────────────────────────
//
// Deny by default: kein Häkchen heisst nicht freigegeben, und der
// Hauptschalter steht anfangs aus. Ein neu angelegtes Projekt ist damit
// automatisch gesperrt.
const KI_KATEGORIEN = [
  { key: "stammdaten", label: "Stammdaten" },
  { key: "phasen", label: "Leistungsphasen" },
  { key: "aufgaben", label: "Aufgaben" },
  { key: "termine", label: "Termine" },
  { key: "notizen", label: "Notizen" },
  { key: "meetings", label: "Besprechungen" },
  { key: "bautagebuch", label: "Bautagebuch" },
  { key: "entscheidungen", label: "Entscheidungen" },
  { key: "rechnungen", label: "Rechnungen" },
  { key: "beteiligte", label: "Beteiligte" },
] as const;

interface KiFreigabe {
  aktiv: boolean;
  personendaten: "keine" | "namen-ohne-kontakt" | "alle";
  projekte: Record<string, string[]>;
}

const kiFreigabe = ref<KiFreigabe | null>(null);
const kiProjekte = ref<{ id: string; name: string; projektnummer: string | null }[]>([]);
const kiBusy = ref(false);
const kiVorschau = ref<{ projekt: string; text: string } | null>(null);

async function ladeKiFreigabe() {
  try {
    kiFreigabe.value = await api.get<KiFreigabe>("/ki/freigabe");
    kiProjekte.value = await api.get<{ id: string; name: string; projektnummer: string | null }[]>("/projects");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "KI-Freigabe nicht ladbar");
  }
}

async function kiKopf(patch: Partial<Pick<KiFreigabe, "aktiv" | "personendaten">>) {
  kiBusy.value = true;
  try {
    kiFreigabe.value = await api.patch<KiFreigabe>("/ki/freigabe", patch);
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    kiBusy.value = false;
  }
}

function kiHat(projectId: string, kategorie: string): boolean {
  return (kiFreigabe.value?.projekte[projectId] ?? []).includes(kategorie);
}

async function kiUmschalten(projectId: string, kategorie: string) {
  const jetzt = kiFreigabe.value?.projekte[projectId] ?? [];
  const neu = jetzt.includes(kategorie) ? jetzt.filter((k) => k !== kategorie) : [...jetzt, kategorie];
  kiBusy.value = true;
  try {
    kiFreigabe.value = await api.put<KiFreigabe>(`/ki/freigabe/${projectId}`, { kategorien: neu });
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Speichern fehlgeschlagen");
  } finally {
    kiBusy.value = false;
  }
}

/** Zeigt, was die KI von diesem Projekt tatsächlich zu sehen bekommt.
 *
 *  Das ist der eigentliche Zweck der Akte: nicht glauben, sondern nachlesen. */
async function kiVorschauZeigen(projectId: string, name: string) {
  try {
    const res = await fetch(`/api/ki/dossier/${projectId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("patio-token") ?? ""}` },
    });
    kiVorschau.value = {
      projekt: name,
      text: res.ok ? await res.text() : "Für dieses Projekt entsteht keine Akte (nicht freigegeben).",
    };
  } catch {
    kiVorschau.value = { projekt: name, text: "Die Vorschau ist nicht erreichbar." };
  }
}

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

// ── Warum ein Modul umbenennbar sein muss ────────────────────────────────
//
// Die PATCH-Route gibt es seit dem Bau des Moduls, sie war nur nie verdrahtet:
// anlegen und löschen ging, ändern nicht. Ein Tippfehler im Namen liess sich
// deshalb nur durch Löschen und Neuanlegen beheben — und dabei geht die
// Zuordnung ALLER Projekte verloren, weil der technische Schlüssel beim
// Neuanlegen aus dem Namen erzeugt wird. Ein „Bauleitng" hätte man also
// entweder stehen lassen oder teuer bezahlt.
const customModuleEdit = ref<{ id: string; label: string; description: string } | null>(null);

function startCustomModuleEdit(m: CustomProjectModule) {
  customModuleEdit.value = { id: m.id, label: m.label, description: m.description ?? "" };
}

async function saveCustomModuleEdit() {
  const entwurf = customModuleEdit.value;
  if (!entwurf || !entwurf.label.trim()) return;
  customModulesBusy.value = true;
  try {
    const aktualisiert = await api.patch<CustomProjectModule>(`/project-modules/custom/${entwurf.id}`, {
      label: entwurf.label.trim(),
      description: entwurf.description.trim() || null,
    });
    customModules.value = customModules.value.map((m) => (m.id === entwurf.id ? aktualisiert : m));
    customModuleEdit.value = null;
    flash("success", "Modul geändert");
  } catch (e) {
    flash("error", e instanceof Error ? e.message : "Ändern fehlgeschlagen");
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

const { isAdmin, darfGeld, geladen } = useCurrentUser();

const sichtbareNav = computed(() => sichtbareSektionen(isAdmin.value, darfGeld.value));

// ── Positionskatalog (Migration 046) ────────────────────────────────────────
// Wiederkehrende Leistungen, damit sie nicht bei jeder Rechnung neu getippt
// werden. Beim Uebernehmen in eine Rechnung wird KOPIERT, nicht referenziert:
// eine spaetere Preisanpassung darf gestellte Rechnungen nicht rueckwirkend
// aendern.
interface KatalogItem {
  id: string;
  text: string;
  einheit: string | null;
  einzelpreis: number;
  ustSatz: number;
  sortOrder: number;
  rev?: number;
}

const katalog = ref<KatalogItem[]>([]);
const katalogFehler = ref<string | null>(null);
const katalogEntwurf = ref({ text: "", einheit: "", einzelpreis: 0, ustSatz: 20 });

async function loadKatalog() {
  katalogFehler.value = null;
  try {
    katalog.value = await api.get<KatalogItem[]>("/positionskatalog");
  } catch (e) {
    // 403 ohne Geld-Recht ist der Normalfall — der Abschnitt ist dann gar
    // nicht sichtbar. Alles andere gehoert gemeldet.
    katalog.value = [];
    katalogFehler.value = e instanceof Error ? e.message : "Katalog konnte nicht geladen werden";
  }
}

async function katalogAnlegen() {
  if (!katalogEntwurf.value.text.trim()) return;
  katalogFehler.value = null;
  try {
    await api.post("/positionskatalog", {
      text: katalogEntwurf.value.text.trim(),
      einheit: katalogEntwurf.value.einheit.trim() || null,
      einzelpreis: Number(katalogEntwurf.value.einzelpreis) || 0,
      ustSatz: Number(katalogEntwurf.value.ustSatz) || 0,
    });
    katalogEntwurf.value = { text: "", einheit: "", einzelpreis: 0, ustSatz: 20 };
    await loadKatalog();
  } catch (e) {
    katalogFehler.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  }
}

async function katalogSpeichern(k: KatalogItem) {
  katalogFehler.value = null;
  try {
    await api.patch(`/positionskatalog/${k.id}`, {
      text: k.text.trim(),
      einheit: k.einheit?.trim() || null,
      einzelpreis: Number(k.einzelpreis) || 0,
      ustSatz: Number(k.ustSatz) || 0,
      rev: k.rev,
    });
    await loadKatalog();
  } catch (e) {
    katalogFehler.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
    // ── Nach einem Konflikt: NUR den Zähler nachziehen ─────────────────────
    //
    // ⚠ Hier ist `loadKatalog()` das Falsche, anders als bei den Phasen und
    // Rechnungen. Dort liegt der Entwurf in einem eigenen `ref`; hier werden
    // die Listenobjekte SELBST bearbeitet (`k.text`, `k.einzelpreis`), und
    // ein Neuladen ersetzt sie — die Eingabe des Nutzers wäre weg.
    //
    // Ohne irgendein Nachziehen war die Zeile dagegen festgefahren: Jeder
    // weitere Klick schickte denselben veralteten Zähler, und es gibt hier
    // kein Formular, das man schließen und neu öffnen könnte.
    //
    // Der Server schickt den aktuellen Stand im Konflikt bereits mit
    // (`aktuelleRev`) — genau dafür.
    if (e instanceof ApiError && e.istKonflikt && typeof e.aktuelleRev === "number") {
      k.rev = e.aktuelleRev;
      katalogFehler.value = `${e.message} Der Stand wurde nachgezogen — bitte prüfen und erneut speichern.`;
    }
  }
}

async function katalogLoeschen(k: KatalogItem) {
  if (!(await confirm(`„${k.text}" aus dem Katalog entfernen? Bestehende Rechnungen bleiben unberührt.`))) return;
  katalogFehler.value = null;
  try {
    await api.delete(`/positionskatalog/${k.id}`);
    await loadKatalog();
  } catch (e) {
    katalogFehler.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

// ── Der Bereich steht in der Adresse, nicht im localStorage ──────────────
//
// Vorher merkte sich der Browser den zuletzt geoeffneten Bereich lokal. Das
// hatte zwei Nachteile: ein Link auf „Einstellungen → Word-Export" liess sich
// nicht weitergeben (die Hilfe verweist auf Bereiche), und wer sich einen
// Rechner teilt, landete im Bereich des Vorgaengers.
//
// Jetzt traegt `?sektion=` den Zustand. Ein unbekannter oder unerlaubter Wert
// faellt auf „profil" zurueck — dieselbe Regel wie beim Herabstufungs-
// Waechter weiter unten, nur fuer die Adresszeile.
const activeSection = computed<SettingsSection>({
  get() {
    const q = route.query.sektion;
    return typeof q === "string" && SETTINGS_NAV.some((n) => n.id === q) ? (q as SettingsSection) : "profil";
  },
  set(v) {
    // `replace`, nicht `push`: der Wechsel zwischen zwei Bereichen ist kein
    // eigener Schritt in der Historie — sonst braucht „Zurueck" nach zehn
    // Klicks zehn Mal.
    void router.replace({ name: "settings", query: v === "profil" ? {} : { sektion: v } });
  },
});

// ── Warum die KI-Freigabe erst beim Öffnen lädt ───────────────────────────
//
// Im ersten Bau stand der Aufruf in `onMounted` hinter `if (isAdmin.value)`.
// `isAdmin` kommt aber asynchron aus `/auth/me` und ist beim Einhängen noch
// `false` — die Sektion blieb dauerhaft auf „Lade…" stehen. Genau dieselbe
// Falle wie beim Herabstufungs-Wächter weiter unten.
//
// Beim Öffnen zu laden ist ohnehin richtig: wer die Sektion nie aufmacht,
// braucht die Anfrage nicht.
watch(activeSection, (v) => {
  if (v === "ki-freigabe" && !kiFreigabe.value) void ladeKiFreigabe();
});

// Wurde ein Konto zwischenzeitlich herabgestuft — oder steht in der Adresse
// ein Bereich, den es nie oeffnen durfte —, gehoert es auf „profil".
//
// `geladen` ist hier keine Feinheit, sondern der Kern: bis `/auth/me`
// antwortet, ist `isAdmin` `false`, und ohne diese Abfrage haette der
// Waechter jeden Verwalter beim Aufruf von `?sektion=branding` sofort
// hinausgeworfen — samt Adresse, sodass ein „Zurueck" nichts half.
watch(
  [isAdmin, darfGeld, geladen, activeSection],
  () => {
    const ersatz = bereichNachRechten(activeSection.value, geladen.value, isAdmin.value, darfGeld.value);
    if (ersatz) activeSection.value = ersatz;
  },
  { immediate: true },
);

const WIDE_SECTIONS = new Set([
  "vorlagen",
  "word-export",
  "branding",
  "projekt-module",
  "positionskatalog",
  "ki-freigabe",
]);
const isWideSection = computed(() => WIDE_SECTIONS.has(activeSection.value));

onMounted(() => {
  void loadAll();
  void loadBranding();
  void loadTemplates();
  void loadTemplateVariables();
  void loadExportTemplates();
  void loadExportVariables();
  void loadProjectModules();
  void loadPreferences();
  void loadCustomVars();
  void loadCustomModules();
  void loadKatalog();
  // Die KI-Freigabe lädt erst beim Öffnen der Sektion — siehe den `watch`
  // weiter oben.
  if (activeSection.value === "ki-freigabe") void ladeKiFreigabe();
});
</script>

<template>
  <div class="settings-layout">
    <!-- Die Bereichsliste steht in der ContextSidebar (Fokus-Modus), nicht
         mehr hier: zwei Navigationen nebeneinander waren eine zu viel. -->
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
                <span class="text-sm settings-value">{{ formatDate(data.profile.createdAt) }}</span>
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

        <template v-if="activeSection === 'praeferenzen'">
          <section v-if="serverPrefs" style="margin-bottom: 26px">
            <h3 class="settings-h3 mb-3">Benachrichtigungen</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Wovon Sie eine Meldung in den
              <router-link to="/neuigkeiten">Neuigkeiten</router-link> bekommen möchten. Gemeldet wird nur, was an Sie
              gerichtet ist — Zuweisungen, Termine, Besprechungen, fällige Aufgaben.
            </p>
            <div class="settings-card settings-divide">
              <label
                v-for="opt in [
                  { key: 'tasks', label: 'Aufgaben', desc: 'Zuweisung an Sie und Fälligkeit am selben Tag' },
                  { key: 'termine', label: 'Termine', desc: 'Sie werden als Teilnehmer eingetragen' },
                  { key: 'meetings', label: 'Besprechungen', desc: 'Sie werden als Teilnehmer eingetragen' },
                ] as const"
                :key="opt.key"
                class="settings-row flex items-center gap-3 px-4 py-3"
                style="cursor: pointer"
              >
                <input
                  type="checkbox"
                  :checked="serverPrefs.benachrichtigungen?.[opt.key] !== false"
                  :disabled="prefsBusy"
                  @change="
                    patchPreferences({
                      benachrichtigungen: { [opt.key]: ($event.target as HTMLInputElement).checked },
                    })
                  "
                />
                <span style="flex: 1; min-width: 0">
                  <span class="text-sm" style="display: block; color: var(--color-text)">{{ opt.label }}</span>
                  <span class="text-xs" style="color: var(--color-text-tertiary)">{{ opt.desc }}</span>
                </span>
              </label>
            </div>
          </section>

          <section>
            <h3 class="settings-h3 mb-3">Erscheinungsbild</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Theme, Akzentfarbe und Schriftgröße. Änderungen werden sofort live übernommen.
            </p>

            <!--
              Hier stand ein Umschalter "Workspace-Variante: Studio / Atelier".
              Er ist mit der Uebernahme des SIMA-Designs entfallen: das neue
              Stylesheet kennt nur noch `.app-v2[data-variant="studio"]`.
              Der Knopf waere stehengeblieben und haette nichts mehr bewirkt —
              schlimmer noch, "Atelier" haette die Oberflaeche ohne einzige
              Regel dastehen lassen.
            -->

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
            <h3 class="settings-h3 mb-3" style="margin-top: 28px">Sonstiges</h3>
            <div class="settings-card settings-divide">
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
                    {{ formatDate(t.uploadedAt) }}
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
        <template v-if="activeSection === 'positionskatalog'">
          <section>
            <h3 class="settings-h3 mb-3">Positionskatalog</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 12px">
              Wiederkehrende Leistungen, die beim Schreiben einer Rechnung mit einem Klick übernommen werden. Beim
              Übernehmen wird <strong>kopiert</strong>, nicht verknüpft — eine spätere Preisanpassung hier ändert
              bereits gestellte Rechnungen also nicht.
            </p>

            <div v-if="katalogFehler" class="settings-card" style="padding: 8px 12px; font-size: 12px">
              {{ katalogFehler }}
            </div>

            <div class="settings-card settings-divide">
              <div v-for="k in katalog" :key="k.id" class="kat-row">
                <input v-model="k.text" type="text" class="stamm-input kat-text" placeholder="Leistung" />
                <input v-model="k.einheit" type="text" class="stamm-input kat-einheit" placeholder="h" />
                <input v-model.number="k.einzelpreis" type="number" min="0" step="0.01" class="stamm-input kat-num" />
                <input v-model.number="k.ustSatz" type="number" min="0" max="100" class="stamm-input kat-num" />
                <button class="patio-btn ghost sm" @click="katalogSpeichern(k)">Speichern</button>
                <button class="patio-btn ghost sm" @click="katalogLoeschen(k)">
                  <BIcon name="x" :size="11" />
                </button>
              </div>
              <div v-if="katalog.length === 0" class="kat-leer">Noch keine Leistung im Katalog.</div>
            </div>

            <h4 class="settings-h3 mb-3" style="margin-top: 20px">Neue Leistung</h4>
            <div class="settings-card">
              <div class="kat-row">
                <input
                  v-model="katalogEntwurf.text"
                  type="text"
                  class="stamm-input kat-text"
                  placeholder="z. B. Einreichplanung"
                />
                <input v-model="katalogEntwurf.einheit" type="text" class="stamm-input kat-einheit" placeholder="h" />
                <input
                  v-model.number="katalogEntwurf.einzelpreis"
                  type="number"
                  min="0"
                  step="0.01"
                  class="stamm-input kat-num"
                />
                <input
                  v-model.number="katalogEntwurf.ustSatz"
                  type="number"
                  min="0"
                  max="100"
                  class="stamm-input kat-num"
                />
                <button class="patio-btn ghost sm" :disabled="!katalogEntwurf.text.trim()" @click="katalogAnlegen">
                  Hinzufügen
                </button>
              </div>
              <div class="kat-legende">Leistung · Einheit · Einzelpreis € · USt %</div>
            </div>
          </section>
        </template>

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
                  <div v-if="customModuleEdit?.id === m.id" style="flex: 1; min-width: 0" class="flex flex-col gap-2">
                    <input
                      v-model="customModuleEdit.label"
                      class="stamm-input"
                      placeholder="Name"
                      @keyup.enter="saveCustomModuleEdit"
                    />
                    <input v-model="customModuleEdit.description" class="stamm-input" placeholder="Beschreibung" />
                    <!-- Der Schlüssel bleibt: an ihm hängt die Zuordnung aller
                         Projekte. Änderbar ist, was man liest. -->
                    <div class="text-xs font-mono" style="color: var(--color-text-tertiary)">Key: {{ m.key }}</div>
                    <div class="flex gap-2">
                      <button class="patio-btn solid sm" :disabled="customModulesBusy" @click="saveCustomModuleEdit">
                        Speichern
                      </button>
                      <button class="patio-btn sm" @click="customModuleEdit = null">Abbrechen</button>
                    </div>
                  </div>
                  <div v-else style="flex: 1; min-width: 0">
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
                    v-if="customModuleEdit?.id !== m.id"
                    class="text-xs px-2 py-1 rounded"
                    style="
                      background: transparent;
                      border: 1px solid var(--color-border);
                      cursor: pointer;
                      flex-shrink: 0;
                    "
                    :disabled="customModulesBusy"
                    title="Modul umbenennen"
                    @click="startCustomModuleEdit(m)"
                  >
                    Ändern
                  </button>
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
        <template v-if="activeSection === 'ki-freigabe'">
          <section>
            <h3 class="settings-h3 mb-3">KI-Zugriff</h3>
            <p class="text-sm" style="color: var(--color-text-muted); margin: 0 0 14px; max-width: 70ch">
              PATIO kann je Projekt eine <strong>Akte</strong> erzeugen, die ein Sprachmodell lesen darf. Nichts davon
              geschieht von selbst: ohne Hauptschalter und ohne Häkchen entsteht keine Zeile.
            </p>

            <div v-if="!kiFreigabe" class="empty-hint">Lade…</div>
            <template v-else>
              <div class="settings-card p-4" style="margin-bottom: 14px">
                <label class="flex items-center gap-3" style="cursor: pointer">
                  <input
                    type="checkbox"
                    :checked="kiFreigabe.aktiv"
                    :disabled="kiBusy"
                    @change="kiKopf({ aktiv: ($event.target as HTMLInputElement).checked })"
                  />
                  <span>
                    <span class="text-sm" style="display: block; font-weight: 600">KI-Zugriff eingeschaltet</span>
                    <span class="text-xs" style="color: var(--color-text-tertiary)">
                      Aus heisst: es entsteht keine Akte, egal was unten steht.
                    </span>
                  </span>
                </label>
              </div>

              <div class="settings-card p-4" style="margin-bottom: 14px">
                <div class="text-sm" style="font-weight: 600; margin-bottom: 8px">Personenbezogene Daten</div>
                <div class="flex" style="gap: 8px; flex-wrap: wrap">
                  <button
                    v-for="o in [
                      { id: 'keine', label: 'Keine Namen', desc: 'Personen nur als Kennung' },
                      {
                        id: 'namen-ohne-kontakt',
                        label: 'Namen, keine Kontaktdaten',
                        desc: 'Protokolle bleiben lesbar',
                      },
                      { id: 'alle', label: 'Alle', desc: 'auch E-Mail und Telefon' },
                    ] as const"
                    :key="o.id"
                    :class="['settings-chip', kiFreigabe.personendaten === o.id ? 'settings-chip-active' : '']"
                    style="padding: 6px 14px; border-radius: 6px; font-size: 12px"
                    :disabled="kiBusy"
                    :title="o.desc"
                    @click="kiKopf({ personendaten: o.id })"
                  >
                    {{ o.label }}
                  </button>
                </div>
                <div class="text-xs" style="color: var(--color-text-tertiary); margin-top: 8px; max-width: 70ch">
                  Wirkt über alle freigegebenen Bereiche. <strong>Freitexte werden nicht durchsucht</strong> — steht in
                  einem Protokoll „Hr. Müller wünscht Sichtbeton", bleibt das stehen. Wer das nicht will, gibt Notizen
                  und Besprechungen nicht frei.
                </div>
              </div>

              <div class="text-sm" style="font-weight: 600; margin-bottom: 8px">Projekte und Bereiche</div>
              <div class="ki-tabelle-wrap">
                <table class="ki-tabelle">
                  <thead>
                    <tr>
                      <th style="text-align: left">Projekt</th>
                      <th v-for="k in KI_KATEGORIEN" :key="k.key">{{ k.label }}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="p in kiProjekte" :key="p.id">
                      <td style="text-align: left; white-space: nowrap">{{ p.name }}</td>
                      <td v-for="k in KI_KATEGORIEN" :key="k.key">
                        <input
                          type="checkbox"
                          :checked="kiHat(p.id, k.key)"
                          :disabled="kiBusy"
                          @change="kiUmschalten(p.id, k.key)"
                        />
                      </td>
                      <td>
                        <button class="patio-btn sm" @click="kiVorschauZeigen(p.id, p.name)">Vorschau</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="kiVorschau" class="settings-card p-4" style="margin-top: 16px">
                <div class="flex items-center" style="gap: 8px; margin-bottom: 8px">
                  <span class="text-sm" style="font-weight: 600">Vorschau: {{ kiVorschau.projekt }}</span>
                  <button class="patio-btn sm" style="margin-left: auto" @click="kiVorschau = null">Schliessen</button>
                </div>
                <p class="text-xs" style="color: var(--color-text-tertiary); margin: 0 0 8px">
                  Genau das — und nichts anderes — bekommt die KI zu sehen.
                </p>
                <pre class="ki-vorschau">{{ kiVorschau.text }}</pre>
              </div>
            </template>
          </section>
        </template>

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
                  {{ data.runtime.dbEnabled ? "Aktiv (PostgreSQL)" : "Nicht aktiv (Dateisystem-Fallback)" }}
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
            </div>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── KI-Freigabe ───────────────────────────────────────────── */
.ki-tabelle-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.ki-tabelle {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.ki-tabelle th {
  padding: 8px 6px;
  text-align: center;
  font-weight: 600;
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
  font-size: 11px;
}
.ki-tabelle td {
  padding: 6px;
  text-align: center;
  border-bottom: 1px solid var(--color-border-subtle);
}
.ki-vorschau {
  max-height: 420px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.5;
  background: var(--color-bg-subtle);
  border-radius: 6px;
  padding: 10px 12px;
  white-space: pre-wrap;
  margin: 0;
}

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

/* ── Layout ────────────────────────────────────────────────────────────
   Eine Spalte: die Bereichsliste traegt die ContextSidebar des Fokus-Modus.
   Das frueher hier stehende zweispaltige Raster samt eigenem Menue
   (`.settings-sidebar`, `.settings-nav*`) ist mit ihr entfallen. */
.settings-layout {
  display: block;
  min-height: 100%;
  color: var(--fg-body, var(--color-text));
  font-family: var(--font-sans, "Inter", system-ui, sans-serif);
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

@media (max-width: 767.98px) {
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

/* ── Positionskatalog (Migration 046) ───────────────────────────────────── */
.kat-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
}
.kat-text {
  flex: 1;
  min-width: 0;
}
.kat-einheit {
  width: 70px;
}
.kat-num {
  width: 86px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.kat-leer,
.kat-legende {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}
</style>
