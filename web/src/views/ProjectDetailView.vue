<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import MarkdownRenderer from "../components/MarkdownRenderer.vue";
import BIcon from "../components/BIcon.vue";

interface ProjectInfo {
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
  notes: number;
  openTasks: number;
  termine: number;
  files?: number;
  createdAt?: string;
  updatedAt?: string;
}
interface Task {
  id: string;
  text: string;
  status: string;
  assignee: string | null;
  date: string | null;
}
interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  location: string | null;
  assignees: string[];
}

const route = useRoute();
const router = useRouter();
const projectName = ref("");
const info = ref<ProjectInfo | null>(null);
const notes = ref<string[]>([]);
const tasks = ref<Task[]>([]);
const termine = ref<Termin[]>([]);

const viewingNote = ref<string | null>(null);
const noteContent = ref("");
const newTask = ref("");
const newDatum = ref("");
const newUhrzeit = ref("");
const newTerminText = ref("");
// "uebersicht" wird spaeter in 3d zum Start-Tab — jetzt bleibt "notes" Default.
type Tab = "notes" | "tasks" | "termine" | "files" | "team" | "verlauf";
const tab = ref<Tab>("notes");

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
  await loadAll();
});

async function loadAll() {
  const n = encodeURIComponent(projectName.value);
  const [i, no, ta, te] = await Promise.all([
    api.get<ProjectInfo>(`/projects/${n}`),
    api.get<string[]>(`/projects/${n}/notes`),
    api.get<Task[]>(`/projects/${n}/tasks`),
    api.get<Termin[]>(`/projects/${n}/termine`),
  ]);
  info.value = i;
  notes.value = no;
  tasks.value = ta;
  termine.value = te;
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
  await api.post(`/projects/${n}/tasks`, { text: newTask.value });
  newTask.value = "";
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
  });
  newDatum.value = "";
  newUhrzeit.value = "";
  newTerminText.value = "";
  await loadAll();
}

async function removeTermin(t: Termin) {
  const n = encodeURIComponent(projectName.value);
  await api.delete(`/projects/${n}/termine`, { text: t.text });
  await loadAll();
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
</script>

<template>
  <div style="max-width: 1120px; margin: 0 auto; padding: 28px 32px 48px; color: var(--color-text)">
    <!-- Back-Link -->
    <button @click="router.push('/projects')" class="back-link">
      <BIcon name="arrowLeft" :size="12" />
      Alle Projekte
    </button>

    <!-- ═══ Hero ═══════════════════════════════════════════════ -->
    <div v-if="info" class="hero">
      <div class="flex items-start justify-between" style="gap: 16px; margin-bottom: 16px">
        <div class="min-w-0" style="flex: 1">
          <div class="eyebrow" style="margin-bottom: 6px">Projekt</div>
          <h1
            style="
              font-size: 28px;
              font-weight: 600;
              margin: 0;
              letter-spacing: -0.01em;
              color: var(--color-text);
            "
          >
            {{ info.name }}
          </h1>
          <!-- Kontextzeile: Projektart/Nutzung/Standort inline, falls gesetzt -->
          <p
            v-if="info.projektart || info.nutzung || info.standort"
            style="
              font-size: 13px;
              color: var(--color-text-muted);
              margin: 6px 0 0 0;
              line-height: 1.5;
            "
          >
            <span v-if="info.projektart">{{ info.projektart }}</span>
            <span v-if="info.projektart && info.nutzung"> · </span>
            <span v-if="info.nutzung">{{ info.nutzung }}</span>
            <span v-if="(info.projektart || info.nutzung) && info.standort"> · </span>
            <span v-if="info.standort">{{ info.standort }}</span>
          </p>
        </div>
        <!-- Pills: Status + Phase -->
        <div class="flex items-center" style="gap: 8px; flex-shrink: 0">
          <button
            class="pill pill-clickable"
            :class="'pill-status-' + (info.status ?? 'aktiv')"
            @click="startEdit('status')"
          >
            <span class="pill-dot" :style="{ background: 'var(--pill-dot-color, currentColor)' }" />
            {{ statusLabel }}
          </button>
          <button class="pill pill-clickable" @click="startEdit('phase')">
            <BIcon name="layers" :size="11" />
            {{ info.phase || "Phase setzen" }}
          </button>
        </div>
      </div>

      <!-- Status-Inline-Editor (getrennt von Stammdaten-Grid) -->
      <div v-if="editingField === 'status'" class="status-editor">
        <div class="eyebrow" style="margin-bottom: 6px">Status aendern</div>
        <select
          v-model="draftValue"
          class="stamm-input"
          style="max-width: 240px"
          @keyup="(e) => onEditKey(e, 'status')"
        >
          <option v-for="opt in STATUS_OPTIONS" :key="opt" :value="opt">
            {{ opt[0].toUpperCase() + opt.slice(1) }}
          </option>
        </select>
        <div class="flex items-center" style="gap: 6px; margin-top: 8px">
          <button class="bauos-btn solid sm" :disabled="saving" @click="saveField('status')">
            {{ saving ? "…" : "Speichern" }}
          </button>
          <button class="bauos-btn ghost sm" @click="cancelEdit">Abbrechen</button>
          <span v-if="saveError" style="font-size: 11px; color: var(--color-danger-text); margin-left: 4px">
            {{ saveError }}
          </span>
        </div>
      </div>

      <!-- Stammdaten-Grid (immer sichtbar, pro Feld Inline-Edit) -->
      <div class="stammdaten-grid">
        <template v-for="f in STAMMDATEN_FIELDS" :key="f.key">
          <div class="stamm-field" :class="{ 'stamm-field-editing': editingField === f.key }">
            <div class="eyebrow stamm-label">{{ f.label }}</div>

            <!-- Editing-Mode -->
            <div v-if="editingField === f.key" class="stamm-edit">
              <!-- Enum -->
              <select
                v-if="f.inputType === 'enum'"
                v-model="draftValue"
                class="stamm-input"
                @keyup="(e) => onEditKey(e, f.key)"
              >
                <option value="">—</option>
                <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
              <!-- Date -->
              <input
                v-else-if="f.inputType === 'date'"
                v-model="draftValue"
                type="date"
                class="stamm-input"
                @keyup="(e) => onEditKey(e, f.key)"
              />
              <!-- Text -->
              <input
                v-else
                v-model="draftValue"
                type="text"
                :placeholder="f.placeholder"
                class="stamm-input"
                @keyup="(e) => onEditKey(e, f.key)"
                autofocus
              />

              <div class="flex items-center" style="gap: 6px; margin-top: 6px">
                <button class="bauos-btn solid sm" :disabled="saving" @click="saveField(f.key)">
                  {{ saving ? "…" : "Speichern" }}
                </button>
                <button class="bauos-btn ghost sm" @click="cancelEdit">Abbrechen</button>
                <span
                  v-if="saveError"
                  style="font-size: 11px; color: var(--color-danger-text); margin-left: 4px"
                  >{{ saveError }}</span
                >
              </div>
              <!-- Freitext-Suggestions als Chips -->
              <div
                v-if="f.suggestions && f.suggestions.length"
                class="flex flex-wrap"
                style="gap: 4px; margin-top: 8px"
              >
                <button
                  v-for="sug in f.suggestions"
                  :key="sug"
                  @click="applyPhaseSuggestion(f.key, sug)"
                  class="chip-suggest"
                  type="button"
                >
                  {{ sug }}
                </button>
              </div>
            </div>

            <!-- View-Mode (klickbar = Edit starten) -->
            <button v-else class="stamm-value" @click="startEdit(f.key)" :title="'Klicken zum Bearbeiten'">
              <span v-if="info[f.key as keyof ProjectInfo]" class="stamm-value-text">
                {{ info[f.key as keyof ProjectInfo] }}
              </span>
              <span v-else class="stamm-value-empty">—</span>
              <BIcon name="pencil" :size="11" class="stamm-edit-icon" />
            </button>
          </div>
        </template>
      </div>

      <!-- Hinweis, wenn Stammdaten unvollstaendig -->
      <div v-if="emptyStammCount > 0" class="stamm-hint">
        <BIcon name="info" :size="12" />
        <span>{{ emptyStammCount }} Stammdaten fehlen noch — klicke ein Feld an, um es auszufüllen.</span>
      </div>
    </div>

    <!-- ═══ Quick-Stats (4 Kacheln) ════════════════════════════ -->
    <div
      v-if="info"
      class="grid"
      style="grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; margin-top: 24px"
    >
      <div class="stat-tile">
        <div class="eyebrow">Notizen</div>
        <div class="stat-number">{{ info.notes }}</div>
      </div>
      <div class="stat-tile">
        <div class="eyebrow">Offene Aufgaben</div>
        <div class="stat-number">{{ info.openTasks }}</div>
      </div>
      <div class="stat-tile">
        <div class="eyebrow">Termine</div>
        <div class="stat-number">{{ info.termine }}</div>
      </div>
      <div class="stat-tile">
        <div class="eyebrow">Dateien</div>
        <div class="stat-number">{{ info.files ?? 0 }}</div>
      </div>
    </div>

    <!-- ═══ Tab-Nav ════════════════════════════════════════════ -->
    <div
      class="flex"
      style="gap: 24px; margin-bottom: 20px; border-bottom: 1px solid var(--color-border); overflow-x: auto"
    >
      <button
        v-for="t in (['notes', 'tasks', 'termine', 'files', 'team', 'verlauf'] as const)"
        :key="t"
        @click="
          tab = t;
          viewingNote = null;
        "
        :class="['tab-btn', tab === t ? 'tab-btn-active' : '']"
      >
        {{
          t === "notes"
            ? "Notizen"
            : t === "tasks"
              ? "Aufgaben"
              : t === "termine"
                ? "Termine"
                : t === "files"
                  ? "Dateien"
                  : t === "team"
                    ? "Team"
                    : "Verlauf"
        }}
      </button>
    </div>

    <!-- Notes -->
    <div v-if="tab === 'notes'">
      <div v-if="viewingNote">
        <div class="flex items-center justify-between" style="margin-bottom: 12px">
          <span class="font-mono" style="font-size: 12px; color: var(--color-text-muted)">
            {{ viewingNote }}
          </span>
          <button @click="viewingNote = null" class="bauos-btn ghost">Schließen</button>
        </div>
        <div class="note-viewer">
          <MarkdownRenderer :content="noteContent" />
        </div>
      </div>
      <div v-else style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
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
        <p v-if="notes.length === 0" class="empty-hint">Keine Notizen in diesem Projekt.</p>
      </div>
    </div>

    <!-- Tasks -->
    <div v-if="tab === 'tasks'">
      <div class="flex" style="gap: 8px; margin-bottom: 16px">
        <input v-model="newTask" placeholder="Neue Aufgabe…" @keyup.enter="addTask" class="form-input" />
        <button @click="addTask" class="bauos-btn solid">Hinzufügen</button>
      </div>
      <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
        <div
          v-for="t in tasks.filter((t) => t.status !== 'done')"
          :key="t.id"
          class="flex items-center"
          style="gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border-subtle)"
        >
          <input type="checkbox" @change="completeTask(t)" style="accent-color: var(--color-primary)" />
          <span style="flex: 1; font-size: 13px; color: var(--color-text-secondary)">{{ t.text }}</span>
          <span v-if="t.assignee" style="font-size: 11px; color: var(--color-text-tertiary)">{{ t.assignee }}</span>
          <span v-if="t.date" class="font-mono" style="font-size: 11px; color: var(--color-text-tertiary)">{{ t.date }}</span>
        </div>
        <p v-if="tasks.filter((t) => t.status !== 'done').length === 0" class="empty-hint">
          Keine offenen Aufgaben.
        </p>
      </div>
    </div>

    <!-- Termine -->
    <div v-if="tab === 'termine'">
      <div class="flex" style="gap: 8px; margin-bottom: 16px">
        <input v-model="newDatum" type="date" class="form-input" style="width: 150px" />
        <input v-model="newUhrzeit" type="time" class="form-input" style="width: 110px" />
        <input
          v-model="newTerminText"
          placeholder="Beschreibung…"
          @keyup.enter="addTermin"
          class="form-input"
        />
        <button @click="addTermin" class="bauos-btn solid">Erstellen</button>
      </div>
      <div style="border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden">
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
        <p v-if="termine.length === 0" class="empty-hint">Keine Termine.</p>
      </div>
    </div>

    <!-- Placeholder-Tabs (kommen in Stufen 3b/3c/3d) -->
    <div v-if="tab === 'files'" class="placeholder-tab">
      <BIcon name="archive" :size="20" />
      <p>Datei-Ansicht pro Projekt kommt in Kürze.</p>
    </div>
    <div v-if="tab === 'team'" class="placeholder-tab">
      <BIcon name="users" :size="20" />
      <p>Team-Zuordnung kommt in Kürze.</p>
    </div>
    <div v-if="tab === 'verlauf'" class="placeholder-tab">
      <BIcon name="clock" :size="20" />
      <p>Aktivitäts-Verlauf kommt in Kürze.</p>
    </div>
  </div>
</template>

<style scoped>
/* ── Back-Link ──────────────────────────────────────────── */
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

/* ── bauos-btn sm-Variant ───────────────────────────────── */
.bauos-btn.sm {
  padding: 4px 10px;
  font-size: 11px;
}
</style>
