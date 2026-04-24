<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import BIcon from "../components/BIcon.vue";

// ── Typen ────────────────────────────────────────────────
type MemberType = "Intern" | "Planer" | "Ausführende" | "Behörde" | "Lieferant" | "Bauherr";

interface TeamMemberProject {
  id: string;
  name: string;
  projectRole: string | null;
}
interface ContactLogEntry {
  ts: string;
  text: string;
  author?: string;
}
interface TeamMember {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  companyId: string | null;
  companyName: string | null;
  memberType: MemberType | null;
  projects: TeamMemberProject[];
  contactLog: ContactLogEntry[];
  createdAt: string;
  updatedAt: string;
}
interface ProjectSummary {
  id: string;
  name: string;
  status?: string;
}
interface Task {
  id: string;
  text: string;
  status: string;
  assignee: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  date: string | null;
  project: string | null;
}
interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  assignees: string[];
  assigneeIds?: string[];
  project: string | null;
}

// ── State ────────────────────────────────────────────────
const route = useRoute();
const router = useRouter();
const memberId = ref("");
const member = ref<TeamMember | null>(null);
const loading = ref(false);

type Tab = "projekte" | "aufgaben" | "termine" | "log";
const tab = ref<Tab>("projekte");

// Aufgaben + Termine dieser Person (Phase 3)
const tasks = ref<Task[]>([]);
const termine = ref<Termin[]>([]);
const tasksLoaded = ref(false);

// Projekt-Zuordnung
const allProjects = ref<ProjectSummary[]>([]);
const allProjectsLoaded = ref(false);
const assignProjectId = ref("");
const assignProjectRole = ref("");
const assigning = ref(false);
const assignError = ref<string | null>(null);

// Log-Eintrag
const newLogText = ref("");
const logSaving = ref(false);

// Aktions-Menue
const showActionMenu = ref(false);
const deleteConfirmOpen = ref(false);
const deleting = ref(false);

// Inline-Edit Stammdaten
type EditableKey = "role" | "companyName" | "email" | "phone" | "memberType";
const editingField = ref<EditableKey | null>(null);
const draftValue = ref<string>("");
const saving = ref(false);

// Rename
const renameDialogOpen = ref(false);
const renameDraft = ref("");
const renaming = ref(false);
const renameError = ref<string | null>(null);

const MEMBER_TYPES: MemberType[] = [
  "Intern",
  "Planer",
  "Ausführende",
  "Behörde",
  "Lieferant",
  "Bauherr",
];

// ── Computed ─────────────────────────────────────────────
function typeColor(t: MemberType | null): string {
  switch (t) {
    case "Intern":
      return "#3b82f6";
    case "Planer":
      return "#a855f7";
    case "Ausführende":
      return "#f59e0b";
    case "Behörde":
      return "#64748b";
    case "Lieferant":
      return "#10b981";
    case "Bauherr":
      return "#ec4899";
    default:
      return "#9ca3af";
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

// Kandidaten fuers Projekt-Zuordnen: alle Projekte minus bereits zugeordnete.
const projectCandidates = computed<ProjectSummary[]>(() => {
  if (!member.value) return [];
  const assigned = new Set(member.value.projects.map((p) => p.id));
  return allProjects.value.filter((p) => !assigned.has(p.id));
});

// ── Load ─────────────────────────────────────────────────
async function loadMember() {
  loading.value = true;
  try {
    member.value = await api.get<TeamMember>(`/team/${encodeURIComponent(memberId.value)}`);
  } catch {
    member.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadAllProjects() {
  if (allProjectsLoaded.value) return;
  try {
    const list = await api.get<ProjectSummary[]>("/projects");
    allProjects.value = list;
    allProjectsLoaded.value = true;
  } catch {
    allProjects.value = [];
  }
}

// Laedt Tasks + Termine global und filtert client-seitig auf diese Person.
// Kein spezifischer Endpoint noetig — die Listen sind klein genug und das
// erspart uns eine zusaetzliche API-Route nur fuer Team-Detail.
async function loadAssignedTasksAndTermine() {
  if (tasksLoaded.value || !memberId.value) return;
  try {
    const [allTasks, allTermine] = await Promise.all([
      api.get<Task[]>("/tasks"),
      api.get<Termin[]>("/termine"),
    ]);
    tasks.value = allTasks.filter((t) => t.assigneeId === memberId.value);
    termine.value = allTermine.filter((te) => te.assigneeIds?.includes(memberId.value));
    tasksLoaded.value = true;
  } catch {
    tasks.value = [];
    termine.value = [];
  }
}

async function openTab(t: Tab) {
  tab.value = t;
  if ((t === "aufgaben" || t === "termine") && !tasksLoaded.value) {
    await loadAssignedTasksAndTermine();
  }
}

async function completeTask(task: Task) {
  try {
    await api.patch(`/tasks/${encodeURIComponent(task.id)}/complete`, {});
    await loadAssignedTasksAndTermine();
  } catch {
    /* no-op */
  }
}

// ── Inline-Edit ──────────────────────────────────────────
function startEdit(key: EditableKey) {
  if (!member.value) return;
  editingField.value = key;
  const raw = (member.value as unknown as Record<string, unknown>)[key];
  draftValue.value = raw == null ? "" : String(raw);
}
function cancelEdit() {
  editingField.value = null;
  draftValue.value = "";
}
async function saveField(key: EditableKey) {
  if (!member.value || saving.value) return;
  saving.value = true;
  const newValue = draftValue.value.trim() === "" ? null : draftValue.value.trim();
  const before = (member.value as unknown as Record<string, unknown>)[key];
  (member.value as unknown as Record<string, unknown>)[key] = newValue;
  editingField.value = null;
  try {
    member.value = await api.patch<TeamMember>(
      `/team/${encodeURIComponent(memberId.value)}`,
      { [key]: newValue },
    );
  } catch {
    (member.value as unknown as Record<string, unknown>)[key] = before;
  } finally {
    saving.value = false;
  }
}
function onEditKey(e: KeyboardEvent, key: EditableKey) {
  if (e.key === "Escape") cancelEdit();
  else if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void saveField(key);
  }
}

// ── Projekt zuordnen / entfernen / Rolle setzen ─────────
async function assignProject() {
  if (!assignProjectId.value || !member.value || assigning.value) return;
  assigning.value = true;
  assignError.value = null;
  try {
    member.value = await api.post<TeamMember>(
      `/team/${encodeURIComponent(memberId.value)}/projects`,
      {
        projectId: assignProjectId.value,
        projectRole: assignProjectRole.value.trim() || null,
      },
    );
    assignProjectId.value = "";
    assignProjectRole.value = "";
  } catch (e) {
    assignError.value = e instanceof Error ? e.message : "Zuordnung fehlgeschlagen";
  } finally {
    assigning.value = false;
  }
}

async function unassignProject(projectId: string) {
  if (!member.value) return;
  if (!confirm("Zuordnung zu diesem Projekt entfernen?")) return;
  try {
    await api.delete(
      `/team/${encodeURIComponent(memberId.value)}/projects/${encodeURIComponent(projectId)}`,
    );
    await loadMember();
  } catch {
    /* no-op */
  }
}

async function updateProjectRole(projectId: string, newRole: string) {
  try {
    await api.patch(
      `/team/${encodeURIComponent(memberId.value)}/projects/${encodeURIComponent(projectId)}`,
      { projectRole: newRole.trim() || null },
    );
    await loadMember();
  } catch {
    /* no-op */
  }
}

// ── Kontakt-Log ──────────────────────────────────────────
async function addLogEntry() {
  const text = newLogText.value.trim();
  if (!text || logSaving.value) return;
  logSaving.value = true;
  try {
    await api.post(`/team/${encodeURIComponent(memberId.value)}/log`, { text });
    newLogText.value = "";
    await loadMember();
  } catch {
    /* no-op */
  } finally {
    logSaving.value = false;
  }
}

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `vor ${diffHrs} Std`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `vor ${diffDays} Tg`;
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ── Rename ───────────────────────────────────────────────
function openRenameDialog() {
  if (!member.value) return;
  showActionMenu.value = false;
  renameDraft.value = member.value.name;
  renameError.value = null;
  renameDialogOpen.value = true;
}
async function submitRename() {
  if (!member.value || renaming.value) return;
  const newName = renameDraft.value.trim();
  if (!newName || newName === member.value.name) {
    renameDialogOpen.value = false;
    return;
  }
  renaming.value = true;
  try {
    member.value = await api.patch<TeamMember>(
      `/team/${encodeURIComponent(memberId.value)}`,
      { name: newName },
    );
    renameDialogOpen.value = false;
  } catch (e) {
    renameError.value = e instanceof Error ? e.message : "Umbenennen fehlgeschlagen";
  } finally {
    renaming.value = false;
  }
}

// ── Delete ───────────────────────────────────────────────
async function confirmDelete() {
  if (!member.value || deleting.value) return;
  deleting.value = true;
  try {
    await api.delete(`/team/${encodeURIComponent(member.value.name)}`);
    router.push("/team");
  } catch {
    deleting.value = false;
  }
}

// ── Action-Menue Click-Away ─────────────────────────────
function toggleActionMenu() {
  showActionMenu.value = !showActionMenu.value;
}
function onGlobalClick(ev: MouseEvent) {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (!target.closest(".action-menu-wrapper")) showActionMenu.value = false;
}

onMounted(async () => {
  memberId.value = route.params.id as string;
  await loadMember();
  await loadAllProjects();
  document.addEventListener("mousedown", onGlobalClick);
});
onUnmounted(() => {
  document.removeEventListener("mousedown", onGlobalClick);
});
</script>

<template>
  <div style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)">
    <!-- Back -->
    <button @click="router.push('/team')" class="back-link">
      <BIcon name="arrowLeft" :size="12" />
      Alle Personen
    </button>

    <div v-if="loading" style="font-size: 13px; color: var(--color-text-muted)">Lade…</div>

    <div v-else-if="!member" class="empty-hint">
      Mitglied nicht gefunden.
    </div>

    <template v-else>
      <!-- Hero -->
      <div class="hero" :style="{ '--accent-color': typeColor(member.memberType) }">
        <div class="flex items-start justify-between" style="gap: 16px; margin-bottom: 16px">
          <div class="flex items-center" style="gap: 16px; min-width: 0; flex: 1">
            <div class="hero-avatar" :style="{ background: typeColor(member.memberType) }">
              {{ initial(member.name) }}
            </div>
            <div style="min-width: 0">
              <div class="eyebrow" style="margin-bottom: 4px">Person</div>
              <h1 style="font-size: 24px; font-weight: 600; margin: 0; letter-spacing: -0.01em">
                {{ member.name }}
              </h1>
              <p
                v-if="member.role || member.companyName || member.company"
                style="font-size: 13px; color: var(--color-text-muted); margin: 4px 0 0 0"
              >
                <span v-if="member.role">{{ member.role }}</span>
                <span v-if="member.role && (member.companyName || member.company)"> · </span>
                <span v-if="member.companyName || member.company">
                  {{ member.companyName ?? member.company }}
                </span>
              </p>
            </div>
          </div>
          <div class="flex items-center" style="gap: 8px; flex-shrink: 0">
            <span
              v-if="member.memberType"
              class="member-pill"
              :style="{ color: typeColor(member.memberType), borderColor: typeColor(member.memberType) }"
            >
              {{ member.memberType }}
            </span>
            <div class="action-menu-wrapper">
              <button class="action-btn" @click="toggleActionMenu" :title="'Weitere Aktionen'">
                <BIcon name="more" :size="14" />
              </button>
              <div v-if="showActionMenu" class="action-menu">
                <button class="action-menu-item" @click="openRenameDialog">
                  <BIcon name="pencil" :size="12" /><span>Umbenennen…</span>
                </button>
                <div class="action-menu-divider"></div>
                <button
                  class="action-menu-item action-menu-danger"
                  @click="showActionMenu = false; deleteConfirmOpen = true"
                >
                  <BIcon name="x" :size="12" /><span>Person löschen…</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Kontakt-Chips -->
        <div class="flex items-center flex-wrap" style="gap: 6px; margin-bottom: 12px">
          <a v-if="member.email" :href="`mailto:${member.email}`" class="contact-chip">
            <BIcon name="message" :size="11" />
            <span>{{ member.email }}</span>
          </a>
          <a v-if="member.phone" :href="`tel:${member.phone}`" class="contact-chip">
            <BIcon name="bell" :size="11" />
            <span>{{ member.phone }}</span>
          </a>
          <a
            v-if="member.phone"
            :href="`https://wa.me/${member.phone.replace(/[^0-9+]/g, '')}`"
            target="_blank"
            rel="noopener"
            class="contact-chip"
            :title="'WhatsApp'"
          >
            WA
          </a>
        </div>

        <!-- Stammdaten-Grid (inline-edit) -->
        <div class="stamm-grid">
          <div
            v-for="f in [
              { key: 'role' as const, label: 'Rolle / Beruf', type: 'text', placeholder: 'z.B. Dipl.-Ing., Polier' },
              { key: 'companyName' as const, label: 'Firma', type: 'text', placeholder: 'Firmenname' },
              { key: 'memberType' as const, label: 'Kategorie', type: 'enum' },
              { key: 'email' as const, label: 'E-Mail', type: 'email', placeholder: 'max@beispiel.at' },
              { key: 'phone' as const, label: 'Telefon', type: 'tel', placeholder: '+43 …' },
            ]"
            :key="f.key"
            class="stamm-field"
          >
            <div class="eyebrow stamm-label">{{ f.label }}</div>
            <div v-if="editingField === f.key" class="stamm-edit">
              <select
                v-if="f.type === 'enum'"
                v-model="draftValue"
                class="stamm-input"
                @keyup="(e) => onEditKey(e, f.key)"
              >
                <option value="">—</option>
                <option v-for="t in MEMBER_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <input
                v-else
                v-model="draftValue"
                :type="f.type"
                :placeholder="f.placeholder"
                class="stamm-input"
                @keyup="(e) => onEditKey(e, f.key)"
                autofocus
              />
              <div class="flex" style="gap: 6px; margin-top: 6px">
                <button class="bauos-btn solid sm" :disabled="saving" @click="saveField(f.key)">
                  {{ saving ? "…" : "Speichern" }}
                </button>
                <button class="bauos-btn ghost sm" @click="cancelEdit">Abbrechen</button>
              </div>
            </div>
            <button v-else class="stamm-value" @click="startEdit(f.key)">
              <span v-if="(member as unknown as Record<string, unknown>)[f.key]" class="stamm-value-text">
                {{ (member as unknown as Record<string, unknown>)[f.key] }}
              </span>
              <span v-else class="stamm-value-empty">—</span>
              <BIcon name="pencil" :size="11" class="stamm-edit-icon" />
            </button>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div
        class="flex"
        style="gap: 24px; margin-top: 24px; margin-bottom: 20px; border-bottom: 1px solid var(--color-border); overflow-x: auto"
      >
        <button
          v-for="t in (['projekte', 'aufgaben', 'termine', 'log'] as const)"
          :key="t"
          @click="openTab(t)"
          :class="['tab-btn', tab === t ? 'tab-btn-active' : '']"
        >
          {{
            t === "projekte"
              ? "Projekte"
              : t === "aufgaben"
                ? "Aufgaben"
                : t === "termine"
                  ? "Termine"
                  : "Kontakt-Log"
          }}
        </button>
      </div>

      <!-- Projekte-Tab -->
      <div v-if="tab === 'projekte'">
        <div class="flex items-center" style="gap: 8px; margin-bottom: 14px; flex-wrap: wrap">
          <select
            v-model="assignProjectId"
            class="form-input"
            style="max-width: 260px; flex: 0 1 260px"
            :disabled="projectCandidates.length === 0 || assigning"
          >
            <option value="">
              {{ projectCandidates.length === 0 ? "Keine weiteren Projekte" : "Projekt zuordnen…" }}
            </option>
            <option v-for="p in projectCandidates" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <input
            v-model="assignProjectRole"
            type="text"
            placeholder="Rolle im Projekt (optional)"
            class="form-input"
            style="max-width: 220px; flex: 0 1 220px"
            @keyup.enter="assignProject"
          />
          <button class="bauos-btn solid sm" :disabled="!assignProjectId || assigning" @click="assignProject">
            {{ assigning ? "…" : "Zuordnen" }}
          </button>
          <span v-if="assignError" style="font-size: 11px; color: var(--color-danger-text)">
            {{ assignError }}
          </span>
        </div>

        <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
          <div
            v-for="p in member.projects"
            :key="p.id"
            class="project-row"
          >
            <router-link :to="`/projects/${encodeURIComponent(p.name)}`" class="project-link">
              <BIcon name="folder" :size="14" style="color: var(--color-text-muted); flex-shrink: 0" />
              <span style="font-size: 13px; color: var(--color-text)">{{ p.name }}</span>
            </router-link>
            <input
              type="text"
              :value="p.projectRole ?? ''"
              :placeholder="'Rolle (z.B. Statiker)'"
              class="project-role-input"
              @change="updateProjectRole(p.id, ($event.target as HTMLInputElement).value)"
            />
            <button class="project-remove" @click="unassignProject(p.id)" :title="'Entfernen'">
              <BIcon name="x" :size="12" />
            </button>
          </div>
          <p v-if="member.projects.length === 0" class="empty-hint">
            Noch keinem Projekt zugeordnet.
          </p>
        </div>
      </div>

      <!-- Aufgaben-Tab (Phase 3): Tasks wo assignee_id = member -->
      <div v-if="tab === 'aufgaben'">
        <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
          <div
            v-for="t in tasks.filter((x) => x.status !== 'done')"
            :key="t.id"
            class="flex items-center"
            style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
          >
            <input
              type="checkbox"
              @change="completeTask(t)"
              style="accent-color: var(--color-primary)"
            />
            <div style="flex: 1; min-width: 0">
              <div style="font-size: 13px; color: var(--color-text)">{{ t.text }}</div>
              <div
                v-if="t.project || t.date"
                style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px"
                class="font-mono"
              >
                <router-link
                  v-if="t.project"
                  :to="`/projects/${encodeURIComponent(t.project)}`"
                  style="color: inherit; text-decoration: none"
                  @click.stop
                >
                  {{ t.project }}
                </router-link>
                <span v-if="t.project && t.date"> · </span>
                <span v-if="t.date">{{ t.date }}</span>
              </div>
            </div>
          </div>
          <div
            v-for="t in tasks.filter((x) => x.status === 'done')"
            :key="'done-' + t.id"
            style="padding: 10px 16px; border-top: 1px solid var(--color-border-subtle); opacity: 0.5"
          >
            <div style="font-size: 13px; text-decoration: line-through; color: var(--color-text-muted)">
              {{ t.text }}
            </div>
          </div>
          <p v-if="tasksLoaded && tasks.length === 0" class="empty-hint">
            Keine Aufgaben zugewiesen.
          </p>
          <p v-else-if="!tasksLoaded" class="empty-hint">Lade Aufgaben…</p>
        </div>
      </div>

      <!-- Termine-Tab (Phase 3): Termine wo member in assignee_ids -->
      <div v-if="tab === 'termine'">
        <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
          <div
            v-for="te in termine"
            :key="te.id"
            class="flex items-center"
            style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
          >
            <div style="flex: 1; min-width: 0">
              <div style="font-size: 13px; color: var(--color-text)">{{ te.text }}</div>
              <div
                style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px"
                class="font-mono"
              >
                {{ te.datum }}<span v-if="te.uhrzeit"> · {{ te.uhrzeit }}</span>
                <template v-if="te.project">
                  ·
                  <router-link
                    :to="`/projects/${encodeURIComponent(te.project)}`"
                    style="color: inherit; text-decoration: none"
                    @click.stop
                  >
                    {{ te.project }}
                  </router-link>
                </template>
              </div>
            </div>
          </div>
          <p v-if="tasksLoaded && termine.length === 0" class="empty-hint">
            Keine Termine mit dieser Person.
          </p>
          <p v-else-if="!tasksLoaded" class="empty-hint">Lade Termine…</p>
        </div>
      </div>

      <!-- Log-Tab -->
      <div v-if="tab === 'log'">
        <div class="flex items-start" style="gap: 8px; margin-bottom: 14px">
          <textarea
            v-model="newLogText"
            rows="2"
            placeholder="Neuer Eintrag — z.B. Tel-Notiz, Gespräch, Vereinbarung…"
            class="form-input"
            style="flex: 1; resize: vertical; font-family: inherit; line-height: 1.5"
            @keyup.ctrl.enter="addLogEntry"
          ></textarea>
          <button class="bauos-btn solid sm" :disabled="!newLogText.trim() || logSaving" @click="addLogEntry">
            {{ logSaving ? "…" : "Hinzufügen" }}
          </button>
        </div>
        <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
          <div
            v-for="(entry, i) in [...member.contactLog].reverse()"
            :key="`${entry.ts}-${i}`"
            class="log-row"
          >
            <div class="log-meta">
              <span class="font-mono">{{ formatLogTime(entry.ts) }}</span>
              <span v-if="entry.author" style="color: var(--color-text-faint)">
                · {{ entry.author }}
              </span>
            </div>
            <div class="log-text">{{ entry.text }}</div>
          </div>
          <p v-if="member.contactLog.length === 0" class="empty-hint">
            Noch keine Einträge. Tippe oben einen neuen.
          </p>
        </div>
      </div>
    </template>

    <!-- Rename-Dialog -->
    <div v-if="renameDialogOpen" class="modal-overlay" @click.self="renameDialogOpen = false">
      <div class="modal-card" style="max-width: 440px">
        <div class="eyebrow" style="margin-bottom: 4px">Umbenennen</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0">Namen ändern</h2>
        <input
          v-model="renameDraft"
          type="text"
          class="form-input-lg"
          style="width: 100%"
          @keyup.enter="submitRename"
          @keyup.esc="renameDialogOpen = false"
          autofocus
        />
        <div
          v-if="renameError"
          style="margin-top: 12px; padding: 8px 12px; font-size: 12px; color: var(--color-danger-text); background: color-mix(in srgb, var(--color-danger-text) 10%, transparent); border-radius: 6px"
        >
          {{ renameError }}
        </div>
        <div class="flex justify-end" style="gap: 8px; margin-top: 20px">
          <button class="bauos-btn ghost" @click="renameDialogOpen = false" :disabled="renaming">
            Abbrechen
          </button>
          <button
            class="bauos-btn solid"
            :disabled="!renameDraft.trim() || renameDraft.trim() === member?.name || renaming"
            @click="submitRename"
          >
            {{ renaming ? "…" : "Umbenennen" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Loesch-Bestaetigung -->
    <div v-if="deleteConfirmOpen" class="modal-overlay" @click.self="deleteConfirmOpen = false">
      <div class="modal-card" style="max-width: 480px">
        <div class="eyebrow" style="color: var(--color-danger-text); margin-bottom: 6px">Achtung</div>
        <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 12px 0">
          „{{ member?.name }}" wirklich löschen?
        </h2>
        <p style="font-size: 13px; color: var(--color-text-muted); line-height: 1.6; margin: 0">
          Das Mitglied wird aus allen Projekten entfernt und dauerhaft gelöscht.
          Aufgaben/Termine mit Verknüpfung zu dieser Person verlieren die Zuordnung
          (bleiben aber erhalten).
        </p>
        <div class="flex justify-end" style="gap: 8px; margin-top: 20px">
          <button class="bauos-btn ghost" @click="deleteConfirmOpen = false" :disabled="deleting">
            Abbrechen
          </button>
          <button class="bauos-btn danger" @click="confirmDelete" :disabled="deleting">
            {{ deleting ? "Lösche…" : "Ja, löschen" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.hero {
  border: 1px solid var(--color-border);
  border-top: 3px solid var(--accent-color, var(--color-border));
  border-radius: 10px;
  padding: 20px 24px;
  background: var(--color-bg);
}
.hero-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.member-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.contact-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  text-decoration: none;
  transition: all 180ms ease;
}
.contact-chip:hover {
  color: var(--color-text);
  border-color: var(--color-text-faint);
}

.stamm-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 18px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-subtle);
}
@media (max-width: 720px) {
  .stamm-grid {
    grid-template-columns: 1fr 1fr;
  }
}
.stamm-field {
  min-width: 0;
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

/* Tabs */
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
.tab-btn:hover {
  color: var(--color-text);
}
.tab-btn-active {
  color: var(--color-text);
  border-bottom-color: var(--color-primary);
}

/* Projekt-Rows */
.project-row {
  display: grid;
  grid-template-columns: 1fr 220px 28px;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-subtle);
  transition: background 180ms ease;
}
.project-row:first-child {
  border-top: 0;
}
.project-row:hover {
  background: var(--color-bg-subtle);
}
.project-link {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
}
.project-link:hover {
  color: var(--color-text);
}
.project-role-input {
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 11px;
  outline: none;
}
.project-role-input:focus {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.project-remove {
  background: transparent;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: all 180ms ease;
}
.project-row:hover .project-remove {
  opacity: 1;
}
.project-remove:hover {
  color: var(--color-danger-text);
  background: var(--color-bg);
}

/* Log */
.log-row {
  padding: 10px 16px;
  border-top: 1px solid var(--color-border-subtle);
}
.log-row:first-child {
  border-top: 0;
}
.log-meta {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}
.log-text {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
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

/* Aktions-Menue */
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
}
.action-menu-danger,
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

.bauos-btn.sm {
  padding: 4px 10px;
  font-size: 11px;
}
.bauos-btn.danger {
  background: var(--color-danger-text, #dc2626);
  color: #fff;
  border: 1px solid transparent;
}
.bauos-btn.danger:hover {
  filter: brightness(0.92);
}
.bauos-btn.danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-input {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
}
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

/* Modal */
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
</style>
