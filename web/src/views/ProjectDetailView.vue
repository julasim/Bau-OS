<script setup lang="ts">
import { formatDate } from "../utils/format";
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import BIcon from "../components/BIcon.vue";
import TeamPicker from "../components/TeamPicker.vue";
import ProjectPhasesTab from "./projects-v2/ProjectPhasesTab.vue";
import ProjectInvoicesTab from "./projects-v2/ProjectInvoicesTab.vue";
import { useCurrentUser } from "../composables/useCurrentUser";
import { useConfirm } from "../composables/useConfirm";

const { isAdmin } = useCurrentUser();
const { confirm } = useConfirm();

interface ProjectInfo {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  color?: string | null;
  // Stammdaten (Migration 004) — im Hero-Bereich mit Inline-Editor.
  projektnummer?: string | null;
  bauherr?: string | null;
  standort?: string | null;
  projektart?: string | null;
  nutzung?: string | null;
  phase?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  // Verknuepfungen (Migration 005)
  bauherrId?: string | null;
  bauherrName?: string | null;
  parentId?: string | null;
  parentName?: string | null;
  notes: number;
  openTasks: number;
  doneTasks?: number;
  termine: number;
  files?: number;
  childrenCount?: number;
  // V1 Stage Stats
  budget?: number | null;
  budgetUsed?: number | null;
  highPriorityCount?: number;
  // Phase 3 ACL
  createdById?: string | null;
  createdByUsername?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
interface ProjectAccessEntry {
  userId: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
  addedAt: string;
}
interface AdminUserMini {
  id: string;
  username: string;
  displayName: string | null;
  role: "admin" | "user";
}
interface ProjectSummary {
  id: string;
  name: string;
  parentId?: string | null;
}
interface ChildProject {
  id: string;
  name: string;
  status: string | null;
}
interface Task {
  id: string;
  text: string;
  status: string;
  assignee: string | null;
  // Migration 007
  assigneeId?: string | null;
  assigneeName?: string | null;
  date: string | null;
  priority?: string | null;
}
interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  location: string | null;
  assignees: string[];
  // Migration 007
  assigneeIds?: string[];
  assigneesResolved?: { id: string; name: string }[];
}
interface FileEntry {
  id: string;
  name: string;
  size: number;
  modified: string;
  extension: string;
  analyzed?: boolean;
}
interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  projectId: string | null;
  // Migration 006 — Junction-Daten
  projects?: { id: string; name: string; projectRole: string | null }[];
}

const route = useRoute();
const router = useRouter();
const projectName = ref("");
const info = ref<ProjectInfo | null>(null);
const notes = ref<string[]>([]);
const tasks = ref<Task[]>([]);
const termine = ref<Termin[]>([]);
const files = ref<FileEntry[]>([]);

// Datei-Preview im Dateien-Tab (nur fuer Text/Markdown).
const viewingFile = ref<FileEntry | null>(null);
const viewingFileContent = ref<string>("");
const filesLoaded = ref(false); // Lazy-Load: erst laden, wenn Tab geoeffnet wird.

// Upload-State (Drag & Drop + Button)
const dragging = ref(false);
const uploading = ref(false);
const uploadMsg = ref("");
// Eigene Fehler-State, damit Erfolgs-Message und Fehler-Message gleichzeitig
// angezeigt werden koennen (z.B. bei partial-success). Fehler bleibt laenger
// stehen (8s vs 3s) damit der User Zeit hat zu lesen.
const uploadError = ref("");

// ── Team-State (Stufe 3c) ──────────────────────────────────
const allTeam = ref<TeamMember[]>([]);
const teamLoaded = ref(false);
const teamAssigning = ref(false);
const teamError = ref<string | null>(null);
// Formular fuer Neu-Anlegen-und-Zuordnen (nur Name+Rolle, Rest spaeter im /team-Editor).
const showNewMemberForm = ref(false);
const newMemberName = ref("");
const newMemberRole = ref("");
// Existierendes Mitglied zuordnen
const assignMemberId = ref(""); // "" = keine Auswahl

// ── Zugriff (Phase 3) ────────────────────────────────────
const accessList = ref<ProjectAccessEntry[]>([]);
const accessLoaded = ref(false);
const allUsers = ref<AdminUserMini[]>([]);
const allUsersLoaded = ref(false);
const accessAddUserId = ref(""); // ausgewaehlter User im Dropdown
const accessSaving = ref(false);
const accessError = ref<string | null>(null);

const viewingNote = ref<string | null>(null);
const noteContent = ref("");
const newTask = ref("");
// Refs auf die Quick-Add-Inputs in Tasks- und Termine-Tab — werden vom
// jeweiligen Empty-State-CTA fokussiert + smooth-scrolled.
const newTaskInputRef = ref<HTMLInputElement | null>(null);
const newTerminInputRef = ref<HTMLInputElement | null>(null);
function focusNewTaskInput() {
  newTaskInputRef.value?.focus();
  newTaskInputRef.value?.scrollIntoView({ behavior: "smooth", block: "center" });
}
function focusNewTerminInput() {
  newTerminInputRef.value?.focus();
  newTerminInputRef.value?.scrollIntoView({ behavior: "smooth", block: "center" });
}
const newDatum = ref("");
const newUhrzeit = ref("");
const newTerminText = ref("");
// Migration 007: Team-Teilnehmer fuer Termin-Quick-Add
const newTerminAssigneeIds = ref<string[]>([]);
const newTerminAssigneeFree = ref<string[]>([]);
// Task-Quick-Add: ein Team-Mitglied als Assignee (Single-Mode)
const newTaskAssigneeId = ref<string | null>(null);
// Stufe 3d: Uebersicht ist jetzt der Start-Tab.
type Tab =
  | "uebersicht"
  | "phasen"
  | "rechnungen"
  | "notes"
  | "tasks"
  | "termine"
  | "files"
  | "team"
  | "bautagebuch"
  | "meetings"
  | "stunden"
  | "zugriff";
const tab = ref<Tab>("uebersicht");

// Gueltige Tab-Keys (fuer URL-Query-Validierung via NavRail-Sidebar).
const VALID_TABS: Tab[] = [
  "uebersicht",
  "phasen",
  "rechnungen",
  "notes",
  "tasks",
  "termine",
  "files",
  "team",
  "bautagebuch",
  "meetings",
  "stunden",
  "zugriff",
];
function isValidTab(t: unknown): t is Tab {
  return typeof t === "string" && (VALID_TABS as string[]).includes(t);
}

// NavRail (Projekt-Sidebar) navigiert ueber ?tab=. Aenderung der Query →
// internen Tab umschalten. Der Guard in openTab verhindert eine Push-Schleife.
watch(
  () => route.query.tab,
  (q) => {
    const t: Tab = isValidTab(q) ? q : "uebersicht";
    if (t !== tab.value) void openTab(t);
  },
);

// ── Projekt-Module (Phase 6e) ────────────────────────────────────────────
// Effektive Modul-Sicht (globale Defaults + per-Projekt-Override). Tabs
// deren Modul auf false ist werden ausgeblendet. uebersicht/zugriff
// sind immer sichtbar (kein Modul-Mapping).
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
const PM_DEFAULTS: ProjectModuleFlags = {
  stammdaten: true,
  notes: true,
  tasks: true,
  termine: true,
  files: true,
  team: true,
  bautagebuch: true,
  meetings: true,
  time_entries: true,
};
const moduleFlags = ref<ProjectModuleFlags>({ ...PM_DEFAULTS });
const moduleHasOverride = ref(false);
const moduleGlobal = ref<ProjectModuleFlags>({ ...PM_DEFAULTS });
const moduleSettingsOpen = ref(false);
const moduleBusy = ref(false);

const PROJECT_MODULE_LIST: { key: keyof ProjectModuleFlags; label: string }[] = [
  { key: "stammdaten", label: "Stammdaten" },
  { key: "notes", label: "Notizen" },
  { key: "tasks", label: "Aufgaben" },
  { key: "termine", label: "Termine" },
  { key: "files", label: "Dateien" },
  { key: "team", label: "Team" },
  { key: "bautagebuch", label: "Bautagebuch" },
  { key: "meetings", label: "Meetings" },
  { key: "time_entries", label: "Stunden" },
];

// Tab-Sichtbarkeit pro Modul. Tabs ohne Modul-Mapping sind immer aktiv.
function tabVisible(t: Tab): boolean {
  if (t === "uebersicht" || t === "zugriff") return true;
  if (t === "stunden") return moduleFlags.value.time_entries;
  return moduleFlags.value[t as keyof ProjectModuleFlags];
}

async function loadProjectModules() {
  try {
    const n = encodeURIComponent(projectName.value);
    const res = await api.get<{
      effective: ProjectModuleFlags;
      hasOverride: boolean;
      global: ProjectModuleFlags;
    }>(`/projects/${n}/modules`);
    moduleFlags.value = res.effective;
    moduleHasOverride.value = res.hasOverride;
    moduleGlobal.value = res.global;
  } catch {
    moduleFlags.value = { ...PM_DEFAULTS };
  }
}

async function setProjectModule(key: keyof ProjectModuleFlags, value: boolean) {
  moduleBusy.value = true;
  try {
    const n = encodeURIComponent(projectName.value);
    const res = await api.patch<{
      effective: ProjectModuleFlags;
      hasOverride: boolean;
      global: ProjectModuleFlags;
    }>(`/projects/${n}/modules`, { [key]: value });
    moduleFlags.value = res.effective;
    moduleHasOverride.value = res.hasOverride;
    moduleGlobal.value = res.global;
    // Wenn aktueller Tab ausgeblendet wurde → auf Uebersicht zurueck.
    if (!tabVisible(tab.value)) tab.value = "uebersicht";
  } catch (e) {
    await confirm({
      message: e instanceof Error ? e.message : "Speichern fehlgeschlagen",
      confirmLabel: "OK",
      cancelLabel: "",
    });
  } finally {
    moduleBusy.value = false;
  }
}

async function resetProjectModulesToGlobal() {
  if (
    !(await confirm({
      message: "Per-Projekt-Override zurücksetzen? Globale Defaults gelten dann.",
    }))
  )
    return;
  moduleBusy.value = true;
  try {
    const n = encodeURIComponent(projectName.value);
    const res = await api.delete<{
      effective: ProjectModuleFlags;
      hasOverride: boolean;
      global: ProjectModuleFlags;
    }>(`/projects/${n}/modules`);
    moduleFlags.value = res.effective;
    moduleHasOverride.value = res.hasOverride;
    moduleGlobal.value = res.global;
    if (!tabVisible(tab.value)) tab.value = "uebersicht";
  } catch (e) {
    await confirm({
      message: e instanceof Error ? e.message : "Reset fehlgeschlagen",
      confirmLabel: "OK",
      cancelLabel: "",
    });
  } finally {
    moduleBusy.value = false;
  }
}

// ── Stunden (Migration 014) ─────────────────────────────────────────
interface TimeEntry {
  id: string;
  projectId: string;
  memberId: string | null;
  memberName: string | null;
  date: string;
  hours: number;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  activity: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
interface TimeSummaryRow {
  key: string;
  label: string;
  hours: number;
  entries: number;
}
interface TimeDraft {
  id: string | null; // null = neu
  date: string;
  memberId: string | null;
  memberName: string;
  hours: string; // String fuer input — beim Save zu Number
  startTime: string;
  endTime: string;
  breakMinutes: string;
  activity: string;
  notes: string;
}
const timeEntries = ref<TimeEntry[]>([]);
const timeSummary = ref<TimeSummaryRow[]>([]);
const timeLoaded = ref(false);
const timeDraft = ref<TimeDraft | null>(null);
const timeSaving = ref(false);
const timeError = ref<string | null>(null);

// ── Meetings (Migration 012) ──────────────────────────────
type MeetingType =
  | "Bauherrenmeeting"
  | "Baubesprechung"
  | "Subunternehmer"
  | "Planung"
  | "Behoerde"
  | "Abnahme"
  | "Sonstiges";
const MEETING_TYPES: MeetingType[] = [
  "Bauherrenmeeting",
  "Baubesprechung",
  "Subunternehmer",
  "Planung",
  "Behoerde",
  "Abnahme",
  "Sonstiges",
];
interface MeetingActionItem {
  text: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  done?: boolean;
  /** Wenn aus dem Action-Item per "→ Aufgabe"-Button eine echte Task
   *  angelegt wurde, zeigt taskId darauf. UI rendert dann statt
   *  "Anlegen" einen Link zur Aufgabe + "Erledigt"-Sync. */
  taskId?: string | null;
}
interface Meeting {
  id: string;
  projectId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  meetingType: MeetingType | null;
  location: string | null;
  attendeeIds: string[];
  attendeesResolved?: { id: string; name: string }[];
  attendeesExternal: string[];
  agenda: string | null;
  minutes: string | null;
  decisions: string | null;
  actionItems: MeetingActionItem[];
  nextMeetingDate: string | null;
}
interface MeetingDraft {
  id: string | null; // null = neu
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  meetingType: MeetingType | "";
  location: string;
  attendeeIds: string[];
  attendeesExternal: string[];
  agenda: string;
  minutes: string;
  decisions: string;
  actionItems: MeetingActionItem[];
  nextMeetingDate: string;
}
const meetings = ref<Meeting[]>([]);
const meetingsLoaded = ref(false);
const meetingDraft = ref<MeetingDraft | null>(null);
const meetingSaving = ref(false);
const meetingError = ref<string | null>(null);
const newActionItemText = ref("");
// Convert-Action-Item-To-Task State (Block-A #1):
// convertingActionIdx zeigt während des API-Calls den Spinner-Status,
// convertError sammelt Fehlermeldung pro Meeting-Editor.
const convertingActionIdx = ref<number | null>(null);
const convertError = ref<string | null>(null);

// ── Bautagebuch (Migration 011) ───────────────────────────
type WeatherKey = "sonnig" | "bewoelkt" | "regen" | "schnee" | "sturm" | "nebel" | "frost" | "hagel";
const WEATHER_OPTIONS: { value: WeatherKey; label: string }[] = [
  { value: "sonnig", label: "Sonnig" },
  { value: "bewoelkt", label: "Bewölkt" },
  { value: "regen", label: "Regen" },
  { value: "schnee", label: "Schnee" },
  { value: "sturm", label: "Sturm" },
  { value: "nebel", label: "Nebel" },
  { value: "frost", label: "Frost" },
  { value: "hagel", label: "Hagel" },
];
interface BautagebuchPersonnel {
  memberId?: string | null;
  name: string;
  hours?: number | null;
  role?: string | null;
  removed?: boolean;
}
interface BautagebuchEntry {
  id: string;
  projectId: string;
  date: string; // YYYY-MM-DD
  weather: WeatherKey | null;
  temperatureMin: number | null;
  temperatureMax: number | null;
  personnel: BautagebuchPersonnel[];
  machines: string | null;
  activities: string | null;
  incidents: string | null;
  createdById: string | null;
  createdByUsername?: string | null;
  createdAt: string;
  updatedAt: string;
}
const bautagebuchEntries = ref<BautagebuchEntry[]>([]);
const bautagebuchLoaded = ref(false);
const bautagebuchSelectedDate = ref<string>(""); // YYYY-MM-DD oder "" = nichts ausgewählt
const bautagebuchDraft = ref<{
  weather: WeatherKey | "";
  temperatureMin: string;
  temperatureMax: string;
  personnelIds: string[];
  personnelFree: string[];
  machines: string;
  activities: string;
  incidents: string;
} | null>(null);
const bautagebuchSaving = ref(false);
const bautagebuchError = ref<string | null>(null);

// ── Inline-Editor State ────────────────────────────────────
// editingField: welcher Stammdaten-Key gerade editiert wird (null = nichts).
// draftValue: aktueller Eingabewert. saving: verhindert Doppel-Submit.
type EditableKey =
  | "projektnummer"
  | "bauherr"
  | "standort"
  | "projektart"
  | "nutzung"
  | "phase"
  | "startDate"
  | "endDate"
  | "status"
  | "description";
const editingField = ref<EditableKey | null>(null);
const draftValue = ref<string>("");
const saving = ref(false);
const saveError = ref<string | null>(null);

// Feld-Konfig: Label + Typ (fuer Input-Rendering) + optional Enum/Suggestions.
interface FieldCfg {
  key: EditableKey;
  label: string;
  inputType: "text" | "enum" | "date";
  options?: readonly string[];
  suggestions?: readonly string[];
  placeholder?: string;
}
const STAMMDATEN_FIELDS: readonly FieldCfg[] = [
  { key: "projektnummer", label: "Projektnummer", inputType: "text", placeholder: "z.B. 2026-037" },
  { key: "bauherr", label: "Bauherr", inputType: "text", placeholder: "Name + Kontakt" },
  { key: "standort", label: "Standort", inputType: "text", placeholder: "Ort / Adresse" },
  {
    key: "projektart",
    label: "Projektart",
    inputType: "enum",
    options: ["Neubau", "Umbau", "Sanierung", "Zubau"] as const,
  },
  {
    key: "nutzung",
    label: "Nutzung",
    inputType: "text",
    placeholder: "z.B. Wohnbau, Büro",
    suggestions: ["Wohnbau", "Büro", "Gewerbe", "Mischnutzung", "Bildung"] as const,
  },
  {
    key: "phase",
    label: "Phase",
    inputType: "text",
    placeholder: "z.B. Einreichung",
    // Vorschlaege — nicht erzwungen, anderes darf auch eingetragen werden.
    suggestions: ["Vorentwurf", "Einreichung", "Ausführung", "Baubetreuung", "Abgeschlossen"] as const,
  },
  { key: "startDate", label: "Start", inputType: "date" },
  { key: "endDate", label: "Ende", inputType: "date" },
] as const;

const STATUS_OPTIONS = ["aktiv", "pausiert", "archiviert"] as const;

onMounted(async () => {
  projectName.value = route.params.name as string;
  // Tab aus URL-Query uebernehmen (NavRail-Sidebar oder geteilter Link).
  if (isValidTab(route.query.tab)) tab.value = route.query.tab;
  await loadAll();
  void loadProjectModules();
  // Lazy-Loads fuer den initialen Tab anstossen (falls nicht Uebersicht).
  if (tab.value !== "uebersicht") void openTab(tab.value);
  // Uebersicht ist Default-Tab — Children erst nach loadAll laden,
  // weil info.id als Filter gebraucht wird.
  if (tab.value === "uebersicht") {
    await loadChildren();
  }
  // Click-away-Listener fuer das Aktions-Menue.
  document.addEventListener("mousedown", onGlobalClick);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onGlobalClick);
});

async function loadAll() {
  const n = encodeURIComponent(projectName.value);
  const [i, no, ta, te, ph] = await Promise.all([
    api.get<ProjectInfo>(`/projects/${n}`),
    api.get<string[]>(`/projects/${n}/notes`),
    api.get<Task[]>(`/projects/${n}/tasks`),
    api.get<Termin[]>(`/projects/${n}/termine`),
    // Honorargewichteter Phasenfortschritt (DB-only; 503/Fehler → null).
    api.get<{ phases: unknown[]; progress: number }>(`/projects/${n}/phases`).catch(() => null),
  ]);
  info.value = i;
  notes.value = no;
  tasks.value = ta;
  termine.value = te;
  phaseOverall.value = ph && Array.isArray(ph.phases) && ph.phases.length > 0 ? ph.progress : null;
}

// ── Inline-Editor Actions ──────────────────────────────────

function startEdit(key: EditableKey) {
  if (!info.value) return;
  editingField.value = key;
  // date-Felder brauchen YYYY-MM-DD — die API liefert das bereits so.
  const raw = info.value[key as keyof ProjectInfo];
  draftValue.value = raw == null ? "" : String(raw);
  saveError.value = null;
}

function cancelEdit() {
  editingField.value = null;
  draftValue.value = "";
  saveError.value = null;
}

async function saveField(key: EditableKey) {
  if (!info.value || saving.value) return;
  saving.value = true;
  saveError.value = null;

  // Optimistisches Update — UI wirkt sofort, Rollback bei Fehler.
  const before = info.value[key as keyof ProjectInfo];
  const newValue = draftValue.value.trim() === "" ? null : draftValue.value.trim();
  (info.value as Record<string, unknown>)[key] = newValue;
  editingField.value = null;

  try {
    const n = encodeURIComponent(projectName.value);
    const updated = await api.patch<ProjectInfo>(`/projects/${n}`, { [key]: newValue });
    info.value = updated;
  } catch (e) {
    // Rollback
    (info.value as Record<string, unknown>)[key] = before;
    saveError.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    saving.value = false;
  }
}

function onEditKey(e: KeyboardEvent, key: EditableKey) {
  if (e.key === "Escape") {
    cancelEdit();
  } else if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void saveField(key);
  }
}

function applyPhaseSuggestion(key: EditableKey, value: string) {
  draftValue.value = value;
  void saveField(key);
}

// ── Aufgaben / Termine / Notizen (unveraendert) ────────────

async function openNote(name: string) {
  const n = encodeURIComponent(projectName.value);
  const note = await api.get<{ name: string; content: string }>(`/projects/${n}/notes/${encodeURIComponent(name)}`);
  viewingNote.value = name;
  noteContent.value = note.content;
}

async function addTask() {
  if (!newTask.value.trim()) return;
  const n = encodeURIComponent(projectName.value);
  await api.post(`/projects/${n}/tasks`, {
    text: newTask.value,
    assigneeId: newTaskAssigneeId.value ?? undefined,
  });
  newTask.value = "";
  newTaskAssigneeId.value = null;
  await loadAll();
}

async function completeTask(task: Task) {
  const n = encodeURIComponent(projectName.value);
  await api.patch(`/projects/${n}/tasks`, { text: task.text });
  await loadAll();
}

async function addTermin() {
  if (!newDatum.value || !newTerminText.value) return;
  const n = encodeURIComponent(projectName.value);
  await api.post(`/projects/${n}/termine`, {
    datum: newDatum.value,
    text: newTerminText.value,
    uhrzeit: newUhrzeit.value || undefined,
    assigneeIds: newTerminAssigneeIds.value.length > 0 ? newTerminAssigneeIds.value : undefined,
  });
  newDatum.value = "";
  newUhrzeit.value = "";
  newTerminText.value = "";
  newTerminAssigneeIds.value = [];
  newTerminAssigneeFree.value = [];
  await loadAll();
}

async function removeTermin(t: Termin) {
  const n = encodeURIComponent(projectName.value);
  await api.delete(`/projects/${n}/termine`, { text: t.text });
  await loadAll();
}

// ── Aktions-Menue (Lifecycle) ─────────────────────────────
const showActionMenu = ref(false);
const deleteConfirmOpen = ref(false);
const deleting = ref(false);
const deleteError = ref<string | null>(null);

// Rename-Dialog
const renameDialogOpen = ref(false);
const renameDraft = ref("");
const renaming = ref(false);
const renameError = ref<string | null>(null);

// Farb-Palette — kuratierte, zurueckhaltende Werte, die sowohl im Light- als
// auch im Dark-Mode als subtiler Akzent funktionieren.
const COLOR_PALETTE = [
  { key: "", label: "Keine", value: null },
  { key: "slate", label: "Schiefer", value: "#64748b" },
  { key: "blue", label: "Blau", value: "#3b82f6" },
  { key: "green", label: "Gruen", value: "#10b981" },
  { key: "amber", label: "Bernstein", value: "#f59e0b" },
  { key: "red", label: "Rot", value: "#ef4444" },
  { key: "purple", label: "Violett", value: "#a855f7" },
  { key: "pink", label: "Rosa", value: "#ec4899" },
] as const;
const showColorPicker = ref(false);

// ── Verknuepfungen (Migration 005) ───────────────────────
// Bauherr-Team-Link
const showBauherrPicker = ref(false);
// Parent-Projekt
const showParentPicker = ref(false);
const allProjectsForPicker = ref<ProjectSummary[]>([]);
const allProjectsLoaded = ref(false);
// Kinder (Unter-Projekte)
const children = ref<ChildProject[]>([]);
const childrenLoaded = ref(false);

function toggleActionMenu() {
  showActionMenu.value = !showActionMenu.value;
}

// Click-away schliesst Menues — wir hoeren global auf mousedown und
// beenden nur wenn der Klick ausserhalb des jeweiligen Wrappers war.
function onGlobalClick(ev: MouseEvent) {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (!target.closest(".action-menu-wrapper")) showActionMenu.value = false;
  if (!target.closest(".color-picker-wrapper")) showColorPicker.value = false;
  if (!target.closest(".link-picker-wrapper")) {
    showBauherrPicker.value = false;
    showParentPicker.value = false;
  }
}

async function setStatus(newStatus: "aktiv" | "pausiert" | "archiviert") {
  if (!info.value) return;
  showActionMenu.value = false;
  // Kurzweg ueber den existierenden saveField-Flow — setzt auch optimistisch.
  const before = info.value.status;
  (info.value as Record<string, unknown>).status = newStatus;
  try {
    const n = encodeURIComponent(projectName.value);
    info.value = await api.patch<ProjectInfo>(`/projects/${n}`, { status: newStatus });
  } catch {
    (info.value as Record<string, unknown>).status = before;
  }
}

function openDeleteConfirm() {
  showActionMenu.value = false;
  deleteConfirmOpen.value = true;
  deleteError.value = null;
}

async function confirmDelete() {
  if (deleting.value) return;
  deleting.value = true;
  deleteError.value = null;
  try {
    const n = encodeURIComponent(projectName.value);
    await api.delete(`/projects/${n}`);
    // Erfolgreich geloescht → zurueck zur Liste. Kein loadAll() — das Projekt
    // existiert nicht mehr.
    router.push("/projects");
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  } finally {
    deleting.value = false;
  }
}

// ── Rename ───────────────────────────────────────────────
function openRenameDialog() {
  if (!info.value) return;
  showActionMenu.value = false;
  renameDraft.value = info.value.name;
  renameError.value = null;
  renameDialogOpen.value = true;
}
async function submitRename() {
  if (!info.value || renaming.value) return;
  const newName = renameDraft.value.trim();
  if (!newName || newName === info.value.name) {
    renameDialogOpen.value = false;
    return;
  }
  renaming.value = true;
  renameError.value = null;
  try {
    const n = encodeURIComponent(projectName.value);
    await api.put(`/projects/${n}/rename`, { newName });
    renameDialogOpen.value = false;
    // URL wechselt auf neuen Namen — vollstaendige Navigation statt nur
    // param-update, damit loadAll() garantiert sauber laeuft.
    router.push(`/projects/${encodeURIComponent(newName)}`);
  } catch (e) {
    renameError.value = e instanceof Error ? e.message : "Umbenennen fehlgeschlagen";
  } finally {
    renaming.value = false;
  }
}

// ── Export ───────────────────────────────────────────────
function downloadMarkdown() {
  showActionMenu.value = false;
  const n = encodeURIComponent(projectName.value);
  const token = localStorage.getItem("patio-token");
  // Browser-Download kann keine Auth-Header setzen — Token als Query-Param.
  const base = `/api/projects/${n}/export.md`;
  const href = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  window.location.href = href;
}

// ── PDF via Druck-Dialog ─────────────────────────────────
// window.print() + angepasstes @media print CSS — ohne externe Lib und
// ohne Server-Roundtrip. "Als PDF speichern" ist im Druckdialog jedes
// modernen Browsers eingebaut. Wir springen automatisch auf die Uebersicht,
// damit nicht ein leerer Dateien-Tab gedruckt wird.
async function printProject() {
  showActionMenu.value = false;
  if (tab.value !== "uebersicht") await openTab("uebersicht");
  // Kurze Pause, damit Vue die Uebersicht rendert bevor der Druckdialog kommt.
  setTimeout(() => window.print(), 100);
}

// ── Farbe setzen ─────────────────────────────────────────
async function setColor(value: string | null) {
  showColorPicker.value = false;
  if (!info.value) return;
  const before = info.value.color;
  info.value.color = value;
  try {
    const n = encodeURIComponent(projectName.value);
    info.value = await api.patch<ProjectInfo>(`/projects/${n}`, { color: value ?? null });
  } catch {
    info.value.color = before;
  }
}

// ── Bauherr → Team verknuepfen ───────────────────────────
// Team-Mitglied als Bauherr eintragen: setzt bauherrId UND aktualisiert
// bauherr-Text auf den Namen, damit Export/Listen-Ansichten stimmig
// bleiben ohne extra JOIN auf Client-Seite.
async function openBauherrPicker() {
  if (!teamLoaded.value) await loadTeam();
  showBauherrPicker.value = true;
}

async function linkBauherr(memberId: string, memberName: string) {
  showBauherrPicker.value = false;
  if (!info.value) return;
  try {
    const n = encodeURIComponent(projectName.value);
    info.value = await api.patch<ProjectInfo>(`/projects/${n}`, {
      bauherrId: memberId,
      bauherr: memberName,
    });
  } catch {
    // Rueckgaengig: nichts zu tun, Server hat nicht geaendert.
  }
}
async function unlinkBauherr() {
  showBauherrPicker.value = false;
  if (!info.value) return;
  try {
    const n = encodeURIComponent(projectName.value);
    info.value = await api.patch<ProjectInfo>(`/projects/${n}`, { bauherrId: null });
  } catch {
    /* no-op */
  }
}

// ── Parent-Projekt setzen ────────────────────────────────
async function loadAllProjectsForPicker() {
  if (allProjectsLoaded.value) return;
  try {
    const projs = await api.get<{ id: string; name: string; parentId?: string | null }[]>("/projects");
    allProjectsForPicker.value = projs.map((p) => ({
      id: p.id,
      name: p.name,
      parentId: p.parentId ?? null,
    }));
    allProjectsLoaded.value = true;
  } catch {
    allProjectsForPicker.value = [];
  }
}

// Kandidaten fuer Parent: alle Projekte, aber NICHT das aktuelle (kein Self-
// Parent) und NICHT ein direktes Kind (offensichtliche 2-Ebenen-Zyklen).
// Tiefe Zyklen (A → B → C → A) sind theoretisch moeglich; das ist ein
// bekanntes Lueckenmodell und wird akzeptiert statt eine rekursive CTE-
// Pruefung aufzusetzen, die der Datenmenge nicht angemessen waere.
const parentCandidates = computed<ProjectSummary[]>(() => {
  if (!info.value) return [];
  const childIds = new Set(children.value.map((c) => c.id));
  return allProjectsForPicker.value.filter((p) => p.id !== info.value!.id && !childIds.has(p.id));
});

async function openParentPicker() {
  await loadAllProjectsForPicker();
  showParentPicker.value = true;
}
async function setParent(parentId: string | null) {
  showParentPicker.value = false;
  if (!info.value) return;
  try {
    const n = encodeURIComponent(projectName.value);
    info.value = await api.patch<ProjectInfo>(`/projects/${n}`, { parentId });
  } catch {
    /* no-op */
  }
}

// ── Kinder laden ─────────────────────────────────────────
async function loadChildren() {
  if (!info.value) return;
  try {
    const n = encodeURIComponent(projectName.value);
    children.value = await api.get<ChildProject[]>(`/projects/${n}/children`);
    childrenLoaded.value = true;
  } catch {
    children.value = [];
    childrenLoaded.value = true;
  }
}

// ── Dateien (Stufe 3b) ─────────────────────────────────────

// API liefert Ordner + Dateien gemischt — wir filtern auf echte DB-Files
// mit id (Ordner aus dem Filesystem haben keine id).
interface ApiFile {
  id?: string;
  name: string;
  type: "file" | "folder";
  size: number;
  modified: string;
  extension: string;
  analyzed?: boolean;
}

async function loadFiles() {
  const n = encodeURIComponent(projectName.value);
  try {
    const raw = await api.get<ApiFile[]>(`/files?project=${n}`);
    files.value = raw
      .filter((f) => f.type === "file" && !!f.id)
      .map((f) => ({
        id: String(f.id),
        name: f.name,
        size: f.size,
        modified: f.modified,
        extension: f.extension,
        analyzed: f.analyzed,
      }));
    filesLoaded.value = true;
  } catch {
    files.value = [];
    filesLoaded.value = true;
  }
}

async function openTab(t: Tab) {
  // Defensive: Zugriff ist Admin-only. Falls hier ein Non-Admin
  // programmatisch landet (Vue DevTools, URL-Hash, was auch immer),
  // verweigern wir und springen auf Uebersicht zurueck.
  if (t === "zugriff" && !isAdmin.value) {
    tab.value = "uebersicht";
    return;
  }
  tab.value = t;
  // URL-Query synchron halten, damit die NavRail-Projekt-Sidebar den aktiven
  // Tab spiegelt. replace() statt push() — kein History-Spam. Guard verhindert
  // Endlosschleife mit dem route.query.tab-Watcher.
  const wantQuery = t === "uebersicht" ? undefined : t;
  if ((route.query.tab ?? undefined) !== wantQuery) {
    void router.replace({ query: wantQuery ? { tab: wantQuery } : {} }).catch(() => {});
  }
  viewingNote.value = null;
  viewingFile.value = null;
  // Lazy-Load pro Tab — pro Tab max. einmal.
  if (t === "files" && !filesLoaded.value) await loadFiles();
  if (t === "team" && !teamLoaded.value) await loadTeam();
  if (t === "bautagebuch") {
    // Team brauchen wir fuer den Personal-Picker.
    if (!teamLoaded.value) await loadTeam();
    if (!bautagebuchLoaded.value) await loadBautagebuch();
  }
  if (t === "meetings") {
    // Team brauchen wir fuer den Teilnehmer-Picker.
    if (!teamLoaded.value) await loadTeam();
    if (!meetingsLoaded.value) await loadMeetings();
    // Vorlagen einmalig fuer den Apply-Dropdown
    if (meetingTemplates.value.length === 0) await loadMeetingTemplates();
  }
  if (t === "stunden") {
    if (!teamLoaded.value) await loadTeam();
    if (!timeLoaded.value) await loadTimeEntries();
  }
  if (t === "uebersicht") {
    if (!childrenLoaded.value) await loadChildren();
    if (!teamLoaded.value) await loadTeam();
  }
  if (t === "zugriff") {
    if (!accessLoaded.value) await loadAccess();
    if (!allUsersLoaded.value) await loadAllUsers();
  }
}

// ── Zugriff (Phase 3) ────────────────────────────────────
async function loadAccess() {
  try {
    const n = encodeURIComponent(projectName.value);
    accessList.value = await api.get<ProjectAccessEntry[]>(`/projects/${n}/access`);
    accessLoaded.value = true;
  } catch {
    accessList.value = [];
    accessLoaded.value = true;
  }
}

async function loadAllUsers() {
  try {
    allUsers.value = await api.get<AdminUserMini[]>("/admin/users");
    allUsersLoaded.value = true;
  } catch {
    allUsers.value = [];
    allUsersLoaded.value = true;
  }
}

// Kandidaten zum Hinzufuegen: alle, die noch nicht im accessList sind.
// Admins kriegen automatisch Zugriff via Query-Scoping (Phase 4) — wir
// blenden sie hier aus, damit man nicht denkt sie braeuchten einen Eintrag.
const accessCandidates = computed<AdminUserMini[]>(() => {
  const granted = new Set(accessList.value.map((a) => a.userId));
  return allUsers.value.filter((u) => u.role !== "admin" && !granted.has(u.id));
});

async function grantAccess() {
  if (!accessAddUserId.value || accessSaving.value) return;
  accessSaving.value = true;
  accessError.value = null;
  try {
    const n = encodeURIComponent(projectName.value);
    await api.post(`/projects/${n}/access`, { userId: accessAddUserId.value });
    accessAddUserId.value = "";
    await loadAccess();
  } catch (e) {
    accessError.value = e instanceof Error ? e.message : "Freigabe fehlgeschlagen";
  } finally {
    accessSaving.value = false;
  }
}

async function revokeAccess(userId: string) {
  if (!(await confirm({ message: "Freigabe wirklich entfernen?", confirmDanger: true }))) return;
  try {
    const n = encodeURIComponent(projectName.value);
    await api.delete(`/projects/${n}/access/${encodeURIComponent(userId)}`);
    await loadAccess();
  } catch (e) {
    accessError.value = e instanceof Error ? e.message : "Entfernen fehlgeschlagen";
  }
}

async function openFile(entry: FileEntry) {
  // Nur Text/Markdown inline anzeigen; alles andere -> Download.
  const textExts = ["md", "txt", "json", "csv", "yml", "yaml", "log", "ts", "js", "html", "css"];
  if (!textExts.includes(entry.extension.toLowerCase())) {
    window.location.href = downloadUrl(entry);
    return;
  }
  try {
    const resp = await api.get<{ path: string; content: string; filename: string }>(
      `/files/read?id=${encodeURIComponent(entry.id)}`,
    );
    viewingFile.value = entry;
    viewingFileContent.value = resp.content;
  } catch {
    viewingFileContent.value = "[Inhalt konnte nicht gelesen werden]";
    viewingFile.value = entry;
  }
}

async function deleteFile(entry: FileEntry) {
  if (!(await confirm({ message: `Datei "${entry.name}" wirklich loeschen?`, confirmDanger: true }))) return;
  try {
    await api.delete("/files", { id: entry.id });
    await Promise.all([loadFiles(), loadAll()]);
  } catch {
    uploadMsg.value = "Loeschen fehlgeschlagen";
    setTimeout(() => (uploadMsg.value = ""), 3000);
  }
}

function downloadUrl(entry: FileEntry): string {
  const token = localStorage.getItem("patio-token");
  const base = `/api/files/download?id=${encodeURIComponent(entry.id)}`;
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (tab.value === "files") dragging.value = true;
}
function onDragLeave() {
  dragging.value = false;
}
async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragging.value = false;
  if (tab.value !== "files") return;
  if (e.dataTransfer?.files?.length) await uploadFiles(e.dataTransfer.files);
}
// Versteckter file-Input + Ref-Trigger statt label-wrapping. Letzteres ist
// fehleranfaellig wenn der Klick auf einem inneren SVG/BIcon landet —
// Click-Events von SVG-Children propagieren nicht zuverlaessig zum
// umschliessenden <label>. Mit explizitem Button + ref.click() ist das
// rock-solid in allen Browsern.
const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerFileUpload() {
  if (uploading.value) return;
  fileInputRef.value?.click();
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    void uploadFiles(input.files);
    input.value = "";
  }
}

async function uploadFiles(fileList: FileList) {
  if (uploading.value) return;
  uploading.value = true;
  uploadMsg.value = "";
  uploadError.value = "";
  const formData = new FormData();
  // Projekt-Zuweisung automatisch — das ist der Zweck des projekt-scoped Tabs.
  formData.append("project", projectName.value);
  for (const f of fileList) formData.append("files", f);

  try {
    const token = localStorage.getItem("patio-token");
    const res = await fetch("/api/files/upload", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = (await res.json()) as {
      success?: boolean;
      uploaded?: unknown[];
      error?: string;
      partial?: boolean;
      failures?: Array<{ filename: string; error: string }>;
    };

    if (!res.ok || !data.success) {
      // HTTP-Fehler oder Backend hat success=false geliefert. Echte
      // Fehlermeldung anzeigen statt "Upload fehlgeschlagen".
      const detail = data.failures?.[0]?.error ?? data.error ?? `HTTP ${res.status} ${res.statusText}`;
      uploadError.value = `Upload fehlgeschlagen: ${detail}`;
      return;
    }

    const count = data.uploaded?.length ?? 0;
    if (count === 0) {
      uploadError.value = "Datei wurde nicht gespeichert (Backend hat kein File angenommen)";
      return;
    }
    uploadMsg.value = `${count} Datei${count === 1 ? "" : "en"} hochgeladen`;
    if (data.partial && data.failures && data.failures.length > 0) {
      // Teil-Erfolg: zusaetzlich anzeigen was fehlgeschlagen ist.
      uploadError.value = `Fehler bei ${data.failures.length} Datei(en): ${data.failures[0]!.error}`;
    }
    await Promise.all([loadFiles(), loadAll()]);
  } catch (e) {
    uploadError.value = `Upload fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    uploading.value = false;
    setTimeout(() => {
      uploadMsg.value = "";
    }, 3000);
    setTimeout(() => {
      uploadError.value = "";
    }, 8000);
  }
}

function formatSize(bytes: number) {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileDate(iso: string) {
  if (!iso) return "–";
  const d = new Date(iso);
  return formatDate(d);
}

const viewingFileIsMarkdown = computed(() =>
  viewingFile.value ? viewingFile.value.extension.toLowerCase() === "md" : false,
);

// ── Team (Stufe 3c) ────────────────────────────────────────
//
// Datenmodell: team_members.project_id ist ein einzelner FK — ein Mitglied
// gehoert zu MAX EINEM Projekt. "Zuordnen" = projectId auf info.id setzen;
// "Entfernen" = projectId auf null (Mitglied bleibt global erhalten).
async function loadTeam() {
  try {
    allTeam.value = await api.get<TeamMember[]>("/team");
    teamLoaded.value = true;
  } catch {
    allTeam.value = [];
    teamLoaded.value = true;
  }
}

// Migration 006: M:N-Zuordnung ueber projects-Array im Member.
// projects enthaelt { id, name, projectRole } fuer jedes zugeordnete Projekt.
const projectTeam = computed<TeamMember[]>(() => {
  if (!info.value) return [];
  return allTeam.value.filter((m) => m.projects?.some((p) => p.id === info.value!.id));
});

// Kandidaten zum Zuordnen: Mitglieder die diesem Projekt NOCH NICHT zugeordnet
// sind. Ein Mitglied kann jetzt auf vielen Projekten sein — also kein Umzug,
// sondern ein Dazu-Legen.
const assignableTeam = computed<TeamMember[]>(() => {
  if (!info.value) return [];
  return allTeam.value.filter((m) => !m.projects?.some((p) => p.id === info.value!.id));
});

async function assignExisting() {
  if (!assignMemberId.value || !info.value || teamAssigning.value) return;
  teamAssigning.value = true;
  teamError.value = null;
  try {
    // Junction-Endpoint (Migration 006) — idempotent, erlaubt parallel mehrere
    // Projekt-Zuordnungen pro Mitglied.
    await api.post(`/team/${encodeURIComponent(assignMemberId.value)}/projects`, {
      projectId: info.value.id,
    });
    assignMemberId.value = "";
    await loadTeam();
  } catch (e) {
    teamError.value = e instanceof Error ? e.message : "Zuordnung fehlgeschlagen";
  } finally {
    teamAssigning.value = false;
  }
}

async function createAndAssign() {
  const name = newMemberName.value.trim();
  if (!name || !info.value || teamAssigning.value) return;
  teamAssigning.value = true;
  teamError.value = null;
  try {
    // Zweistufig: anlegen, dann via Junction zuordnen. POST /team legt global
    // an (keine Projekt-Verknuepfung); POST /team/:id/projects macht die
    // projektspezifische Zuordnung.
    const created = await api.post<TeamMember>("/team", {
      name,
      role: newMemberRole.value.trim() || undefined,
    });
    await api.post(`/team/${encodeURIComponent(created.id)}/projects`, {
      projectId: info.value.id,
    });
    newMemberName.value = "";
    newMemberRole.value = "";
    showNewMemberForm.value = false;
    await loadTeam();
  } catch (e) {
    teamError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  } finally {
    teamAssigning.value = false;
  }
}

async function unassignMember(m: TeamMember) {
  if (teamAssigning.value || !info.value) return;
  if (
    !(await confirm({
      message: `"${m.name}" aus diesem Projekt entfernen? (Mitglied bleibt im Team-Verzeichnis.)`,
      confirmDanger: true,
    }))
  )
    return;
  teamAssigning.value = true;
  teamError.value = null;
  try {
    // Junction-Delete: Mitglied bleibt erhalten, nur die Zuordnung zu
    // diesem einen Projekt wird aufgehoben (andere Zuordnungen bleiben).
    await api.delete(`/team/${encodeURIComponent(m.id)}/projects/${encodeURIComponent(info.value.id)}`);
    await loadTeam();
  } catch (e) {
    teamError.value = e instanceof Error ? e.message : "Entfernen fehlgeschlagen";
  } finally {
    teamAssigning.value = false;
  }
}

function initial(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function mapsLink(standort: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(standort)}`;
}

// ── Quick-Add (Uebersicht) ───────────────────────────────
// Kleine Inline-Inputs direkt in den Uebersichts-Cards, damit man ohne
// Tab-Wechsel Aufgaben/Termine hinzufuegen kann.
const quickTaskText = ref("");
const quickTerminDate = ref("");
const quickTerminText = ref("");
async function quickAddTask() {
  const txt = quickTaskText.value.trim();
  if (!txt) return;
  const n = encodeURIComponent(projectName.value);
  await api.post(`/projects/${n}/tasks`, { text: txt });
  quickTaskText.value = "";
  await loadAll();
}
async function quickAddTermin() {
  if (!quickTerminDate.value || !quickTerminText.value.trim()) return;
  const n = encodeURIComponent(projectName.value);
  await api.post(`/projects/${n}/termine`, {
    datum: quickTerminDate.value,
    text: quickTerminText.value.trim(),
  });
  quickTerminDate.value = "";
  quickTerminText.value = "";
  await loadAll();
}

// ── Uebersicht: Top-Daten aus bestehenden Listen ──────────
// Kein neuer Fetch noetig — tasks/termine sind schon geladen.
const openTasksTop = computed(() => tasks.value.filter((t) => t.status !== "done").slice(0, 5));

// Fortschritt-Berechnung (0-100%)
// Honorargewichteter Phasenfortschritt (aus /phases). Ersetzt die frühere
// Zeit-Heuristik (verstrichene Zeit), die dem Phasen-Tab widersprach.
const phaseOverall = ref<number | null>(null);
const projectProgress = computed(() => phaseOverall.value);

// Nächster Termin (erster upcoming)
const nextTermin = computed(() => {
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    [...termine.value].filter((t) => t.datum >= todayIso).sort((a, b) => a.datum.localeCompare(b.datum))[0] ?? null
  );
});

// Formatierung: "12.02.2026"
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Formatierung: "€ 1 142 800"
function fmtEur(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return "€ " + Math.round(amount).toLocaleString("de-AT");
}

// Offene Aufgaben sortiert nach Priorität (hoch zuerst)
const openTasksSorted = computed(() => {
  const prio: Record<string, number> = { hoch: 0, mittel: 1, niedrig: 2 };
  return tasks.value
    .filter((t) => t.status !== "done")
    .sort((a, b) => (prio[a.priority ?? "mittel"] ?? 1) - (prio[b.priority ?? "mittel"] ?? 1))
    .slice(0, 5);
});

const upcomingTermine = computed(() => {
  const todayIso = new Date().toISOString().slice(0, 10);
  return [...termine.value]
    .filter((t) => t.datum >= todayIso)
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .slice(0, 3);
});

// Beschreibung hat auch inline-edit — selbe Mechanik wie Stammdaten,
// aber mit textarea statt input (mehrzeilig). Wir missbrauchen dafuer das
// existierende draftValue/editingField-Modell mit key='description'.
function startEditDescription() {
  startEdit("description");
}

// ── Derived ────────────────────────────────────────────────

const statusLabel = computed(() => {
  const s = info.value?.status ?? "aktiv";
  return s[0]?.toUpperCase() + s.slice(1);
});

/** Fuer die Stat-Zeile im Hero: zeigt ob Stammdaten-Vervollstaendigung faellig ist. */
const emptyStammCount = computed(() => {
  if (!info.value) return 0;
  const keys: (keyof ProjectInfo)[] = ["projektnummer", "bauherr", "standort", "projektart", "nutzung"];
  return keys.filter((k) => !info.value![k]).length;
});

// ── Bautagebuch (Migration 011) ───────────────────────────────────────────
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function formatBautagDate(iso: string): string {
  // YYYY-MM-DD → "Mi 24.04.2024"
  const d = new Date(iso + "T00:00:00");
  const wochentage = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return `${wochentage[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function weatherLabel(w: WeatherKey | null | undefined): string {
  if (!w) return "·";
  return WEATHER_OPTIONS.find((o) => o.value === w)?.label ?? "·";
}

async function loadBautagebuch() {
  try {
    const n = encodeURIComponent(projectName.value);
    bautagebuchEntries.value = await api.get<BautagebuchEntry[]>(`/projects/${n}/bautagebuch?limit=60`);
    bautagebuchLoaded.value = true;
    // Wenn nichts ausgewählt: Heute, falls Eintrag vorhanden — sonst neu für heute.
    if (!bautagebuchSelectedDate.value) {
      const today = todayIso();
      const todayEntry = bautagebuchEntries.value.find((e) => e.date === today);
      if (todayEntry) selectBautagebuch(today);
    } else {
      // re-sync draft if still selected
      const sel = bautagebuchEntries.value.find((e) => e.date === bautagebuchSelectedDate.value);
      if (sel) draftFromEntry(sel);
    }
  } catch (e) {
    bautagebuchError.value = e instanceof Error ? e.message : "Bautagebuch nicht ladbar (DB-Modus erforderlich)";
    bautagebuchLoaded.value = true;
  }
}

function emptyDraft(): NonNullable<typeof bautagebuchDraft.value> {
  return {
    weather: "",
    temperatureMin: "",
    temperatureMax: "",
    personnelIds: [],
    personnelFree: [],
    machines: "",
    activities: "",
    incidents: "",
  };
}

function draftFromEntry(e: BautagebuchEntry) {
  const memberIds = e.personnel.filter((p) => p.memberId).map((p) => p.memberId as string);
  const freeNames = e.personnel.filter((p) => !p.memberId).map((p) => p.name);
  bautagebuchDraft.value = {
    weather: e.weather ?? "",
    temperatureMin: e.temperatureMin === null ? "" : String(e.temperatureMin),
    temperatureMax: e.temperatureMax === null ? "" : String(e.temperatureMax),
    personnelIds: memberIds,
    personnelFree: freeNames,
    machines: e.machines ?? "",
    activities: e.activities ?? "",
    incidents: e.incidents ?? "",
  };
}

function selectBautagebuch(date: string) {
  bautagebuchSelectedDate.value = date;
  bautagebuchError.value = null;
  const e = bautagebuchEntries.value.find((x) => x.date === date);
  if (e) {
    draftFromEntry(e);
  } else {
    bautagebuchDraft.value = emptyDraft();
  }
}

function newBautagebuchToday() {
  bautagebuchSelectedDate.value = todayIso();
  bautagebuchError.value = null;
  const existing = bautagebuchEntries.value.find((x) => x.date === bautagebuchSelectedDate.value);
  if (existing) {
    draftFromEntry(existing);
  } else {
    bautagebuchDraft.value = emptyDraft();
  }
}

function newBautagebuchPickDate(date: string) {
  if (!date) return;
  bautagebuchSelectedDate.value = date;
  bautagebuchError.value = null;
  const existing = bautagebuchEntries.value.find((x) => x.date === date);
  if (existing) draftFromEntry(existing);
  else bautagebuchDraft.value = emptyDraft();
}

async function saveBautagebuch() {
  if (!bautagebuchSelectedDate.value || !bautagebuchDraft.value || bautagebuchSaving.value) return;
  bautagebuchSaving.value = true;
  bautagebuchError.value = null;
  try {
    const d = bautagebuchDraft.value;
    // Personnel: kombinieren — zuerst zugeordnete Member (mit Name aus allTeam-Lookup),
    // dann Freitext-Eintraege.
    const memberLookup = new Map(allTeam.value.map((m) => [m.id, m.name]));
    const personnel: BautagebuchPersonnel[] = [
      ...d.personnelIds.map((id) => ({ memberId: id, name: memberLookup.get(id) ?? "Unbekannt" })),
      ...d.personnelFree.filter((n) => n.trim()).map((name) => ({ name })),
    ];

    const body = {
      weather: d.weather || null,
      temperatureMin: d.temperatureMin === "" ? null : Number(d.temperatureMin),
      temperatureMax: d.temperatureMax === "" ? null : Number(d.temperatureMax),
      personnel,
      machines: d.machines.trim() || null,
      activities: d.activities.trim() || null,
      incidents: d.incidents.trim() || null,
    };

    const n = encodeURIComponent(projectName.value);
    const date = bautagebuchSelectedDate.value;
    const saved = await api.put<BautagebuchEntry>(`/projects/${n}/bautagebuch/${date}`, body);

    // Liste in-place aktualisieren statt komplett neu zu laden.
    const idx = bautagebuchEntries.value.findIndex((e) => e.date === date);
    if (idx >= 0) bautagebuchEntries.value[idx] = saved;
    else {
      bautagebuchEntries.value.unshift(saved);
      bautagebuchEntries.value.sort((a, b) => b.date.localeCompare(a.date));
    }
    draftFromEntry(saved);
  } catch (e) {
    bautagebuchError.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    bautagebuchSaving.value = false;
  }
}

// Tagesnavigation im Bautagebuch — direction: -1 = einen Tag zurueck,
// +1 = einen Tag vor. Setzt das selectedDate, lädt vorhandenen Eintrag
// oder leert den Draft (User kann gleich neu eintragen).
function navigateBautagebuch(direction: -1 | 1) {
  if (!bautagebuchSelectedDate.value) return;
  const d = new Date(bautagebuchSelectedDate.value + "T00:00:00");
  d.setDate(d.getDate() + direction);
  // Zurueck zu YYYY-MM-DD — keine Timezone-Probleme weil wir local-Date
  // verwenden.
  const newDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  selectBautagebuch(newDate);
}

async function deleteBautagebuch() {
  if (!bautagebuchSelectedDate.value || !(await confirm({ message: "Eintrag wirklich löschen?", confirmDanger: true })))
    return;
  try {
    const n = encodeURIComponent(projectName.value);
    const date = bautagebuchSelectedDate.value;
    await api.delete(`/projects/${n}/bautagebuch/${date}`);
    bautagebuchEntries.value = bautagebuchEntries.value.filter((e) => e.date !== date);
    bautagebuchSelectedDate.value = "";
    bautagebuchDraft.value = null;
  } catch (e) {
    bautagebuchError.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

// ── Meetings (Migration 012) ─────────────────────────────────────────────
function emptyMeetingDraft(): MeetingDraft {
  return {
    id: null,
    date: todayIso(),
    startTime: "",
    endTime: "",
    title: "",
    meetingType: "",
    location: "",
    attendeeIds: [],
    attendeesExternal: [],
    agenda: "",
    minutes: "",
    decisions: "",
    actionItems: [],
    nextMeetingDate: "",
  };
}

function meetingDraftFrom(m: Meeting): MeetingDraft {
  return {
    id: m.id,
    date: m.date,
    startTime: m.startTime ?? "",
    endTime: m.endTime ?? "",
    title: m.title,
    meetingType: m.meetingType ?? "",
    location: m.location ?? "",
    attendeeIds: [...m.attendeeIds],
    attendeesExternal: [...m.attendeesExternal],
    agenda: m.agenda ?? "",
    minutes: m.minutes ?? "",
    decisions: m.decisions ?? "",
    actionItems: m.actionItems.map((a) => ({ ...a })),
    nextMeetingDate: m.nextMeetingDate ?? "",
  };
}

async function loadMeetings() {
  try {
    const n = encodeURIComponent(projectName.value);
    meetings.value = await api.get<Meeting[]>(`/projects/${n}/meetings?limit=100`);
    meetingsLoaded.value = true;
  } catch (e) {
    meetingError.value = e instanceof Error ? e.message : "Meetings nicht ladbar (DB-Modus erforderlich)";
    meetingsLoaded.value = true;
  }
}

async function newMeeting() {
  meetingError.value = null;
  meetingDraft.value = emptyMeetingDraft();
  selectedMeetingTemplateId.value = "";
  // Standardvorlage automatisch anwenden, falls vorhanden
  const defaultTemplate = meetingTemplates.value.find((t) => t.isDefault);
  if (defaultTemplate) {
    selectedMeetingTemplateId.value = defaultTemplate.id;
    await applyMeetingTemplate();
  }
}

// ── Word-Export (Phase 6d) ────────────────────────────────────────────────
// Helper: GET zur API mit Auth-Header, Response als Blob herunterladen.
// Wenn das Backend einen Fehler liefert, parsen wir die JSON-Error-Message
// und zeigen einen Alert.
async function downloadDocx(url: string, fallbackFilename: string) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${localStorage.getItem("patio-token") ?? ""}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Export fehlgeschlagen" }));
      await confirm({
        message: err.error || `HTTP ${res.status}`,
        confirmLabel: "OK",
        cancelLabel: "",
      });
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m ? m[1] : fallbackFilename;
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename!;
    a.click();
    URL.revokeObjectURL(objUrl);
  } catch (e) {
    await confirm({
      message: e instanceof Error ? e.message : "Export fehlgeschlagen",
      confirmLabel: "OK",
      cancelLabel: "",
    });
  }
}

async function exportMeetingDocx(id: string) {
  await downloadDocx(`/api/exports/meeting/${id}`, `Meeting-${id}.docx`);
}
async function exportBautagebuchDocx(id: string) {
  await downloadDocx(`/api/exports/bautagebuch/${id}`, `Bautagebuch-${id}.docx`);
}
async function exportTimeEntriesDocx() {
  const project = encodeURIComponent(projectName.value);
  await downloadDocx(`/api/exports/time-entries?project=${project}`, `Stundenzettel-${projectName.value}.docx`);
}
async function exportProjectSummaryDocx() {
  const n = encodeURIComponent(projectName.value);
  await downloadDocx(`/api/exports/project/${n}/summary`, `Projekt-${projectName.value}.docx`);
}

// ── Vorlagen (Phase 6c) ──────────────────────────────────────────────────
// User waehlt eine Meeting-Vorlage → Backend rendert mit Live-Daten
// (Projekt, Bauherr, Datum, Branding) → Inhalt landet im "minutes"-Feld.
interface MeetingTemplateSummary {
  id: string;
  kind: string;
  name: string;
  isDefault: boolean;
}
const meetingTemplates = ref<MeetingTemplateSummary[]>([]);
const selectedMeetingTemplateId = ref<string>("");

async function loadMeetingTemplates() {
  try {
    meetingTemplates.value = await api.get<MeetingTemplateSummary[]>("/templates?kind=meeting");
  } catch {
    meetingTemplates.value = [];
  }
}

async function applyMeetingTemplate() {
  if (!selectedMeetingTemplateId.value || !meetingDraft.value) return;
  try {
    const url = `/templates/${selectedMeetingTemplateId.value}/render?project=${encodeURIComponent(projectName.value)}`;
    const res = await api.get<{ rendered: string }>(url);
    const parts = res.rendered.split(/\n---\n/);
    if (parts.length >= 2) {
      meetingDraft.value.agenda = parts[0].trim();
      meetingDraft.value.minutes = parts.slice(1).join("\n---\n").trim();
    } else {
      meetingDraft.value.agenda = res.rendered.trim();
      meetingDraft.value.minutes = "";
    }
  } catch {
    /* fail silently */
  }
}

function selectMeeting(m: Meeting) {
  meetingError.value = null;
  meetingDraft.value = meetingDraftFrom(m);
}

function cancelMeetingEdit() {
  meetingDraft.value = null;
  meetingError.value = null;
}

function addActionItem() {
  if (!meetingDraft.value || !newActionItemText.value.trim()) return;
  meetingDraft.value.actionItems.push({
    text: newActionItemText.value.trim(),
    done: false,
  });
  newActionItemText.value = "";
}

function removeActionItem(idx: number) {
  if (!meetingDraft.value) return;
  meetingDraft.value.actionItems.splice(idx, 1);
}

// Wandelt ein Action-Item in eine echte Task um. Workflow:
//   1. Meeting muss schon gespeichert sein (sonst gibts keine ID).
//   2. POST /tasks mit text + project + assigneeId + faellig.
//   3. PATCH /meetings/:id mit aktualisiertem actionItems-Array
//      (taskId nachgepflegt).
//   4. UI re-rendert: aus Button wird "Aufgabe"-Indicator.
async function convertActionItemToTask(idx: number) {
  if (!meetingDraft.value || !meetingDraft.value.id) {
    convertError.value = "Meeting erst speichern, dann Action-Items als Aufgaben anlegen.";
    return;
  }
  const item = meetingDraft.value.actionItems[idx];
  if (!item || !item.text.trim() || item.taskId) return;

  convertingActionIdx.value = idx;
  convertError.value = null;
  try {
    // 1) Task anlegen via /tasks (gibt die volle Task mit id zurueck —
    //    /projects/:name/tasks gibt nur {ok:true}, taugt fuer das
    //    Backlinking nicht). Backend resolvt das Projekt aus dem
    //    project-Feld.
    const task = await api.post<{ id: string }>("/tasks", {
      text: item.text.trim(),
      project: projectName.value,
      assigneeId: item.assigneeId ?? null,
      date: item.dueDate ?? null,
    });
    // 2) taskId im action_items-Array nachpflegen
    item.taskId = task.id;
    // Komplettes actionItems-Array zurueck schreiben — Backend persistiert
    // dann das ganze JSONB-Feld (Patch ist atomar).
    await api.patch(`/meetings/${meetingDraft.value.id}`, {
      actionItems: meetingDraft.value.actionItems.map((a) => ({ ...a })),
    });
    // 3) Tasks-Liste lokal aktualisieren — sonst sieht User die neue
    //    Aufgabe erst beim naechsten Page-Reload (loadAll wird nur einmal
    //    am Mount aufgerufen). GET /projects/:name/tasks ist billig.
    try {
      const n = encodeURIComponent(projectName.value);
      const refreshed = await api.get<Task[]>(`/projects/${n}/tasks`);
      tasks.value = refreshed;
    } catch {
      /* Refresh-Fehler ignorieren — der Task wurde trotzdem angelegt,
         der User sieht ihn beim naechsten Page-Reload. */
    }
  } catch (e) {
    item.taskId = undefined; // Rollback im Frontend
    convertError.value = e instanceof Error ? e.message : "Anlegen fehlgeschlagen";
  } finally {
    convertingActionIdx.value = null;
  }
}

async function saveMeeting() {
  if (!meetingDraft.value || meetingSaving.value) return;
  if (!meetingDraft.value.title.trim()) {
    meetingError.value = "Titel ist erforderlich";
    return;
  }
  if (!meetingDraft.value.date) {
    meetingError.value = "Datum ist erforderlich";
    return;
  }

  meetingSaving.value = true;
  meetingError.value = null;
  try {
    const d = meetingDraft.value;
    const body = {
      date: d.date,
      title: d.title.trim(),
      startTime: d.startTime || null,
      endTime: d.endTime || null,
      meetingType: d.meetingType || null,
      location: d.location.trim() || null,
      attendeeIds: d.attendeeIds,
      attendeesExternal: d.attendeesExternal.filter((s) => s.trim()),
      agenda: d.agenda.trim() || null,
      minutes: d.minutes.trim() || null,
      decisions: d.decisions.trim() || null,
      actionItems: d.actionItems.filter((a) => a.text.trim()),
      nextMeetingDate: d.nextMeetingDate || null,
    };

    let saved: Meeting;
    if (d.id) {
      saved = await api.patch<Meeting>(`/meetings/${d.id}`, body);
      const idx = meetings.value.findIndex((m) => m.id === d.id);
      if (idx >= 0) meetings.value[idx] = saved;
    } else {
      const n = encodeURIComponent(projectName.value);
      saved = await api.post<Meeting>(`/projects/${n}/meetings`, body);
      meetings.value.unshift(saved);
      // Sortieren nach Datum (desc) + Startzeit (desc)
      meetings.value.sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return (b.startTime ?? "").localeCompare(a.startTime ?? "");
      });
    }
    meetingDraft.value = meetingDraftFrom(saved);
  } catch (e) {
    meetingError.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    meetingSaving.value = false;
  }
}

// ── Stunden (Migration 014) ─────────────────────────────────────────────
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parser fuer flexible Zeit-Eingabe. Akzeptiert:
 *   "8"    → "08:00"
 *   "8:30" → "08:30"
 *   "830"  → "08:30"
 *   "0830" → "08:30"
 *   "08:30" → "08:30"
 *   leer / nicht-parsbar → null
 *  Damit kann der User schnell tippen statt nur den Picker zu nutzen. */
function parseTimeInput(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  // Schon im Format H:MM oder HH:MM
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
    return null;
  }
  // Nur Stunde: "8" → "08:00"
  m = t.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
    return null;
  }
  // 4 Ziffern "0830" → "08:30"
  m = t.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return `${m[1]}:${m[2]}`;
    return null;
  }
  // 3 Ziffern "830" → "08:30"
  m = t.match(/^(\d)(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return `0${m[1]}:${m[2]}`;
    return null;
  }
  return null;
}

/** Differenz in Minuten zwischen zwei HH:MM-Strings. End < Start wird als
 *  Schicht ueber Mitternacht interpretiert (z.B. 22:00–02:00 = 4h). */
function timeDiffMinutes(start: string | null, end: string | null): number | null {
  const s = parseTimeInput(start);
  const e = parseTimeInput(end);
  if (!s || !e) return null;
  const [sH, sM] = s.split(":").map(Number);
  const [eH, eM] = e.split(":").map(Number);
  const startMin = sH * 60 + sM;
  let endMin = eH * 60 + eM;
  if (endMin < startMin) endMin += 24 * 60;
  return endMin - startMin;
}

/** Computed: bei vorhandener Beginn+Ende → Stunden minus Pause.
 *  null wenn nicht beide parsbar — UI laesst dann das hours-Field
 *  fuer manuelle Eingabe offen. */
const computedTimeHours = computed(() => {
  if (!timeDraft.value) return null;
  const diff = timeDiffMinutes(timeDraft.value.startTime, timeDraft.value.endTime);
  if (diff === null) return null;
  const breakMin = Number(timeDraft.value.breakMinutes) || 0;
  const totalMin = Math.max(0, diff - breakMin);
  return totalMin / 60;
});

// Watcher: schreibt automatisch in draft.hours sobald Beginn+Ende
// parsbar sind. User kann hours danach manuell ueberschreiben — der
// naechste Time-Change ueberschreibt's wieder. Klare Regel: wer Zeiten
// eingibt, bekommt Auto-Compute.
watch(computedTimeHours, (val) => {
  if (val !== null && timeDraft.value) {
    timeDraft.value.hours = val.toFixed(2);
  }
});

// onBlur-Handler: normalisieren der Zeit-Inputs ("8" → "08:00").
function normalizeStartTime() {
  if (!timeDraft.value) return;
  const n = parseTimeInput(timeDraft.value.startTime);
  if (n) timeDraft.value.startTime = n;
}
function normalizeEndTime() {
  if (!timeDraft.value) return;
  const n = parseTimeInput(timeDraft.value.endTime);
  if (n) timeDraft.value.endTime = n;
}

function emptyTimeDraft(): TimeDraft {
  return {
    id: null,
    date: todayIsoDate(),
    memberId: null,
    memberName: "",
    hours: "",
    startTime: "",
    endTime: "",
    breakMinutes: "0",
    activity: "",
    notes: "",
  };
}
function timeDraftFrom(e: TimeEntry): TimeDraft {
  return {
    id: e.id,
    date: e.date,
    memberId: e.memberId,
    memberName: e.memberName ?? "",
    hours: String(e.hours),
    startTime: e.startTime ?? "",
    endTime: e.endTime ?? "",
    breakMinutes: String(e.breakMinutes),
    activity: e.activity ?? "",
    notes: e.notes ?? "",
  };
}

async function loadTimeEntries() {
  try {
    const n = encodeURIComponent(projectName.value);
    timeEntries.value = await api.get<TimeEntry[]>(`/projects/${n}/time-entries?limit=200`);
    // Summary fuer den ganzen verfuegbaren Zeitraum (Default: alles)
    const sum = await api.get<{ groupBy: string; data: TimeSummaryRow[] }>(
      `/projects/${n}/time-entries/summary?groupBy=member`,
    );
    timeSummary.value = sum.data;
    timeLoaded.value = true;
  } catch (e) {
    timeError.value = e instanceof Error ? e.message : "Stunden nicht ladbar (DB-Modus erforderlich)";
    timeLoaded.value = true;
  }
}

const timeTotalHours = computed(() => timeEntries.value.reduce((s, e) => s + e.hours, 0));

function newTimeEntry() {
  timeError.value = null;
  timeDraft.value = emptyTimeDraft();
}
function selectTimeEntry(e: TimeEntry) {
  timeError.value = null;
  timeDraft.value = timeDraftFrom(e);
}
function cancelTimeEdit() {
  timeDraft.value = null;
  timeError.value = null;
}

// Wenn User ein Team-Mitglied im Dropdown auswaehlt, automatisch
// memberName aus dem allTeam-Lookup mitnehmen.
function onTimeMemberChange(memberId: string) {
  if (!timeDraft.value) return;
  if (!memberId) {
    timeDraft.value.memberId = null;
    return;
  }
  const m = allTeam.value.find((x) => x.id === memberId);
  timeDraft.value.memberId = memberId;
  if (m) timeDraft.value.memberName = m.name;
}

async function saveTimeEntry() {
  if (!timeDraft.value || timeSaving.value) return;
  const d = timeDraft.value;
  const hours = Number(d.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    timeError.value = "Stundenanzahl muss zwischen 0 und 24 liegen";
    return;
  }
  if (!d.date) {
    timeError.value = "Datum ist erforderlich";
    return;
  }
  if (!d.memberName.trim()) {
    timeError.value = "Mitarbeiter ist erforderlich";
    return;
  }

  // Zeit-Felder normalisieren falls User direkt Save geklickt hat ohne
  // vorher onBlur zu triggern (z.B. via Tab+Enter). "8" → "08:00".
  // Wenn nicht parsbar → Backend wirft 400, dann sehen wir's im timeError.
  const normalizedStart = parseTimeInput(d.startTime) ?? d.startTime ?? "";
  const normalizedEnd = parseTimeInput(d.endTime) ?? d.endTime ?? "";

  timeSaving.value = true;
  timeError.value = null;
  try {
    const body = {
      date: d.date,
      hours,
      memberId: d.memberId || null,
      memberName: d.memberName.trim() || null,
      startTime: normalizedStart || null,
      endTime: normalizedEnd || null,
      breakMinutes: Number(d.breakMinutes) || 0,
      activity: d.activity.trim() || null,
      notes: d.notes.trim() || null,
    };
    let saved: TimeEntry;
    if (d.id) {
      saved = await api.patch<TimeEntry>(`/time-entries/${d.id}`, body);
      const idx = timeEntries.value.findIndex((e) => e.id === d.id);
      if (idx >= 0) timeEntries.value[idx] = saved;
    } else {
      const n = encodeURIComponent(projectName.value);
      saved = await api.post<TimeEntry>(`/projects/${n}/time-entries`, body);
      timeEntries.value.unshift(saved);
      timeEntries.value.sort((a, b) => b.date.localeCompare(a.date));
    }
    // Summary refresh — neuer Eintrag aendert das Aggregat.
    const n = encodeURIComponent(projectName.value);
    const sum = await api.get<{ data: TimeSummaryRow[] }>(`/projects/${n}/time-entries/summary?groupBy=member`);
    timeSummary.value = sum.data;
    timeDraft.value = timeDraftFrom(saved);
  } catch (e) {
    timeError.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  } finally {
    timeSaving.value = false;
  }
}

async function deleteTimeEntry() {
  if (!timeDraft.value?.id || !(await confirm({ message: "Stunden-Eintrag wirklich löschen?", confirmDanger: true })))
    return;
  try {
    const id = timeDraft.value.id;
    await api.delete(`/time-entries/${id}`);
    timeEntries.value = timeEntries.value.filter((e) => e.id !== id);
    timeDraft.value = null;
    // Summary refresh
    const n = encodeURIComponent(projectName.value);
    const sum = await api.get<{ data: TimeSummaryRow[] }>(`/projects/${n}/time-entries/summary?groupBy=member`);
    timeSummary.value = sum.data;
  } catch (e) {
    timeError.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

async function deleteMeeting() {
  if (!meetingDraft.value?.id || !(await confirm({ message: "Meeting wirklich löschen?", confirmDanger: true })))
    return;
  try {
    const id = meetingDraft.value.id;
    await api.delete(`/meetings/${id}`);
    meetings.value = meetings.value.filter((m) => m.id !== id);
    meetingDraft.value = null;
  } catch (e) {
    meetingError.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}
</script>

<template>
  <div class="proj-detail-page">
    <!-- Breadcrumb (Referenz: Projekte › Name) -->
    <nav class="pd-crumbs">
      <button class="pd-crumb-link" @click="router.push('/projects')">Projekte</button>
      <BIcon name="arrowRight" :size="13" class="pd-crumb-sep" />
      <span class="pd-crumb-here">{{ info?.name ?? "…" }}</span>
    </nav>

    <!-- ═══ Projekt-Kopf (ap-phead) ══════════════════════════════ -->
    <div v-if="info" class="ap-phead">
      <!-- Linke Spalte -->
      <div class="ap-phead-l">
        <!-- Breadcrumb / Eyebrow -->
        <div class="hero-eyebrow" style="margin-bottom: 6px">
          <span v-if="info.parentName">
            <router-link :to="`/projects/${encodeURIComponent(info.parentName)}`" class="parent-link">
              {{ info.parentName }}
            </router-link>
            <span style="color: var(--color-text-faint)"> / </span>
          </span>
          <span v-else>PROJEKT</span>
          <span v-if="info.projektnummer" style="color: var(--color-text-faint)"> — {{ info.projektnummer }}</span>
        </div>

        <!-- Badges: Phase + Nutzung -->
        <div class="pt-row" style="gap: 6px; margin-bottom: 8px">
          <button v-if="info.phase" class="pt-badge pt-badge--warning pill-clickable" @click="startEdit('phase')">
            {{ info.phase }}
          </button>
          <button v-else class="pt-badge pill-clickable" @click="startEdit('phase')">Phase setzen</button>
          <span v-if="info.nutzung" class="pt-badge">{{ info.nutzung }}</span>
          <span v-if="info.projektart" class="pt-badge">{{ info.projektart }}</span>
        </div>

        <!-- Titel -->
        <h1 class="ap-ptitle">{{ info.name }}</h1>

        <!-- Meta-Zeile -->
        <div class="ap-pmeta">
          <span v-if="info.bauherrName || info.bauherr">
            Bauherr <strong>{{ info.bauherrName || info.bauherr }}</strong>
          </span>
          <span v-if="(info.bauherrName || info.bauherr) && info.standort" class="sep"></span>
          <a v-if="info.standort" :href="mapsLink(info.standort)" target="_blank" rel="noopener" class="maps-link">
            {{ info.standort }}
          </a>
          <span v-if="info.projektnummer && info.standort" class="sep"></span>
          <span v-if="info.projektnummer">Nr. {{ info.projektnummer }}</span>
        </div>
      </div>

      <!-- Rechte Spalte -->
      <div class="ap-phead-r">
        <!-- Status-Pill + Aktionen -->
        <div class="pt-row" style="gap: 8px">
          <button
            class="pt-badge pill-clickable"
            :class="{
              'pt-badge--success': (info.status ?? 'aktiv') === 'aktiv',
              'pt-badge--warning': info.status === 'pausiert',
            }"
            @click="startEdit('status')"
          >
            {{ statusLabel }}
          </button>
          <!-- Farbe -->
          <div class="color-picker-wrapper">
            <button
              class="color-swatch"
              :style="{ background: info.color || 'transparent' }"
              :class="{ 'color-swatch-empty': !info.color }"
              @click="showColorPicker = !showColorPicker"
              title="Projektfarbe wählen"
            ></button>
            <div v-if="showColorPicker" class="color-picker">
              <button
                v-for="c in COLOR_PALETTE"
                :key="c.key"
                class="color-option"
                :class="{
                  'color-option-active': (info.color || '') === (c.value || ''),
                  'color-option-empty': !c.value,
                }"
                :style="{ background: c.value || 'transparent' }"
                :title="c.label"
                @click="setColor(c.value)"
              >
                <BIcon v-if="!c.value" name="x" :size="10" />
              </button>
            </div>
          </div>
          <!-- Mehr-Menü -->
          <div class="action-menu-wrapper">
            <button class="pt-iconbtn action-btn" @click="toggleActionMenu" title="Weitere Aktionen">
              <BIcon name="more" :size="14" />
            </button>
            <div v-if="showActionMenu" class="action-menu">
              <button v-if="info.status !== 'aktiv'" class="action-menu-item" @click="setStatus('aktiv')">
                <BIcon name="check" :size="12" />
                <span>Aktivieren</span>
              </button>
              <button v-if="info.status !== 'pausiert'" class="action-menu-item" @click="setStatus('pausiert')">
                <BIcon name="clock" :size="12" />
                <span>Pausieren</span>
              </button>
              <button v-if="info.status !== 'archiviert'" class="action-menu-item" @click="setStatus('archiviert')">
                <BIcon name="archive" :size="12" />
                <span>Archivieren</span>
              </button>
              <div class="action-menu-divider"></div>
              <button class="action-menu-item" @click="openRenameDialog">
                <BIcon name="pencil" :size="12" />
                <span>Umbenennen…</span>
              </button>
              <button class="action-menu-item" @click="downloadMarkdown">
                <BIcon name="arrowUpRight" :size="12" />
                <span>Als Markdown exportieren</span>
              </button>
              <button class="action-menu-item" @click="exportProjectSummaryDocx">
                <BIcon name="file" :size="12" />
                <span>Zusammenfassung als Word…</span>
              </button>
              <button class="action-menu-item" @click="printProject">
                <BIcon name="file" :size="12" />
                <span>Drucken / Als PDF…</span>
              </button>
              <div class="action-menu-divider"></div>
              <button class="action-menu-item" @click="((showActionMenu = false), (moduleSettingsOpen = true))">
                <BIcon name="settings" :size="12" />
                <span>Module konfigurieren…</span>
                <span
                  v-if="moduleHasOverride"
                  style="
                    margin-left: auto;
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: var(--color-warning, #f59e0b);
                  "
                  title="Override aktiv"
                ></span>
              </button>
              <div class="action-menu-divider"></div>
              <button class="action-menu-item action-menu-danger" @click="openDeleteConfirm">
                <BIcon name="x" :size="12" />
                <span>Projekt löschen…</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Fortschritt (honorargewichtet aus Leistungsphasen) -->
        <div v-if="projectProgress !== null" class="ap-prog">
          <div class="ap-prog-row">
            <span class="ap-prog-lbl">Fortschritt (Phasen)</span>
            <span class="ap-prog-val">{{ projectProgress }} %</span>
          </div>
          <div class="pt-progress"><i :style="{ width: projectProgress + '%' }"></i></div>
        </div>
        <div v-else-if="info.openTasks !== undefined" class="ap-prog">
          <div class="ap-prog-row">
            <span class="ap-prog-lbl">Aufgaben</span>
            <span class="ap-prog-val">{{ info.openTasks }} offen</span>
          </div>
        </div>

        <!-- Export-Button -->
        <button class="pt-btn pt-btn--secondary pt-btn--sm" @click="exportProjectSummaryDocx">
          <BIcon name="file" :size="11" /> Export
        </button>
      </div>
    </div>

    <!-- Status-Editor (inline, unter dem Header) -->
    <div v-if="info && editingField === 'status'" class="status-editor" style="margin-bottom: 12px">
      <div class="eyebrow" style="margin-bottom: 6px">Status ändern</div>
      <select v-model="draftValue" class="stamm-input" style="max-width: 240px" @keyup="(e) => onEditKey(e, 'status')">
        <option v-for="opt in STATUS_OPTIONS" :key="opt" :value="opt">
          {{ opt[0].toUpperCase() + opt.slice(1) }}
        </option>
      </select>
      <div class="flex items-center" style="gap: 6px; margin-top: 8px">
        <button class="patio-btn solid sm" :disabled="saving" @click="saveField('status')">
          {{ saving ? "…" : "Speichern" }}
        </button>
        <button class="patio-btn ghost sm" @click="cancelEdit">Abbrechen</button>
        <span v-if="saveError" style="font-size: 11px; color: var(--color-danger-text); margin-left: 4px">
          {{ saveError }}
        </span>
      </div>
    </div>

    <!-- Stammdaten-Editor + Verknuepfungen liegen jetzt im Uebersicht-Panel
         (Design-System-Referenz: zwischen ap-phead und Tabs steht nichts). -->

    <!-- Tab-Leiste entfernt — Navigation läuft über die Projekt-Sidebar (NavRail).
         Modul-Konfig-Popover bleibt erhalten; Trigger sitzt im Header-„…"-Menü. -->
    <div v-if="moduleSettingsOpen" @click.self="moduleSettingsOpen = false" class="pm-popover-overlay">
      <div class="pm-popover" @click.stop>
        <div class="flex items-center justify-between" style="margin-bottom: 12px">
          <div style="font-size: 13px; font-weight: 600">Module für dieses Projekt</div>
          <button @click="moduleSettingsOpen = false" class="patio-btn ghost sm">×</button>
        </div>
        <p class="text-xs" style="color: var(--color-text-muted); margin: 0 0 12px">
          Tabs deaktivieren die für dieses Projekt nicht relevant sind. Die Daten bleiben erhalten — nur die UI-Anzeige
          verschwindet.
        </p>
        <div class="settings-card settings-divide">
          <label
            v-for="m in PROJECT_MODULE_LIST"
            :key="m.key"
            class="settings-row flex items-center justify-between gap-3 px-3 py-2 cursor-pointer"
          >
            <span style="font-size: 13px">{{ m.label }}</span>
            <input
              type="checkbox"
              :checked="moduleFlags[m.key]"
              :disabled="moduleBusy"
              @change="setProjectModule(m.key, ($event.target as HTMLInputElement).checked)"
            />
          </label>
        </div>
        <div class="flex items-center justify-between" style="margin-top: 12px; gap: 8px">
          <button
            v-if="moduleHasOverride"
            @click="resetProjectModulesToGlobal"
            :disabled="moduleBusy"
            class="patio-btn ghost sm"
            title="Override entfernen — globale Defaults gelten"
          >
            Auf Default zurücksetzen
          </button>
          <span v-else class="text-xs" style="color: var(--color-text-tertiary)"> Globale Defaults aktiv </span>
          <button @click="moduleSettingsOpen = false" class="patio-btn solid sm">Schließen</button>
        </div>
      </div>
    </div>

    <!-- Uebersicht (ap-grid — 2-Spalten) -->
    <div v-if="tab === 'uebersicht' && info">
      <!-- Unterprojekte (nur wenn vorhanden) -->
      <section v-if="children.length > 0" class="ap-panel" style="margin-bottom: 16px">
        <div class="ap-panel-head">
          <span class="ap-panel-title">Unterprojekte</span>
          <span class="ap-panel-sub">· {{ children.length }}</span>
        </div>
        <div class="ap-panel-body">
          <div class="children-grid">
            <router-link
              v-for="c in children"
              :key="c.id"
              :to="`/projects/${encodeURIComponent(c.name)}`"
              class="child-card"
            >
              <BIcon name="folder" :size="12" style="color: var(--color-text-muted); flex-shrink: 0" />
              <span class="child-name">{{ c.name }}</span>
              <span
                v-if="c.status && c.status !== 'aktiv'"
                :class="['pt-badge', c.status === 'pausiert' ? 'pt-badge--warning' : '']"
                style="font-size: 9px"
              >
                {{ c.status }}
              </span>
            </router-link>
          </div>
        </div>
      </section>

      <!-- Beschreibung -->
      <section v-if="info.description || editingField === 'description'" class="ap-panel" style="margin-bottom: 16px">
        <div class="ap-panel-head">
          <span class="ap-panel-title">Beschreibung</span>
          <span style="flex: 1"></span>
          <button
            v-if="editingField !== 'description'"
            class="pt-btn pt-btn--ghost pt-btn--sm"
            @click="startEditDescription"
          >
            <BIcon name="pencil" :size="11" /> Bearbeiten
          </button>
        </div>
        <div class="ap-panel-body">
          <div v-if="editingField === 'description'">
            <textarea
              v-model="draftValue"
              class="stamm-input"
              rows="4"
              placeholder="Kurz beschreiben, worum es bei diesem Projekt geht…"
              style="resize: vertical; font-family: inherit; line-height: 1.5"
            ></textarea>
            <div class="flex items-center" style="gap: 6px; margin-top: 8px">
              <button class="patio-btn solid sm" :disabled="saving" @click="saveField('description')">
                {{ saving ? "…" : "Speichern" }}
              </button>
              <button class="patio-btn ghost sm" @click="cancelEdit">Abbrechen</button>
              <span v-if="saveError" style="font-size: 11px; color: var(--color-danger-text); margin-left: 4px">{{
                saveError
              }}</span>
            </div>
          </div>
          <p v-else class="desc-text">{{ info.description }}</p>
        </div>
      </section>

      <!-- 2-Spalten-Hauptgrid -->
      <div class="ap-grid">
        <!-- LINKE SPALTE -->
        <div class="ap-col">
          <!-- Stammdaten -->
          <section class="ap-panel">
            <div class="ap-panel-head">
              <span class="ap-panel-title">Stammdaten</span>
              <span style="flex: 1"></span>
              <button class="pt-btn pt-btn--ghost pt-btn--sm" @click="startEdit('projektnummer')">Bearbeiten</button>
            </div>
            <div class="ap-panel-body">
              <dl class="ap-dl">
                <template v-for="f in STAMMDATEN_FIELDS" :key="f.key">
                  <dt>{{ f.label }}</dt>
                  <dd>
                    <!-- Inline-Editor (im Panel, wie Referenz) -->
                    <div v-if="editingField === f.key" class="ueb-stamm-edit">
                      <select
                        v-if="f.inputType === 'enum'"
                        v-model="draftValue"
                        class="pt-select"
                        @keyup="(e) => onEditKey(e, f.key)"
                      >
                        <option value="">—</option>
                        <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
                      </select>
                      <input
                        v-else-if="f.inputType === 'date'"
                        v-model="draftValue"
                        type="date"
                        class="pt-input"
                        @keyup="(e) => onEditKey(e, f.key)"
                      />
                      <input
                        v-else
                        v-model="draftValue"
                        type="text"
                        :placeholder="f.placeholder"
                        class="pt-input"
                        @keyup="(e) => onEditKey(e, f.key)"
                        autofocus
                      />
                      <div class="ueb-stamm-actions">
                        <button class="pt-btn pt-btn--primary pt-btn--sm" :disabled="saving" @click="saveField(f.key)">
                          {{ saving ? "…" : "Speichern" }}
                        </button>
                        <button class="pt-btn pt-btn--ghost pt-btn--sm" @click="cancelEdit">Abbrechen</button>
                        <span v-if="saveError" class="ueb-stamm-err">{{ saveError }}</span>
                      </div>
                      <div v-if="f.suggestions && f.suggestions.length" class="ueb-stamm-sugg">
                        <button
                          v-for="sug in f.suggestions"
                          :key="sug"
                          type="button"
                          class="chip-suggest"
                          @click="applyPhaseSuggestion(f.key, sug)"
                        >
                          {{ sug }}
                        </button>
                      </div>
                    </div>
                    <!-- Anzeige (Klick = Bearbeiten) -->
                    <button v-else class="ueb-stamm-value" @click="startEdit(f.key)" title="Bearbeiten">
                      {{ (info[f.key as keyof ProjectInfo] as string) || "—" }}
                    </button>
                  </dd>
                </template>
                <template v-if="info.budget != null">
                  <dt>Budget</dt>
                  <dd>{{ fmtEur(info.budget) }}</dd>
                </template>
              </dl>

              <!-- Hinweis bei unvollstaendigen Stammdaten -->
              <div v-if="emptyStammCount > 0" class="ueb-stamm-hint">
                <BIcon name="info" :size="12" />
                <span>{{ emptyStammCount }} Stammdaten fehlen noch — klicke ein Feld an, um es auszufüllen.</span>
              </div>

              <!-- Verknuepfungen: Bauherr + Sub-Projekt -->
              <div class="ueb-link-row">
                <div class="link-picker-wrapper">
                  <button class="link-chip" @click="openBauherrPicker" title="Bauherr mit Team-Mitglied verknüpfen">
                    <BIcon name="user" :size="11" />
                    <span v-if="info.bauherrName">Bauherr: {{ info.bauherrName }}</span>
                    <span v-else style="color: var(--color-text-muted)">Bauherr verknüpfen…</span>
                  </button>
                  <div v-if="showBauherrPicker" class="link-dropdown">
                    <button v-if="info.bauherrId" class="link-dropdown-item link-dropdown-clear" @click="unlinkBauherr">
                      <BIcon name="x" :size="11" />
                      <span>Verknüpfung aufheben</span>
                    </button>
                    <div v-if="info.bauherrId" class="link-dropdown-divider"></div>
                    <div class="link-dropdown-header">Team-Mitglied wählen</div>
                    <button
                      v-for="m in allTeam"
                      :key="m.id"
                      class="link-dropdown-item"
                      :class="{ 'link-dropdown-active': m.id === info.bauherrId }"
                      @click="linkBauherr(m.id, m.name)"
                    >
                      <div class="team-avatar" style="width: 20px; height: 20px; font-size: 9px">
                        {{ initial(m.name) }}
                      </div>
                      <div style="flex: 1; min-width: 0">
                        <div style="font-size: 12px; color: var(--color-text)">{{ m.name }}</div>
                        <div v-if="m.role" style="font-size: 10px; color: var(--color-text-muted)">{{ m.role }}</div>
                      </div>
                    </button>
                    <p v-if="allTeam.length === 0" class="link-dropdown-empty">Keine Team-Mitglieder vorhanden.</p>
                  </div>
                </div>

                <div class="link-picker-wrapper">
                  <button class="link-chip" @click="openParentPicker" title="Als Sub-Projekt einordnen">
                    <BIcon name="layers" :size="11" />
                    <span v-if="info.parentName">Teil von: {{ info.parentName }}</span>
                    <span v-else style="color: var(--color-text-muted)">Sub-Projekt von…</span>
                  </button>
                  <div v-if="showParentPicker" class="link-dropdown">
                    <button
                      v-if="info.parentId"
                      class="link-dropdown-item link-dropdown-clear"
                      @click="setParent(null)"
                    >
                      <BIcon name="x" :size="11" />
                      <span>Verknüpfung aufheben</span>
                    </button>
                    <div v-if="info.parentId" class="link-dropdown-divider"></div>
                    <div class="link-dropdown-header">Übergeordnetes Projekt</div>
                    <button
                      v-for="p in parentCandidates"
                      :key="p.id"
                      class="link-dropdown-item"
                      :class="{ 'link-dropdown-active': p.id === info.parentId }"
                      @click="setParent(p.id)"
                    >
                      <BIcon name="folder" :size="11" style="color: var(--color-text-muted)" />
                      <span style="font-size: 12px; color: var(--color-text)">{{ p.name }}</span>
                    </button>
                    <p v-if="parentCandidates.length === 0" class="link-dropdown-empty">
                      Keine weiteren Projekte vorhanden.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Offene Aufgaben -->
          <section class="ap-panel">
            <div class="ap-panel-head">
              <span class="ap-panel-title">Aufgaben</span>
              <span class="ap-panel-sub">· {{ openTasksSorted.length }} offen</span>
              <span style="flex: 1"></span>
              <button class="pt-btn pt-btn--ghost pt-btn--sm" @click="openTab('tasks')">Alle →</button>
            </div>
            <div class="ap-panel-body flush">
              <div v-if="openTasksSorted.length === 0" class="ueb-empty" style="padding: 16px 20px">
                Keine offenen Aufgaben.
              </div>
              <div v-for="t in openTasksSorted" :key="t.id" class="pt-list-item">
                <input class="pt-check" type="checkbox" @change="completeTask(t)" />
                <div class="pt-list-grow">
                  <div class="pt-li-title">{{ t.text }}</div>
                  <div v-if="t.assignee || t.date" class="pt-li-meta">
                    <span v-if="t.assignee">{{ t.assignee }}</span>
                    <span v-if="t.assignee && t.date"> · </span>
                    <span v-if="t.date">{{ fmtDate(t.date) }}</span>
                  </div>
                </div>
                <span
                  v-if="t.priority"
                  class="pt-badge"
                  :class="{
                    'pt-badge--danger': t.priority === 'hoch',
                    'pt-badge--warning': t.priority === 'mittel',
                  }"
                  style="font-size: 10px"
                  >{{ t.priority }}</span
                >
              </div>
            </div>
            <!-- Quick-Add -->
            <div class="quick-add" style="padding: 8px 16px; border-top: 1px dashed var(--color-border-subtle)">
              <input
                v-model="quickTaskText"
                placeholder="Neue Aufgabe…"
                class="quick-input"
                style="flex: 1"
                @keyup.enter="quickAddTask"
              />
              <button class="quick-btn" :disabled="!quickTaskText.trim()" @click="quickAddTask" title="Aufgabe anlegen">
                <BIcon name="plus" :size="12" />
              </button>
            </div>
          </section>
        </div>

        <!-- RECHTE SPALTE -->
        <div class="ap-col">
          <!-- Termine -->
          <section class="ap-panel">
            <div class="ap-panel-head">
              <span class="ap-panel-title">Termine</span>
              <span style="flex: 1"></span>
              <button class="pt-btn pt-btn--ghost pt-btn--sm" @click="openTab('termine')">Kalender →</button>
            </div>
            <div class="ap-panel-body flush">
              <div v-if="upcomingTermine.length === 0" class="ueb-empty" style="padding: 16px 20px">
                Keine anstehenden Termine.
              </div>
              <div v-for="t in upcomingTermine" :key="t.id" class="ap-termin">
                <div class="ap-termin-date">
                  <div class="d">{{ fmtDate(t.datum).slice(0, 2) }}</div>
                  <div class="m">{{ t.datum.slice(5, 7) }}</div>
                </div>
                <div class="ap-termin-body">
                  <div class="ap-termin-title">{{ t.text }}</div>
                  <div class="ap-termin-meta">
                    <span v-if="t.uhrzeit">{{ t.uhrzeit }}</span>
                    <span v-if="t.uhrzeit && t.location"> · </span>
                    <span v-if="t.location">{{ t.location }}</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- Quick-Add Termin -->
            <div class="quick-add" style="padding: 8px 16px; border-top: 1px dashed var(--color-border-subtle)">
              <input v-model="quickTerminDate" type="date" class="quick-input" style="width: 120px" />
              <input
                v-model="quickTerminText"
                placeholder="Termin…"
                class="quick-input"
                style="flex: 1"
                @keyup.enter="quickAddTermin"
              />
              <button
                class="quick-btn"
                :disabled="!quickTerminDate || !quickTerminText.trim()"
                @click="quickAddTermin"
                title="Termin anlegen"
              >
                <BIcon name="plus" :size="12" />
              </button>
            </div>
          </section>

          <!-- Team -->
          <section class="ap-panel">
            <div class="ap-panel-head">
              <span class="ap-panel-title">Team</span>
              <span style="flex: 1"></span>
              <button class="pt-btn pt-btn--ghost pt-btn--sm" @click="openTab('team')">Alle →</button>
            </div>
            <div class="ap-panel-body flush">
              <div v-if="projectTeam.length === 0" class="ueb-empty" style="padding: 16px 20px">
                Noch keine Teammitglieder zugeordnet.
              </div>
              <div v-for="m in projectTeam.slice(0, 4)" :key="m.id" class="pt-list-item">
                <div class="ueb-avatar">{{ initial(m.name) }}</div>
                <div class="pt-list-grow">
                  <div class="pt-li-title">{{ m.name }}</div>
                  <div class="pt-li-meta">{{ m.role || "Keine Rolle" }}</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- Phasen (Leistungsphasen) -->
    <div v-if="tab === 'phasen'">
      <ProjectPhasesTab :project-name="projectName" />
    </div>

    <!-- Rechnungen (Teilrechnungen + Honorarsicht) -->
    <div v-if="tab === 'rechnungen'">
      <ProjectInvoicesTab :project-name="projectName" />
    </div>

    <!-- Notes -->
    <div v-if="tab === 'notes'">
      <div v-if="viewingNote">
        <div class="flex items-center justify-between" style="margin-bottom: 12px">
          <span class="font-mono" style="font-size: 12px; color: var(--color-text-muted)">
            {{ viewingNote }}
          </span>
          <button @click="viewingNote = null" class="patio-btn ghost">Schließen</button>
        </div>
        <div class="note-viewer">
          <MarkdownRenderer :content="noteContent" />
        </div>
      </div>
      <div v-else>
        <div
          v-if="notes.length > 0"
          style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden"
        >
          <button
            v-for="n in notes"
            :key="n"
            @click="openNote(n)"
            class="detail-row"
            style="border-top: 1px solid var(--color-border-subtle)"
          >
            <BIcon name="file" :size="14" style="color: var(--color-text-muted)" />
            <span class="flex-1" style="font-size: 13px; color: var(--color-text)">{{ n }}</span>
          </button>
        </div>
        <div v-else class="empty-state">
          <div class="empty-state-icon"><BIcon name="pencil" :size="26" /></div>
          <div class="empty-state-text">Noch keine Notizen für dieses Projekt.</div>
          <router-link
            :to="`/notes?project=${encodeURIComponent(projectName)}`"
            class="patio-btn solid sm"
            style="text-decoration: none"
          >
            <BIcon name="plus" :size="11" :stroke-width="2" />
            Erste Notiz anlegen
          </router-link>
        </div>
      </div>
    </div>

    <!-- Tasks -->
    <div v-if="tab === 'tasks'">
      <div class="flex flex-wrap" style="gap: 8px; margin-bottom: 16px; align-items: stretch">
        <input
          ref="newTaskInputRef"
          v-model="newTask"
          placeholder="Neue Aufgabe…"
          @keyup.enter="addTask"
          class="form-input"
          style="flex: 1; min-width: 200px"
        />
        <div style="flex: 0 0 220px; min-width: 200px">
          <TeamPicker
            mode="single"
            :model-value="newTaskAssigneeId"
            @update:model-value="(v) => (newTaskAssigneeId = (v as string | null) ?? null)"
            placeholder="Zuständig…"
          />
        </div>
        <button @click="addTask" class="patio-btn solid">Hinzufügen</button>
      </div>
      <div
        v-if="tasks.filter((t) => t.status !== 'done').length > 0"
        style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden"
      >
        <div
          v-for="t in tasks.filter((t) => t.status !== 'done')"
          :key="t.id"
          class="flex items-center"
          style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        >
          <input type="checkbox" @change="completeTask(t)" style="accent-color: var(--color-primary)" />
          <span style="flex: 1; font-size: 13px; color: var(--color-text-secondary)">{{ t.text }}</span>
          <router-link
            v-if="t.assigneeId"
            :to="`/team/${encodeURIComponent(t.assigneeId)}`"
            class="assignee-chip"
            @click.stop
          >
            {{ t.assigneeName ?? t.assignee }}
          </router-link>
          <span v-else-if="t.assignee" class="assignee-chip assignee-chip-free">
            {{ t.assignee }}
          </span>
          <span v-if="t.date" class="font-mono" style="font-size: 11px; color: var(--color-text-tertiary)">{{
            t.date
          }}</span>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="empty-state-icon"><BIcon name="check" :size="26" /></div>
        <div class="empty-state-text">Noch keine offenen Aufgaben in diesem Projekt.</div>
        <button class="patio-btn solid sm" @click="focusNewTaskInput">
          <BIcon name="plus" :size="11" :stroke-width="2" />
          Erste Aufgabe anlegen
        </button>
      </div>
    </div>

    <!-- Termine -->
    <div v-if="tab === 'termine'">
      <div class="flex flex-wrap" style="gap: 8px; margin-bottom: 16px; align-items: stretch">
        <input v-model="newDatum" type="date" class="form-input" style="width: 150px; flex: 0 0 auto" />
        <input v-model="newUhrzeit" type="time" class="form-input" style="width: 110px; flex: 0 0 auto" />
        <input
          ref="newTerminInputRef"
          v-model="newTerminText"
          placeholder="Beschreibung…"
          @keyup.enter="addTermin"
          class="form-input"
          style="flex: 1; min-width: 160px"
        />
        <div style="flex: 0 0 240px; min-width: 200px">
          <TeamPicker
            mode="multi"
            :model-value="newTerminAssigneeIds"
            :free-text="newTerminAssigneeFree"
            @update:model-value="(v) => (newTerminAssigneeIds = (v as string[]) ?? [])"
            @update:free-text="(v) => (newTerminAssigneeFree = v)"
            placeholder="Teilnehmer…"
          />
        </div>
        <button @click="addTermin" class="patio-btn solid">Erstellen</button>
      </div>
      <div
        v-if="termine.length > 0"
        style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden"
      >
        <div
          v-for="t in termine"
          :key="t.id"
          class="termin-row flex items-center justify-between"
          style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        >
          <div class="min-w-0">
            <div style="font-size: 13px; color: var(--color-text)">{{ t.text }}</div>
            <div class="font-mono" style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px">
              {{ t.datum }}{{ t.uhrzeit ? " · " + t.uhrzeit : "" }}
            </div>
          </div>
          <button @click="removeTermin(t)" class="del-btn">Löschen</button>
        </div>
      </div>
      <div v-else class="empty-state">
        <div class="empty-state-icon"><BIcon name="calendar" :size="26" /></div>
        <div class="empty-state-text">Noch keine Termine in diesem Projekt.</div>
        <button class="patio-btn solid sm" @click="focusNewTerminInput">
          <BIcon name="plus" :size="11" :stroke-width="2" />
          Ersten Termin anlegen
        </button>
      </div>
    </div>

    <!-- Dateien (Stufe 3b) -->
    <div
      v-if="tab === 'files'"
      class="files-tab"
      :class="{ 'files-dragging': dragging }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- Inline-Preview fuer Text/Markdown -->
      <div v-if="viewingFile">
        <div class="flex items-center justify-between" style="margin-bottom: 12px">
          <span class="font-mono" style="font-size: 12px; color: var(--color-text-muted)">
            {{ viewingFile.name }}
          </span>
          <div class="flex items-center" style="gap: 8px">
            <a :href="downloadUrl(viewingFile)" class="patio-btn ghost sm" download>Download</a>
            <button @click="viewingFile = null" class="patio-btn ghost sm">Schließen</button>
          </div>
        </div>
        <div v-if="viewingFileIsMarkdown" class="note-viewer">
          <MarkdownRenderer :content="viewingFileContent" />
        </div>
        <pre v-else class="file-preview-pre">{{ viewingFileContent }}</pre>
      </div>

      <!-- Upload-Leiste + Liste -->
      <div v-else>
        <div class="flex items-center justify-between" style="gap: 8px; margin-bottom: 12px">
          <span style="font-size: 12px; color: var(--color-text-muted)">
            {{ files.length }} Datei<span v-if="files.length !== 1">en</span> in diesem Projekt
          </span>
          <div class="flex items-center" style="gap: 8px">
            <span v-if="uploadMsg" style="font-size: 11px; color: var(--color-success-text)">
              {{ uploadMsg }}
            </span>
            <button type="button" class="patio-btn solid sm" :disabled="uploading" @click="triggerFileUpload">
              <BIcon name="paperclip" :size="12" />
              <span style="margin-left: 4px">{{ uploading ? "Lädt…" : "Hochladen" }}</span>
            </button>
            <input
              ref="fileInputRef"
              type="file"
              multiple
              style="display: none"
              :disabled="uploading"
              @change="onFileInput"
            />
          </div>
        </div>
        <div
          v-if="uploadError"
          style="
            margin-bottom: 12px;
            padding: 10px 14px;
            border: 1px solid var(--color-danger-border);
            background: var(--color-danger-bg);
            color: var(--color-danger-text);
            border-radius: 6px;
            font-size: 12px;
          "
        >
          {{ uploadError }}
        </div>

        <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
          <button
            v-for="f in files"
            :key="f.id"
            @click="openFile(f)"
            class="file-row detail-row"
            style="border-top: 1px solid var(--color-border-subtle)"
          >
            <BIcon name="file" :size="14" style="color: var(--color-text-muted)" />
            <span class="flex-1" style="font-size: 13px; color: var(--color-text)">{{ f.name }}</span>
            <span
              class="font-mono"
              style="font-size: 11px; color: var(--color-text-tertiary); width: 70px; text-align: right"
            >
              {{ formatSize(f.size) }}
            </span>
            <span
              class="font-mono"
              style="font-size: 11px; color: var(--color-text-tertiary); width: 90px; text-align: right"
            >
              {{ formatFileDate(f.modified) }}
            </span>
            <button @click.stop="deleteFile(f)" class="file-del-btn" :title="'Datei löschen'" type="button">
              <BIcon name="x" :size="12" />
            </button>
          </button>
          <p v-if="filesLoaded && files.length === 0" class="empty-hint">
            Noch keine Dateien. Datei hierher ziehen oder oben auf „Hochladen“ klicken.
          </p>
          <p v-else-if="!filesLoaded" class="empty-hint">Lade Dateien…</p>
        </div>

        <!-- Drag-Overlay -->
        <div v-if="dragging" class="drag-overlay">
          <BIcon name="paperclip" :size="28" />
          <p>Dateien hier ablegen — werden „{{ projectName }}“ zugeordnet</p>
        </div>
      </div>
    </div>
    <!-- Team (Stufe 3c) -->
    <div v-if="tab === 'team'" class="team-tab">
      <!-- Zuordnungs-Bar -->
      <div class="team-assign-bar">
        <div v-if="!showNewMemberForm" class="flex items-center flex-wrap" style="gap: 8px">
          <select
            v-model="assignMemberId"
            class="form-input"
            style="max-width: 260px; flex: 0 1 260px"
            :disabled="assignableTeam.length === 0 || teamAssigning"
          >
            <option value="">
              {{ assignableTeam.length === 0 ? "Keine weiteren Mitglieder" : "Mitglied zuordnen…" }}
            </option>
            <option v-for="m in assignableTeam" :key="m.id" :value="m.id">
              {{ m.name }}<span v-if="m.role"> · {{ m.role }}</span>
              <template v-if="m.projectId"> (aktuell: anderes Projekt)</template>
            </option>
          </select>
          <button class="patio-btn solid sm" :disabled="!assignMemberId || teamAssigning" @click="assignExisting">
            Zuordnen
          </button>
          <span style="color: var(--color-text-faint); font-size: 12px">oder</span>
          <button class="patio-btn ghost sm" @click="showNewMemberForm = true">
            <BIcon name="plus" :size="12" />
            <span style="margin-left: 4px">Neu anlegen</span>
          </button>
          <span v-if="teamError" style="font-size: 11px; color: var(--color-danger-text)">{{ teamError }}</span>
        </div>

        <!-- Inline-Formular fuer neues Mitglied -->
        <div v-else class="flex items-center flex-wrap" style="gap: 8px">
          <input
            v-model="newMemberName"
            placeholder="Name*"
            class="form-input"
            style="max-width: 200px; flex: 0 1 200px"
            @keyup.enter="createAndAssign"
            autofocus
          />
          <input
            v-model="newMemberRole"
            placeholder="Rolle (optional)"
            class="form-input"
            style="max-width: 200px; flex: 0 1 200px"
            @keyup.enter="createAndAssign"
          />
          <button
            class="patio-btn solid sm"
            :disabled="!newMemberName.trim() || teamAssigning"
            @click="createAndAssign"
          >
            {{ teamAssigning ? "…" : "Anlegen + zuordnen" }}
          </button>
          <button
            class="patio-btn ghost sm"
            @click="
              showNewMemberForm = false;
              newMemberName = '';
              newMemberRole = '';
              teamError = null;
            "
          >
            Abbrechen
          </button>
          <span v-if="teamError" style="font-size: 11px; color: var(--color-danger-text)">{{ teamError }}</span>
        </div>
      </div>

      <!-- Mitglieder-Liste -->
      <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
        <div
          v-for="m in projectTeam"
          :key="m.id"
          class="team-row"
          style="border-top: 1px solid var(--color-border-subtle)"
        >
          <div class="team-avatar">{{ initial(m.name) }}</div>
          <div class="team-main">
            <div class="team-name">{{ m.name }}</div>
            <div v-if="m.role || m.company" class="team-sub">
              <span v-if="m.role">{{ m.role }}</span>
              <span v-if="m.role && m.company"> · </span>
              <span v-if="m.company">{{ m.company }}</span>
            </div>
          </div>
          <div class="team-contact">
            <a v-if="m.email" :href="`mailto:${m.email}`" class="team-chip" :title="m.email">
              {{ m.email }}
            </a>
            <a v-if="m.phone" :href="`tel:${m.phone}`" class="team-chip" :title="m.phone">
              {{ m.phone }}
            </a>
          </div>
          <button class="team-remove" @click="unassignMember(m)" :title="'Aus Projekt entfernen'">
            <BIcon name="x" :size="12" />
          </button>
        </div>
        <p v-if="teamLoaded && projectTeam.length === 0" class="empty-hint">
          Noch keine Mitglieder zugeordnet. Oben auswählen oder neu anlegen.
        </p>
        <p v-else-if="!teamLoaded" class="empty-hint">Lade Team…</p>
      </div>
    </div>
    <!-- Bautagebuch (Migration 011) -->
    <div v-if="tab === 'bautagebuch'" class="bt-tab">
      <div v-if="!bautagebuchLoaded" class="empty-hint">Lade Bautagebuch…</div>
      <div v-else>
        <!-- Action-Bar -->
        <div class="flex items-center" style="gap: 8px; margin-bottom: 14px; flex-wrap: wrap">
          <button class="patio-btn solid sm" @click="newBautagebuchToday">
            <BIcon name="plus" :size="11" />
            <span style="margin-left: 4px">Heute eintragen</span>
          </button>
          <input
            type="date"
            class="stamm-input"
            style="width: 170px"
            :value="''"
            @change="newBautagebuchPickDate(($event.target as HTMLInputElement).value)"
          />
          <span class="empty-hint" style="margin-left: auto">
            {{ bautagebuchEntries.length }}
            {{ bautagebuchEntries.length === 1 ? "Eintrag" : "Einträge" }}
          </span>
        </div>

        <div v-if="bautagebuchEntries.length === 0 && !bautagebuchSelectedDate" class="empty-hint">
          Noch keine Bautagebuch-Einträge. Klicke „Heute eintragen", um zu starten.
        </div>

        <div v-else class="bt-grid">
          <!-- Linke Spalte: Liste -->
          <div class="bt-list">
            <div
              v-for="e in bautagebuchEntries"
              :key="e.id"
              :class="['bt-list-row', e.date === bautagebuchSelectedDate ? 'bt-list-row-active' : '']"
              @click="selectBautagebuch(e.date)"
            >
              <div class="bt-row-date">
                <span class="bt-row-icon">{{ weatherLabel(e.weather) }}</span>
                <span>{{ formatBautagDate(e.date) }}</span>
              </div>
              <div class="bt-row-summary">
                {{ e.activities ? e.activities.split("\n")[0].slice(0, 80) : "(keine Tätigkeiten)" }}
              </div>
              <div v-if="e.incidents" class="bt-row-incident">
                <BIcon name="info" :size="12" /> {{ e.incidents.split("\n")[0].slice(0, 60) }}
              </div>
            </div>
          </div>

          <!-- Rechte Spalte: Editor -->
          <div class="bt-editor" v-if="bautagebuchDraft && bautagebuchSelectedDate">
            <div class="flex items-center" style="gap: 8px; margin-bottom: 14px">
              <!-- Tagesnavigation: vorheriger / nächster Tag -->
              <button
                class="bt-day-nav"
                @click="navigateBautagebuch(-1)"
                title="Vorheriger Tag"
                aria-label="Vorheriger Tag"
              >
                <BIcon name="chevronLeft" :size="14" />
              </button>
              <h3 style="margin: 0; font-size: 16px; font-weight: 600">
                {{ formatBautagDate(bautagebuchSelectedDate) }}
              </h3>
              <button class="bt-day-nav" @click="navigateBautagebuch(1)" title="Nächster Tag" aria-label="Nächster Tag">
                <BIcon name="chevronRight" :size="14" />
              </button>
              <span
                v-if="bautagebuchEntries.find((e) => e.date === bautagebuchSelectedDate)"
                class="empty-hint"
                style="font-size: 11px"
              >
                · gespeichert
              </span>
              <button
                v-if="bautagebuchEntries.find((e) => e.date === bautagebuchSelectedDate)"
                class="patio-btn ghost sm"
                style="margin-left: auto"
                @click="exportBautagebuchDocx(bautagebuchEntries.find((e) => e.date === bautagebuchSelectedDate)!.id)"
                title="Diesen Tag als Word herunterladen"
              >
                <BIcon name="download" :size="11" />
                <span style="margin-left: 4px">Word</span>
              </button>
              <button
                v-if="bautagebuchEntries.find((e) => e.date === bautagebuchSelectedDate)"
                class="patio-btn ghost sm"
                @click="deleteBautagebuch"
              >
                <BIcon name="trash" :size="11" />
                <span style="margin-left: 4px">Löschen</span>
              </button>
            </div>

            <!-- Wetter -->
            <div class="bt-field">
              <label class="bt-label">Wetter</label>
              <select v-model="bautagebuchDraft.weather" class="stamm-input" style="max-width: 220px">
                <option value="">— wählen —</option>
                <option v-for="w in WEATHER_OPTIONS" :key="w.value" :value="w.value">{{ w.label }}</option>
              </select>
            </div>

            <!-- Temperatur -->
            <div class="bt-field">
              <label class="bt-label">Temperatur (°C)</label>
              <div class="flex items-center" style="gap: 8px">
                <input
                  v-model="bautagebuchDraft.temperatureMin"
                  type="number"
                  class="stamm-input"
                  style="width: 90px"
                  placeholder="Min"
                />
                <span class="empty-hint">bis</span>
                <input
                  v-model="bautagebuchDraft.temperatureMax"
                  type="number"
                  class="stamm-input"
                  style="width: 90px"
                  placeholder="Max"
                />
              </div>
            </div>

            <!-- Personal über TeamPicker (wieder­verwendet aus Phase 3 Team-Feature) -->
            <div class="bt-field">
              <label class="bt-label">Personal vor Ort</label>
              <TeamPicker
                mode="multi"
                :model-value="bautagebuchDraft.personnelIds"
                :free-text="bautagebuchDraft.personnelFree"
                @update:model-value="(v) => bautagebuchDraft && (bautagebuchDraft.personnelIds = (v as string[]) ?? [])"
                @update:free-text="(v) => bautagebuchDraft && (bautagebuchDraft.personnelFree = v)"
                placeholder="Mitarbeiter auswählen oder Trupp eintragen…"
              />
            </div>

            <!-- Maschinen -->
            <div class="bt-field">
              <label class="bt-label">Maschinen / Geräte</label>
              <input
                v-model="bautagebuchDraft.machines"
                class="stamm-input"
                placeholder="z.B. Bagger CAT 320, Mobilkran 50t, Walze BW213"
              />
            </div>

            <!-- Tätigkeiten -->
            <div class="bt-field">
              <label class="bt-label">Tätigkeiten</label>
              <textarea
                v-model="bautagebuchDraft.activities"
                class="stamm-input"
                rows="5"
                placeholder="Was wurde heute gemacht? (Markdown erlaubt)"
                style="resize: vertical; font-family: inherit; line-height: 1.5"
              ></textarea>
            </div>

            <!-- Vorkommnisse -->
            <div class="bt-field">
              <label class="bt-label">Besondere Vorkommnisse</label>
              <textarea
                v-model="bautagebuchDraft.incidents"
                class="stamm-input"
                rows="3"
                placeholder="Behinderungen, Stoerungen, Unfaelle, Entscheidungen…"
                style="resize: vertical; font-family: inherit; line-height: 1.5"
              ></textarea>
            </div>

            <!-- Speichern -->
            <div class="flex items-center" style="gap: 8px; margin-top: 14px">
              <button class="patio-btn solid sm" :disabled="bautagebuchSaving" @click="saveBautagebuch">
                {{ bautagebuchSaving ? "…" : "Speichern" }}
              </button>
              <span v-if="bautagebuchError" style="font-size: 11px; color: var(--color-danger-text)">
                {{ bautagebuchError }}
              </span>
            </div>
          </div>

          <div v-else class="bt-editor empty-hint" style="display: flex; align-items: center; justify-content: center">
            Eintrag links auswählen oder „Heute eintragen" klicken.
          </div>
        </div>
      </div>
    </div>

    <!-- Meetings (Migration 012) -->
    <div v-if="tab === 'meetings'" class="mt-tab">
      <div v-if="!meetingsLoaded" class="empty-hint">Lade Meetings…</div>
      <div v-else>
        <!-- Action-Bar -->
        <div class="flex items-center" style="gap: 8px; margin-bottom: 14px; flex-wrap: wrap">
          <button class="patio-btn solid sm" @click="newMeeting">
            <BIcon name="plus" :size="11" />
            <span style="margin-left: 4px">Neues Meeting</span>
          </button>
          <span class="empty-hint" style="margin-left: auto">
            {{ meetings.length }}
            {{ meetings.length === 1 ? "Meeting" : "Meetings" }}
          </span>
        </div>

        <div v-if="meetings.length === 0 && !meetingDraft" class="empty-hint">
          Noch keine Meetings. Klicke „Neues Meeting", um ein Protokoll anzulegen.
        </div>

        <div v-else class="mt-grid">
          <!-- Linke Spalte: Liste -->
          <div class="mt-list">
            <div
              v-for="m in meetings"
              :key="m.id"
              :class="['mt-list-row', meetingDraft?.id === m.id ? 'mt-list-row-active' : '']"
              @click="selectMeeting(m)"
            >
              <div class="mt-row-head">
                <span class="mt-row-date">{{ m.date }}{{ m.startTime ? " " + m.startTime : "" }}</span>
                <span v-if="m.meetingType" class="mt-row-type">{{ m.meetingType }}</span>
              </div>
              <div class="mt-row-title">{{ m.title }}</div>
              <div
                v-if="(m.attendeesResolved && m.attendeesResolved.length > 0) || m.attendeesExternal.length > 0"
                class="mt-row-attendees"
              >
                {{ (m.attendeesResolved ?? []).length + m.attendeesExternal.length }} Teilnehmer
              </div>
            </div>
          </div>

          <!-- Rechte Spalte: Editor -->
          <div class="mt-editor" v-if="meetingDraft">
            <div class="flex items-center" style="gap: 8px; margin-bottom: 14px">
              <h3 style="margin: 0; font-size: 16px; font-weight: 600">
                {{ meetingDraft.id ? "Meeting bearbeiten" : "Neues Meeting" }}
              </h3>
              <button
                v-if="meetingDraft.id"
                class="patio-btn ghost sm"
                style="margin-left: auto"
                @click="exportMeetingDocx(meetingDraft.id)"
                title="Als Word-Datei herunterladen"
              >
                <BIcon name="download" :size="11" />
                <span style="margin-left: 4px">Word</span>
              </button>
              <button v-if="meetingDraft.id" class="patio-btn ghost sm" @click="deleteMeeting">
                <BIcon name="trash" :size="11" />
                <span style="margin-left: 4px">Löschen</span>
              </button>
              <button v-else class="patio-btn ghost sm" style="margin-left: auto" @click="cancelMeetingEdit">
                Abbrechen
              </button>
            </div>

            <!-- Titel -->
            <div class="mt-field">
              <label class="mt-label">Titel <span style="color: var(--color-danger-text)">*</span></label>
              <input v-model="meetingDraft.title" class="stamm-input" placeholder="z.B. Bauherrenmeeting KW 17" />
            </div>

            <!-- Datum + Zeit + Typ -->
            <div class="mt-row-fields">
              <div class="mt-field">
                <label class="mt-label">Datum <span style="color: var(--color-danger-text)">*</span></label>
                <input v-model="meetingDraft.date" type="date" class="stamm-input" />
              </div>
              <div class="mt-field">
                <label class="mt-label">Von</label>
                <input v-model="meetingDraft.startTime" type="time" class="stamm-input" />
              </div>
              <div class="mt-field">
                <label class="mt-label">Bis</label>
                <input v-model="meetingDraft.endTime" type="time" class="stamm-input" />
              </div>
              <div class="mt-field">
                <label class="mt-label">Typ</label>
                <select v-model="meetingDraft.meetingType" class="stamm-input">
                  <option value="">— wählen —</option>
                  <option v-for="t in MEETING_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </div>
            </div>

            <!-- Ort -->
            <div class="mt-field">
              <label class="mt-label">Ort</label>
              <input v-model="meetingDraft.location" class="stamm-input" placeholder="Baustelle, Büro, Online…" />
            </div>

            <!-- Teilnehmer (TeamPicker + Freitext) -->
            <div class="mt-field">
              <label class="mt-label">Teilnehmer</label>
              <TeamPicker
                mode="multi"
                :model-value="meetingDraft.attendeeIds"
                :free-text="meetingDraft.attendeesExternal"
                @update:model-value="(v) => meetingDraft && (meetingDraft.attendeeIds = (v as string[]) ?? [])"
                @update:free-text="(v) => meetingDraft && (meetingDraft.attendeesExternal = v)"
                placeholder="Mitarbeiter wählen oder externen Namen eintragen…"
              />
            </div>

            <!-- Vorlage anwenden (Phase 6c) — nur fuer NEUE Meetings.
                 Beim Edit waere das Risiko zu hoch dass User existing-Inhalt
                 versehentlich ueberschreibt.
                 Logik: Vorlage ausgewählt → Protokoll-Feld ausgeblendet
                        Keine Vorlage → Vorlage-Block ausgeblendet, Protokoll sichtbar -->
            <div
              v-if="!meetingDraft.id && meetingTemplates.length > 0"
              class="mt-field"
              style="
                background: var(--color-bg-subtle);
                border: 1px solid var(--color-border-subtle);
                border-radius: 6px;
                padding: 10px 12px;
              "
            >
              <label class="mt-label" style="font-size: 11px">Vorlage anwenden</label>
              <select
                v-model="selectedMeetingTemplateId"
                @change="applyMeetingTemplate"
                class="stamm-input"
                style="font-size: 13px"
              >
                <option value="">— keine Vorlage —</option>
                <option v-for="t in meetingTemplates" :key="t.id" :value="t.id">
                  {{ t.name }}{{ t.isDefault ? " (Standard)" : "" }}
                </option>
              </select>
            </div>

            <!-- Agenda — immer sichtbar -->
            <div class="mt-field">
              <label class="mt-label">Agenda</label>
              <textarea
                v-model="meetingDraft.agenda"
                class="stamm-input"
                rows="6"
                placeholder="Tagesordnung (Markdown erlaubt)"
                style="resize: vertical; font-family: inherit; line-height: 1.5"
              ></textarea>
            </div>

            <!-- Protokoll — nur wenn KEINE Vorlage gewählt (Vorlage liefert Struktur via Agenda) -->
            <div v-if="!selectedMeetingTemplateId" class="mt-field">
              <label class="mt-label">Protokoll</label>
              <textarea
                v-model="meetingDraft.minutes"
                class="stamm-input"
                rows="6"
                placeholder="Was wurde besprochen?"
                style="resize: vertical; font-family: inherit; line-height: 1.5"
              ></textarea>
            </div>

            <!-- Beschluesse -->
            <div class="mt-field">
              <label class="mt-label">Beschlüsse</label>
              <textarea
                v-model="meetingDraft.decisions"
                class="stamm-input"
                rows="3"
                placeholder="Getroffene Entscheidungen…"
                style="resize: vertical; font-family: inherit; line-height: 1.5"
              ></textarea>
            </div>

            <!-- Action-Items -->
            <div class="mt-field">
              <label class="mt-label">To-Dos</label>
              <div v-if="meetingDraft.actionItems.length > 0" class="mt-todo-list">
                <div v-for="(item, idx) in meetingDraft.actionItems" :key="idx" class="mt-todo-item">
                  <input type="checkbox" v-model="item.done" class="mt-todo-check" />
                  <input
                    v-model="item.text"
                    class="stamm-input"
                    style="flex: 1"
                    :class="{ 'mt-todo-done': item.done }"
                  />
                  <!-- "Als Aufgabe anlegen" — wenn schon angelegt: Link statt Button -->
                  <button
                    v-if="!item.taskId"
                    class="patio-btn ghost sm"
                    :disabled="!item.text.trim() || convertingActionIdx === idx"
                    @click="convertActionItemToTask(idx)"
                    title="Als Aufgabe anlegen"
                  >
                    {{ convertingActionIdx === idx ? "…" : "→ Aufgabe" }}
                  </button>
                  <span v-else class="mt-todo-task-link" title="Bereits als Aufgabe angelegt">
                    <BIcon name="check" :size="10" />
                    Aufgabe
                  </span>
                  <button class="action-btn" @click="removeActionItem(idx)" title="Entfernen">
                    <BIcon name="x" :size="11" />
                  </button>
                </div>
              </div>
              <div class="flex items-center" style="gap: 6px; margin-top: 6px">
                <input
                  v-model="newActionItemText"
                  class="stamm-input"
                  style="flex: 1"
                  placeholder="Neues To-Do…"
                  @keyup.enter="addActionItem"
                />
                <button class="patio-btn ghost sm" @click="addActionItem">+ Hinzufügen</button>
              </div>
              <p v-if="convertError" style="font-size: 11px; color: var(--color-danger-text); margin-top: 6px">
                {{ convertError }}
              </p>
            </div>

            <!-- Folgetermin -->
            <div class="mt-field">
              <label class="mt-label">Folgetermin</label>
              <input v-model="meetingDraft.nextMeetingDate" type="date" class="stamm-input" style="max-width: 200px" />
            </div>

            <!-- Speichern -->
            <div class="flex items-center" style="gap: 8px; margin-top: 14px">
              <button class="patio-btn solid sm" :disabled="meetingSaving" @click="saveMeeting">
                {{ meetingSaving ? "…" : "Speichern" }}
              </button>
              <button class="patio-btn ghost sm" @click="cancelMeetingEdit">Abbrechen</button>
              <span v-if="meetingError" style="font-size: 11px; color: var(--color-danger-text)">
                {{ meetingError }}
              </span>
            </div>
          </div>

          <div v-else class="mt-editor empty-hint" style="display: flex; align-items: center; justify-content: center">
            Meeting links auswählen oder „Neues Meeting" klicken.
          </div>
        </div>
      </div>
    </div>

    <!-- Stunden (Migration 014) -->
    <div v-if="tab === 'stunden'" class="time-tab">
      <div v-if="!timeLoaded" class="empty-hint">Lade Stunden…</div>
      <div v-else>
        <!-- Action-Bar mit Total -->
        <div class="flex items-center" style="gap: 8px; margin-bottom: 14px; flex-wrap: wrap">
          <button class="patio-btn solid sm" @click="newTimeEntry">
            <BIcon name="plus" :size="11" />
            <span style="margin-left: 4px">Stunden eintragen</span>
          </button>
          <button
            v-if="timeEntries.length > 0"
            class="patio-btn ghost sm"
            @click="exportTimeEntriesDocx"
            title="Stundenzettel als Word herunterladen"
          >
            <BIcon name="download" :size="11" />
            <span style="margin-left: 4px">Stundenzettel</span>
          </button>
          <span class="empty-hint" style="margin-left: auto; font-size: 12px">
            <strong style="color: var(--color-text)">{{ timeTotalHours.toFixed(1) }}h</strong>
            · {{ timeEntries.length }}
            {{ timeEntries.length === 1 ? "Eintrag" : "Einträge" }}
          </span>
        </div>

        <!-- Summen pro Mitarbeiter -->
        <div v-if="timeSummary.length > 0" class="time-summary">
          <div class="eyebrow" style="margin-bottom: 8px">Summen pro Mitarbeiter</div>
          <div class="time-summary-rows">
            <div v-for="row in timeSummary" :key="row.key" class="time-summary-row">
              <span class="time-summary-label">{{ row.label }}</span>
              <span class="time-summary-hours">{{ row.hours.toFixed(1) }}h</span>
              <span class="time-summary-count">{{ row.entries }}</span>
            </div>
          </div>
        </div>

        <div v-if="timeEntries.length === 0 && !timeDraft" class="empty-state" style="margin-top: 16px">
          <div class="empty-state-icon"><BIcon name="clock" :size="26" /></div>
          <div class="empty-state-text">Noch keine Stunden für dieses Projekt erfasst.</div>
          <button class="patio-btn solid sm" @click="newTimeEntry">
            <BIcon name="plus" :size="11" :stroke-width="2" />
            Erste Stunden eintragen
          </button>
        </div>

        <div v-else class="time-grid">
          <!-- Linke Spalte: Liste -->
          <div class="time-list">
            <div
              v-for="e in timeEntries"
              :key="e.id"
              :class="['time-row', timeDraft?.id === e.id ? 'time-row-active' : '']"
              @click="selectTimeEntry(e)"
            >
              <div class="time-row-head">
                <span class="time-row-date">{{ e.date }}</span>
                <span class="time-row-hours">{{ e.hours.toFixed(1) }}h</span>
              </div>
              <div class="time-row-name">{{ e.memberName ?? "—" }}</div>
              <div v-if="e.activity" class="time-row-activity">{{ e.activity }}</div>
            </div>
          </div>

          <!-- Rechte Spalte: Editor -->
          <div class="time-editor" v-if="timeDraft">
            <div class="flex items-center" style="gap: 8px; margin-bottom: 14px">
              <h3 style="margin: 0; font-size: 16px; font-weight: 600">
                {{ timeDraft.id ? "Eintrag bearbeiten" : "Neuer Stunden-Eintrag" }}
              </h3>
              <button v-if="timeDraft.id" class="patio-btn ghost sm" style="margin-left: auto" @click="deleteTimeEntry">
                <BIcon name="trash" :size="11" />
                <span style="margin-left: 4px">Löschen</span>
              </button>
              <button v-else class="patio-btn ghost sm" style="margin-left: auto" @click="cancelTimeEdit">
                Abbrechen
              </button>
            </div>

            <div class="time-row-fields">
              <div class="time-field">
                <label class="time-label">Datum <span style="color: var(--color-danger-text)">*</span></label>
                <input v-model="timeDraft.date" type="date" class="stamm-input" />
              </div>
              <div class="time-field">
                <label class="time-label">
                  Stunden <span style="color: var(--color-danger-text)">*</span>
                  <span
                    v-if="computedTimeHours !== null"
                    style="
                      font-size: 9px;
                      font-weight: 400;
                      color: var(--color-text-faint);
                      margin-left: 6px;
                      text-transform: none;
                      letter-spacing: 0;
                    "
                  >
                    (auto: Beginn–Ende)
                  </span>
                </label>
                <input
                  v-model="timeDraft.hours"
                  type="number"
                  step="0.25"
                  min="0"
                  max="24"
                  class="stamm-input"
                  placeholder="8.5"
                />
              </div>
            </div>

            <!-- Mitarbeiter: Dropdown + Freitext-Override -->
            <div class="time-field">
              <label class="time-label">Mitarbeiter <span style="color: var(--color-danger-text)">*</span></label>
              <div class="flex items-center" style="gap: 8px; flex-wrap: wrap">
                <select
                  :value="timeDraft.memberId ?? ''"
                  @change="onTimeMemberChange(($event.target as HTMLSelectElement).value)"
                  class="stamm-input"
                  style="flex: 1; min-width: 180px"
                >
                  <option value="">— Freitext (extern) —</option>
                  <option v-for="m in allTeam" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
                <input
                  v-model="timeDraft.memberName"
                  class="stamm-input"
                  style="flex: 1; min-width: 180px"
                  placeholder="Name (Freitext für externe)"
                />
              </div>
            </div>

            <div class="time-row-fields">
              <div class="time-field">
                <label class="time-label">Beginn</label>
                <!-- type="text" damit User flexibel tippen kann ("8", "8:30", "0830").
                     onBlur normalisiert auf "HH:MM". inputmode hilft Mobile-Tastatur. -->
                <input
                  v-model="timeDraft.startTime"
                  type="text"
                  inputmode="numeric"
                  class="stamm-input"
                  placeholder="08:00"
                  @blur="normalizeStartTime"
                />
              </div>
              <div class="time-field">
                <label class="time-label">Ende</label>
                <input
                  v-model="timeDraft.endTime"
                  type="text"
                  inputmode="numeric"
                  class="stamm-input"
                  placeholder="16:30"
                  @blur="normalizeEndTime"
                />
              </div>
              <div class="time-field">
                <label class="time-label">Pause (Min.)</label>
                <input v-model="timeDraft.breakMinutes" type="number" min="0" class="stamm-input" placeholder="0" />
              </div>
            </div>

            <div class="time-field">
              <label class="time-label">Tätigkeit</label>
              <input v-model="timeDraft.activity" class="stamm-input" placeholder="z.B. Schalung EG, Maurerarbeiten" />
            </div>

            <div class="time-field">
              <label class="time-label">Notiz</label>
              <textarea
                v-model="timeDraft.notes"
                class="stamm-input"
                rows="2"
                style="resize: vertical; font-family: inherit; line-height: 1.5"
              ></textarea>
            </div>

            <div class="flex items-center" style="gap: 8px; margin-top: 14px">
              <button class="patio-btn solid sm" :disabled="timeSaving" @click="saveTimeEntry">
                {{ timeSaving ? "…" : "Speichern" }}
              </button>
              <button class="patio-btn ghost sm" @click="cancelTimeEdit">Abbrechen</button>
              <span v-if="timeError" style="font-size: 11px; color: var(--color-danger-text)">
                {{ timeError }}
              </span>
            </div>
          </div>

          <div
            v-else
            class="time-editor empty-hint"
            style="display: flex; align-items: center; justify-content: center"
          >
            Eintrag links auswählen oder „Stunden eintragen" klicken.
          </div>
        </div>
      </div>
    </div>

    <!-- Zugriff (Phase 3) — nur fuer Admins, sonst kommt der Tab gar nicht erst -->
    <div v-if="tab === 'zugriff' && isAdmin">
      <div
        style="
          font-size: 12px;
          color: var(--color-text-muted);
          background: var(--color-bg-subtle);
          padding: 10px 14px;
          border: 1px solid var(--color-border-subtle);
          border-radius: 8px;
          margin-bottom: 14px;
          line-height: 1.5;
        "
      >
        <BIcon name="info" :size="11" />
        <span style="margin-left: 4px">
          Admins haben automatisch Zugriff auf alle Projekte. Hier nur Nutzer freigeben.
        </span>
      </div>

      <div class="flex items-center" style="gap: 8px; margin-bottom: 14px; flex-wrap: wrap">
        <select
          v-model="accessAddUserId"
          class="form-input"
          style="max-width: 280px; flex: 0 1 280px"
          :disabled="accessCandidates.length === 0 || accessSaving"
        >
          <option value="">
            {{ accessCandidates.length === 0 ? "Keine weiteren Nutzer" : "Nutzer freigeben…" }}
          </option>
          <option v-for="u in accessCandidates" :key="u.id" :value="u.id">
            {{ u.displayName ?? u.username }}
            <template v-if="u.displayName"> ({{ u.username }})</template>
          </option>
        </select>
        <button class="patio-btn solid sm" :disabled="!accessAddUserId || accessSaving" @click="grantAccess">
          {{ accessSaving ? "…" : "Freigeben" }}
        </button>
        <span v-if="accessError" style="font-size: 11px; color: var(--color-danger-text)">
          {{ accessError }}
        </span>
      </div>

      <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
        <div v-for="entry in accessList" :key="entry.userId" class="access-row">
          <div
            class="member-avatar member-avatar-sm"
            style="
              background: var(--color-bg-subtle);
              color: var(--color-text-secondary);
              border: 1px solid var(--color-border);
            "
          >
            {{ initial(entry.displayName ?? entry.username) }}
          </div>
          <div style="flex: 1; min-width: 0">
            <div style="font-size: 13px; color: var(--color-text)">{{ entry.displayName ?? entry.username }}</div>
            <div v-if="entry.displayName" style="font-size: 11px; color: var(--color-text-muted)">
              {{ entry.username }}
            </div>
          </div>
          <span style="font-size: 11px; color: var(--color-text-muted)">Nutzer</span>
          <button class="access-remove" @click="revokeAccess(entry.userId)" :title="'Zugriff entziehen'">
            <BIcon name="x" :size="12" />
          </button>
        </div>
        <p v-if="accessLoaded && accessList.length === 0" class="empty-hint">Noch keine Nutzer freigegeben.</p>
        <p v-else-if="!accessLoaded" class="empty-hint">Lade…</p>
      </div>
    </div>

    <!-- ═══ Rename-Dialog ═════════════════════════════════════ -->
    <div v-if="renameDialogOpen" class="modal-overlay" @click.self="renameDialogOpen = false">
      <div class="modal-card" style="max-width: 440px">
        <div class="eyebrow" style="margin-bottom: 4px">Umbenennen</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0">Projektnamen ändern</h2>
        <input
          v-model="renameDraft"
          type="text"
          class="form-input-lg"
          style="width: 100%"
          placeholder="Neuer Projektname"
          @keyup.enter="submitRename"
          @keyup.esc="renameDialogOpen = false"
          autofocus
        />
        <p style="font-size: 11px; color: var(--color-text-muted); margin: 8px 0 0 0">
          Notizen, Aufgaben, Termine und Dateien behalten ihre Zuordnung — die Referenz läuft über eine interne ID.
        </p>
        <div
          v-if="renameError"
          style="
            margin-top: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ renameError }}
        </div>
        <div class="flex items-center justify-end" style="gap: 8px; margin-top: 20px">
          <button class="patio-btn ghost" @click="renameDialogOpen = false" :disabled="renaming">Abbrechen</button>
          <button
            class="patio-btn solid"
            @click="submitRename"
            :disabled="!renameDraft.trim() || renameDraft.trim() === info?.name || renaming"
          >
            {{ renaming ? "…" : "Umbenennen" }}
          </button>
        </div>
      </div>
    </div>

    <!-- ═══ Loesch-Bestaetigung ═══════════════════════════════ -->
    <div v-if="deleteConfirmOpen" class="modal-overlay" @click.self="deleteConfirmOpen = false">
      <div class="modal-card" style="max-width: 480px">
        <div class="eyebrow" style="color: var(--color-danger-text); margin-bottom: 6px">Achtung</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 12px 0; color: var(--color-text)">
          Projekt „{{ info?.name }}" wirklich löschen?
        </h2>
        <p style="font-size: 13px; color: var(--color-text-muted); line-height: 1.6; margin: 0 0 4px 0">
          Das Projekt und alle <strong>Notizen</strong> werden dauerhaft entfernt.
          <br />
          Aufgaben, Termine, Dateien und Team-Mitglieder bleiben erhalten und sind danach „ohne Projekt".
        </p>
        <p style="font-size: 12px; color: var(--color-text-faint); margin: 12px 0 0 0">
          Alternative: Status auf <em>archiviert</em> setzen — Daten bleiben, Projekt ist aus der Standard-Ansicht raus.
        </p>

        <div
          v-if="deleteError"
          style="
            margin-top: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--color-danger-text);
            background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
            border-radius: 6px;
          "
        >
          {{ deleteError }}
        </div>

        <div class="flex items-center justify-between" style="margin-top: 20px">
          <button
            class="patio-btn ghost"
            @click="
              setStatus('archiviert');
              deleteConfirmOpen = false;
            "
            :disabled="deleting || info?.status === 'archiviert'"
          >
            Stattdessen archivieren
          </button>
          <div class="flex items-center" style="gap: 8px">
            <button class="patio-btn ghost" @click="deleteConfirmOpen = false" :disabled="deleting">Abbrechen</button>
            <button class="patio-btn danger" @click="confirmDelete" :disabled="deleting">
              {{ deleting ? "Lösche…" : "Ja, löschen" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Module-Popover (Phase 6e) ──────────────────────────────────────── */
.pm-popover-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.pm-popover {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 18px 20px;
  width: 100%;
  max-width: 380px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.16);
}
.settings-row {
  border-bottom: 1px solid var(--color-border-subtle);
}
.settings-row:last-child {
  border-bottom: 0;
}
.settings-divide > .settings-row + .settings-row {
  border-top: 0;
}

/* ── Back-Link ──────────────────────────────────────────── */
/* ── Vollbreit-Wrapper — füllt die gesamte Arbeitsfläche ──── */
.proj-detail-page {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: var(--space-8, 32px) var(--space-10, 40px) var(--space-16, 64px);
  color: var(--color-text);
}

/* ── Breadcrumb (Projekte › Name) ──────────────────────────── */
.pd-crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: var(--space-5, 20px);
}
.pd-crumb-link {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--color-text-muted);
  font-size: 13px;
  cursor: pointer;
}
.pd-crumb-link:hover {
  color: var(--color-text);
}
.pd-crumb-sep {
  color: var(--color-text-faint);
  flex: none;
}
.pd-crumb-here {
  color: var(--color-text);
  font-weight: 500;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
  margin-bottom: 16px;
}
.back-link:hover {
  color: var(--color-text);
}

/* ── Hero ───────────────────────────────────────────────── */
.hero {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 20px 24px;
  background: var(--color-bg);
  margin-bottom: 4px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  cursor: default;
}
.pill-clickable {
  cursor: pointer;
  transition: border-color 180ms ease;
}
.pill-clickable:hover {
  border-color: var(--color-text-faint);
  color: var(--color-text);
}
.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}
.pill-status-aktiv {
  --pill-dot-color: #16a34a;
}
.pill-status-pausiert {
  --pill-dot-color: #d97706;
}
.pill-status-archiviert {
  --pill-dot-color: var(--color-text-faint);
}

/* ── Stammdaten-Grid ───────────────────────────────────── */
.stammdaten-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px 20px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--color-border-subtle);
}
@media (max-width: 840px) {
  .stammdaten-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.stamm-field {
  min-width: 0;
}
.stamm-field-editing {
  grid-column: span 2;
}

.stamm-label {
  margin-bottom: 4px;
}

.stamm-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 2px 0;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  width: 100%;
  text-align: left;
  border-radius: 3px;
  transition: background 180ms ease;
}
.stamm-value:hover {
  background: var(--color-bg-subtle);
}
.stamm-value-empty {
  color: var(--color-text-faint);
  font-style: italic;
}
.stamm-value-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stamm-edit-icon {
  color: var(--color-text-faint);
  opacity: 0;
  transition: opacity 180ms ease;
  flex-shrink: 0;
  margin-left: auto;
}
.stamm-value:hover .stamm-edit-icon {
  opacity: 1;
}

.stamm-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
}

.chip-suggest {
  padding: 2px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg-subtle);
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 180ms ease;
}
.chip-suggest:hover {
  border-color: var(--color-text-faint);
  color: var(--color-text);
  background: var(--color-bg);
}

.stamm-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-bg-subtle);
  border-radius: 6px;
}

.status-editor {
  margin-top: 4px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-subtle);
}

/* ── Stat-Kacheln ──────────────────────────────────────── */
.stat-tile {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--color-bg);
}
.stat-number {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-text);
  margin-top: 4px;
  letter-spacing: -0.02em;
}

/* ── Tabs ──────────────────────────────────────────────── */
.tab-nav {
  -webkit-overflow-scrolling: touch;
  /* Scrollbar dezent verstecken auf modernen Browsern */
  scrollbar-width: thin;
}
.tab-nav::-webkit-scrollbar {
  height: 2px;
}
.tab-nav::-webkit-scrollbar-thumb {
  background: var(--color-border);
}

.tab-btn {
  padding-bottom: 10px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-muted);
  cursor: pointer;
  margin-bottom: -1px;
  transition: all 180ms ease;
  white-space: nowrap;
}

@media (max-width: 767.98px) {
  /* Aussen-Padding kleiner auf Phone (sonst frisst es zu viel Breite) */
  .proj-detail-page {
    padding: 16px 14px 32px !important;
  }
  .tab-nav {
    gap: 16px !important;
  }
  .tab-btn {
    font-size: 12px;
    padding-bottom: 8px;
  }
  /* Quick-Stats: 4 → 2 Spalten auf Phone */
  .proj-quick-stats {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}
.tab-btn:hover {
  color: var(--color-text);
}
.tab-btn-active {
  color: var(--color-text);
  border-bottom-color: var(--color-primary);
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 180ms ease;
}
.detail-row:first-child {
  border-top: 0 !important;
}
.detail-row:hover {
  background: var(--color-bg-subtle);
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
  flex: 1;
}

.termin-row .del-btn {
  font-size: 11px;
  color: var(--color-text-faint);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: all 180ms ease;
}
.termin-row:hover .del-btn {
  opacity: 1;
}
.termin-row .del-btn:hover {
  color: var(--color-danger-text);
}

/* Assignee-Chip (Migration 007) */
.assignee-chip {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  text-decoration: none;
  white-space: nowrap;
  transition: all 180ms ease;
}
.assignee-chip:hover {
  color: var(--color-text);
  border-color: var(--color-text-faint);
}
.assignee-chip-free {
  border-style: dashed;
  color: var(--color-text-muted);
}

.note-viewer {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 20px 24px;
  background: var(--color-bg);
  max-height: 500px;
  overflow: auto;
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.empty-hint {
  font-size: 13px;
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 28px;
  margin: 0;
}

.placeholder-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 20px;
  color: var(--color-text-faint);
  border: 1px dashed var(--color-border);
  border-radius: 8px;
}
.placeholder-tab p {
  margin: 0;
  font-size: 13px;
}

/* ── patio-btn sm-Variant ───────────────────────────────── */
.patio-btn.sm {
  padding: 4px 10px;
  font-size: 11px;
}
.patio-btn.sm.disabled,
.patio-btn.sm input:disabled + * {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Files-Tab ─────────────────────────────────────────── */
.files-tab {
  position: relative;
  min-height: 200px;
}
.files-tab.files-dragging {
  outline: 2px dashed var(--color-primary);
  outline-offset: 4px;
  border-radius: 10px;
}

.file-row {
  position: relative;
}
.file-del-btn {
  background: transparent;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: all 180ms ease;
}
.file-row:hover .file-del-btn {
  opacity: 1;
}
.file-del-btn:hover {
  color: var(--color-danger-text);
  background: var(--color-bg-subtle);
}

.file-preview-pre {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--color-bg-subtle);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  max-height: 500px;
  overflow: auto;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: color-mix(in srgb, var(--color-bg) 92%, transparent);
  border: 2px dashed var(--color-primary);
  border-radius: 10px;
  color: var(--color-primary);
  pointer-events: none;
  font-size: 13px;
}
.drag-overlay p {
  margin: 0;
  color: var(--color-text);
}

/* ── Team-Tab ──────────────────────────────────────────── */
.team-tab {
  min-height: 200px;
}
.team-assign-bar {
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  margin-bottom: 14px;
}

.team-row {
  display: grid;
  grid-template-columns: 36px 1fr auto 24px;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  transition: background 180ms ease;
}
.team-row:first-child {
  border-top: 0 !important;
}
.team-row:hover {
  background: var(--color-bg-subtle);
}

.team-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.02em;
}
.team-row:hover .team-avatar {
  background: var(--color-bg);
}

.team-main {
  min-width: 0;
}
.team-name {
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-sub {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.team-contact {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 320px;
}
.team-chip {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
  white-space: nowrap;
  transition: all 180ms ease;
}
.team-chip:hover {
  color: var(--color-text);
  border-color: var(--color-text-faint);
}

.team-remove {
  background: transparent;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: all 180ms ease;
}
.team-row:hover .team-remove {
  opacity: 1;
}
.team-remove:hover {
  color: var(--color-danger-text);
  background: var(--color-bg);
}

/* ── Uebersicht-Tab ────────────────────────────────────── */
.ueb-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px 18px;
  background: var(--color-bg);
  min-width: 0;
}

.ueb-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 960px) {
  .ueb-grid {
    grid-template-columns: 1fr;
  }
}

.ueb-empty {
  font-size: 12px;
  color: var(--color-text-faint);
  padding: 6px 0;
}

.ueb-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--color-border-subtle);
}
.ueb-row:first-of-type {
  border-top: 0;
}
.ueb-row-title {
  font-size: 13px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ueb-row-meta {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
  font-family: var(--font-mono, monospace);
}

.link-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0;
  transition: color 180ms ease;
}
.link-btn:hover {
  color: var(--color-text);
}

.desc-edit-btn {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 180ms ease;
}
.desc-edit-btn:hover {
  color: var(--color-text);
  background: var(--color-bg-subtle);
}

.desc-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
}
.desc-empty {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-faint);
  font-style: italic;
}

/* ── Bautagebuch (Migration 011) ───────────────────────── */
.bt-tab {
  padding-top: 4px;
}
.bt-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 18px;
  align-items: start;
}
.bt-list {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  max-height: 600px;
  overflow-y: auto;
}
.bt-list-row {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 120ms ease;
}
.bt-list-row:last-child {
  border-bottom: none;
}
.bt-list-row:hover {
  background: var(--color-bg-subtle);
}
.bt-list-row-active {
  background: var(--color-bg-subtle);
  border-left: 3px solid var(--color-accent, var(--color-text));
  padding-left: 9px;
}
.bt-row-date {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 6px;
}
.bt-row-icon {
  font-size: 14px;
}
.bt-row-summary {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 3px;
  line-height: 1.4;
  word-break: break-word;
}
.bt-row-incident {
  font-size: 11px;
  color: var(--color-warning-text, #b45309);
  margin-top: 3px;
}
.bt-editor {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  min-height: 400px;
}
.bt-field {
  margin-bottom: 14px;
}
.bt-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.bt-day-nav {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 180ms ease;
  flex-shrink: 0;
}
.bt-day-nav:hover {
  color: var(--color-text);
  border-color: var(--color-text-faint);
  background: var(--color-bg);
}

@media (max-width: 768px) {
  .bt-grid {
    grid-template-columns: 1fr;
  }
  .bt-list {
    max-height: 280px;
  }
}

/* ── Meetings (Migration 012) ──────────────────────────── */
.mt-tab {
  padding-top: 4px;
}
.mt-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 18px;
  align-items: start;
}
.mt-list {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  max-height: 600px;
  overflow-y: auto;
}
.mt-list-row {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 120ms ease;
}
.mt-list-row:last-child {
  border-bottom: none;
}
.mt-list-row:hover {
  background: var(--color-bg-subtle);
}
.mt-list-row-active {
  background: var(--color-bg-subtle);
  border-left: 3px solid var(--color-accent, var(--color-text));
  padding-left: 9px;
}
.mt-row-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.mt-row-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
}
.mt-row-type {
  font-size: 10px;
  padding: 1px 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-text-muted);
}
.mt-row-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  word-break: break-word;
  line-height: 1.3;
}
.mt-row-attendees {
  font-size: 11px;
  color: var(--color-text-faint);
  margin-top: 3px;
}
.mt-editor {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  min-height: 400px;
}
.mt-field {
  margin-bottom: 14px;
}
.mt-row-fields {
  display: grid;
  grid-template-columns: 1fr 100px 100px 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.mt-row-fields .mt-field {
  margin-bottom: 0;
}
.mt-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}
.mt-todo-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mt-todo-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mt-todo-check {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.mt-todo-done {
  text-decoration: line-through;
  color: var(--color-text-faint);
}
.mt-todo-task-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-success-text, #16a34a);
  padding: 4px 8px;
  background: var(--color-success-bg, color-mix(in srgb, #16a34a 10%, transparent));
  border-radius: 4px;
  white-space: nowrap;
}

/* ── Stunden (Migration 014) ───────────────────────────── */
.time-tab {
  padding-top: 4px;
}
.time-summary {
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: var(--color-bg-subtle);
}
.time-summary-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.time-summary-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}
.time-summary-label {
  flex: 1;
  color: var(--color-text);
  font-weight: 500;
}
.time-summary-hours {
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  color: var(--color-text);
  min-width: 60px;
  text-align: right;
}
.time-summary-count {
  font-size: 11px;
  color: var(--color-text-muted);
  min-width: 40px;
  text-align: right;
}
.time-grid {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: 18px;
  align-items: start;
}
.time-list {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  max-height: 600px;
  overflow-y: auto;
}
.time-row {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  cursor: pointer;
  transition: background 120ms ease;
}
.time-row:last-child {
  border-bottom: none;
}
.time-row:hover {
  background: var(--color-bg-subtle);
}
.time-row-active {
  background: var(--color-bg-subtle);
  border-left: 3px solid var(--color-accent, var(--color-text));
  padding-left: 9px;
}
.time-row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.time-row-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
}
.time-row-hours {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text);
  font-family: var(--font-mono, monospace);
}
.time-row-name {
  font-size: 13px;
  color: var(--color-text);
  word-break: break-word;
}
.time-row-activity {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 3px;
}
.time-editor {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  min-height: 360px;
}
.time-field {
  margin-bottom: 14px;
}
.time-row-fields {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.time-row-fields .time-field {
  margin-bottom: 0;
}
.time-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

@media (max-width: 768px) {
  .time-grid {
    grid-template-columns: 1fr;
  }
  .time-list {
    max-height: 280px;
  }
  .time-row-fields {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 768px) {
  .mt-grid {
    grid-template-columns: 1fr;
  }
  .mt-list {
    max-height: 280px;
  }
  .mt-row-fields {
    grid-template-columns: 1fr 1fr;
  }
}

/* ── Aktions-Menue ─────────────────────────────────────── */
.action-menu-wrapper {
  position: relative;
}
.action-btn {
  width: 28px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 180ms ease;
}
.action-btn:hover {
  color: var(--color-text);
  border-color: var(--color-text-faint);
}

.action-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 50;
}
.action-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: none;
  border-radius: 5px;
  font-size: 12px;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}
.action-menu-item:hover {
  background: var(--color-bg-subtle);
}
.action-menu-item svg {
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.action-menu-danger {
  color: var(--color-danger-text);
}
.action-menu-danger svg {
  color: var(--color-danger-text);
}
.action-menu-danger:hover {
  background: color-mix(in srgb, var(--color-danger-text) 10%, transparent);
}
.action-menu-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 4px 2px;
}

/* ── Modal (Loesch-Bestaetigung) ───────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, #000 55%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 80px 20px 20px;
  z-index: 1000;
  overflow-y: auto;
}
.modal-card {
  width: 100%;
  max-width: 480px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px 28px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}

.patio-btn.danger {
  background: var(--color-danger-text, #dc2626);
  color: #fff;
  border: 1px solid transparent;
}
.patio-btn.danger:hover {
  filter: brightness(0.92);
}
.patio-btn.danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Zugriff-Tab (Phase 3) ────────────────────────────── */
.access-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-subtle);
  transition: background 180ms ease;
}
.access-row:first-child {
  border-top: 0;
}
.access-row:hover {
  background: var(--color-bg-subtle);
}
.access-remove {
  background: transparent;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: all 180ms ease;
}
.access-row:hover .access-remove {
  opacity: 1;
}
.access-remove:hover {
  color: var(--color-danger-text);
  background: var(--color-bg);
}

/* ── Maps-Link ─────────────────────────────────────────── */
.maps-link {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px dashed var(--color-text-faint);
  transition: all 180ms ease;
}
.maps-link:hover {
  color: var(--color-text);
  border-bottom-color: var(--color-primary);
}

/* ── Projekt-Farbe (Hero-Akzent) ───────────────────────── */
.hero-with-accent {
  border-top: 3px solid var(--accent-color);
}

.color-picker-wrapper {
  position: relative;
}
.color-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition:
    transform 120ms ease,
    border-color 180ms ease;
}
.color-swatch:hover {
  transform: scale(1.1);
  border-color: var(--color-text-faint);
}
.color-swatch-empty {
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 3px,
    var(--color-border-subtle) 3px,
    var(--color-border-subtle) 5px
  ) !important;
}

.color-picker {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  display: grid;
  grid-template-columns: repeat(4, 24px);
  gap: 6px;
  padding: 8px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 50;
}
.color-option {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  transition: transform 120ms ease;
  padding: 0;
}
.color-option:hover {
  transform: scale(1.15);
}
.color-option-active {
  box-shadow:
    0 0 0 2px var(--color-bg),
    0 0 0 3px var(--color-text);
}
.color-option-empty {
  background: transparent !important;
}

/* ── Form-Input (lokal fuer Rename-Modal) ───────────────── */
.form-input-lg {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 14px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 180ms ease;
}
.form-input-lg:focus {
  border-color: var(--color-primary);
}

/* ── Quick-Add in Uebersichts-Cards ────────────────────── */
.quick-add {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-border-subtle);
}
.quick-input {
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 12px;
  outline: none;
  min-width: 0;
  font-family: inherit;
}
.quick-input:focus {
  border-color: var(--color-primary);
}
.quick-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg-subtle);
  color: var(--color-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 180ms ease;
}
.quick-btn:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-text-faint);
}
.quick-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Parent-Breadcrumb ────────────────────────────────── */
.parent-crumb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 500;
}
.parent-link {
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color 180ms ease;
}
.parent-link:hover {
  color: var(--color-text);
  text-decoration: underline;
}

/* ── Verknuepfungs-Chips + Dropdown ───────────────────── */
.link-row {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.link-picker-wrapper {
  position: relative;
}
.link-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 11px;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-text);
  cursor: pointer;
  transition: all 180ms ease;
}
.link-chip:hover {
  border-color: var(--color-text-faint);
}

.link-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 240px;
  max-width: 320px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 50;
}
.link-dropdown-header {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 8px 10px 4px;
}
.link-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}
.link-dropdown-item:hover {
  background: var(--color-bg-subtle);
}
.link-dropdown-active {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}
.link-dropdown-clear {
  color: var(--color-text-muted);
  font-size: 11px;
}
.link-dropdown-clear svg {
  color: var(--color-text-muted);
}
.link-dropdown-divider {
  height: 1px;
  background: var(--color-border-subtle);
  margin: 4px 2px;
}
.link-dropdown-empty {
  font-size: 11px;
  color: var(--color-text-faint);
  padding: 8px 10px;
  margin: 0;
  text-align: center;
}

/* ── Kinder-Liste in Uebersicht ───────────────────────── */
.children-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px;
}
.child-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  text-decoration: none;
  color: var(--color-text);
  transition: all 180ms ease;
}
.child-card:hover {
  border-color: var(--color-text-faint);
  background: var(--color-bg-subtle);
}
.child-name {
  flex: 1;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Projekt-Kopf (ap-phead) — rahmenlos, wie Referenz ─────── */
.ap-phead {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6, 24px);
  margin-bottom: var(--space-6, 24px);
}
.ap-ptitle {
  font-family: var(--font-display, "Inter Tight", "Inter", sans-serif);
  font-size: var(--fs-36, 36px);
  font-weight: var(--fw-semibold, 600);
  letter-spacing: var(--tracking-display, -0.03em);
  line-height: var(--lh-tight, 1.1);
  color: var(--fg, var(--color-text));
  margin: 0 0 var(--space-3, 12px);
}
.ap-phead-l {
  min-width: 0;
  flex: 1;
}
.ap-pmeta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  font-size: 13px;
  color: var(--color-text-muted);
}
.ap-pmeta .sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--color-border);
  display: inline-block;
}
.ap-phead-r {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  flex: none;
}
.ap-prog {
  width: 200px;
}
.ap-prog-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}
.ap-prog-lbl {
  font-size: 11px;
  color: var(--color-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 500;
}
.ap-prog-val {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
/* pt-progress — bar track */
.pt-progress {
  height: 4px;
  background: var(--color-border);
  border-radius: 999px;
  overflow: hidden;
}
.pt-progress i {
  display: block;
  height: 100%;
  background: var(--color-primary, #f59e0b);
  border-radius: 999px;
  transition: width 300ms ease;
}

/* ── ap-tabs wrapper ───────────────────────────────── */
.ap-tabs {
  margin-bottom: 20px;
}

/* ── ap-grid / ap-col ──────────────────────────────── */
.ap-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 900px) {
  .ap-grid {
    grid-template-columns: 1fr;
  }
  .ap-phead {
    flex-direction: column;
    gap: 12px;
  }
  .ap-phead-r {
    align-items: flex-start;
  }
}
.ap-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* ── ap-panel ──────────────────────────────────────── */
.ap-panel {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}
.ap-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.ap-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: -0.01em;
}
.ap-panel-sub {
  font-size: 12px;
  color: var(--color-text-faint);
}
.ap-panel-body {
  padding: 16px;
}
.ap-panel-body.flush {
  padding: 0;
}

/* ── ap-dl (Stammdaten definition list) ────────────── */
.ap-dl {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 8px 12px;
  margin: 0;
}
.ap-dl dt {
  font-size: 13px;
  color: var(--color-text-muted);
}
.ap-dl dd {
  margin: 0;
  font-size: 13px;
  color: var(--color-text);
  font-weight: 500;
}

/* ── ap-termin ─────────────────────────────────────── */
.ap-termin {
  display: flex;
  gap: 14px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.ap-termin:last-child {
  border-bottom: 0;
}
.ap-termin-date {
  flex: none;
  width: 40px;
  text-align: center;
}
.ap-termin-date .d {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1;
  display: block;
}
.ap-termin-date .m {
  font-size: 11px;
  color: var(--color-text-faint);
  text-transform: uppercase;
  display: block;
  margin-top: 2px;
}
.ap-termin-body {
  min-width: 0;
}
.ap-termin-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}
.ap-termin-meta {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

/* ── pt-list-item (tasks / team in overview) ───────── */
.pt-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.pt-list-item:last-child {
  border-bottom: 0;
}
.pt-check {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  accent-color: var(--color-primary, #f59e0b);
}
.pt-list-grow {
  flex: 1;
  min-width: 0;
}
.pt-li-title {
  font-size: 13px;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pt-li-title.is-done {
  text-decoration: line-through;
  color: var(--color-text-faint);
}
.pt-li-meta {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

/* ── Hero Eyebrow (kept for breadcrumb line) ───────── */
.hero-eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-faint);
}

/* ── ueb-stamm-value (click-to-edit in ap-dl) ──────── */
.ueb-stamm-value {
  color: var(--color-text);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  text-align: left;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
}
.ueb-stamm-value:hover {
  color: var(--color-primary);
}

/* ── Inline-Editor im Stammdaten-Panel (verlagert aus der alten Leiste) ── */
.ueb-stamm-edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ueb-stamm-edit .pt-input,
.ueb-stamm-edit .pt-select {
  width: 100%;
  max-width: 240px;
}
.ueb-stamm-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ueb-stamm-err {
  font-size: 11px;
  color: var(--color-danger-text);
  margin-left: 4px;
}
.ueb-stamm-sugg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ueb-stamm-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md, 6px);
}
.ueb-link-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-subtle);
}

/* ── ueb-avatar (team member circle in overview) ───── */
.ueb-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
</style>

<!-- Global Print-Stylesheet — bewusst nicht scoped, damit wir App-Chrome
     (Sidebar, TopBar) ausblenden koennen. Selektoren bewusst defensiv und
     hochspezifisch, um nur bei der ProjectDetailView zu greifen. -->
<style>
@media print {
  /* App-Chrome ausblenden */
  .sidebar-root,
  .sidebar-backdrop,
  header,
  .back-link,
  .action-menu-wrapper,
  .color-picker-wrapper,
  .tab-btn,
  .quick-add,
  .link-row,
  .del-btn,
  .file-del-btn,
  .team-remove {
    display: none !important;
  }
  /* Layout fuer A4: volle Breite, keine Scrollbalken */
  body,
  html,
  #app {
    background: #fff !important;
    color: #000 !important;
  }
  .ap-phead,
  .ap-panel,
  .stat-tile {
    page-break-inside: avoid;
    border-color: #ccc !important;
    background: #fff !important;
    box-shadow: none !important;
  }
  /* Tab-Bar ausblenden, nur aktiver Inhalt wird gedruckt */
  .ap-tabs {
    display: none !important;
  }
  /* Kompaktere Schriften fuer Druck */
  h1 {
    font-size: 22px !important;
  }
  .stat-number {
    font-size: 20px !important;
  }
  /* Links schwarz, Unterstreichung erhalten */
  a {
    color: #000 !important;
    text-decoration: underline !important;
  }
}
</style>
