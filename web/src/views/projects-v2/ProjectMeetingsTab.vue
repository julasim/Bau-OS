<script setup lang="ts">
// ============================================================
// PATIO — Projektakte, Reiter „Besprechungen" (Migration 012)
// ============================================================
// Protokolle mit Tagesordnung, Teilnehmern, Beschlüssen und Aufgabenpunkten.
// Herausgelöst aus `ProjectDetailView.vue`.
//
// Der Reiter lädt seine Daten selbst: Protokolle, Team (für die
// Teilnehmerauswahl), Word-Vorlagen und die Protokoll-Vorlagen.
//
// ── Der Aufgabenpunkt ist der interessante Teil ────────────────────────────
//
// Ein Punkt aus einem Protokoll lässt sich in eine echte Aufgabe überführen.
// Das geht erst, wenn das Protokoll gespeichert ist — vorher gibt es keine ID,
// an der die Aufgabe hängen könnte. Der Reiter sagt das, statt still nichts zu
// tun.
// ============================================================

import { ref, onMounted, watch } from "vue";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";
import TeamPicker from "../../components/TeamPicker.vue";
import MarkdownRenderer from "../../components/MarkdownRenderer.vue";
import { useConfirm } from "../../composables/useConfirm";
import { useWordExport } from "../../composables/useWordExport";
import { formatDate, heuteIso } from "../../utils/format";

const props = defineProps<{ projectName: string }>();
// Wird ein Aufgabenpunkt in eine echte Aufgabe überführt, muss die Akte ihre
// Aufgabenliste neu holen — sonst sieht man die neue Aufgabe erst nach einem
// Neuladen der Seite. Solange beides in einer Datei lag, hat der Aufruf die
// Liste direkt beschrieben; über die Komponentengrenze geht das nicht mehr.
const emit = defineEmits<{ aufgabeAngelegt: [] }>();
const { confirm } = useConfirm();
const { pdfMoeglich, gewaehlteVorlage, ladeExportVorlagen, vorlagenFuer, mitVorlage, endung, download } = useWordExport(
  (fehler) => confirm({ message: fehler, confirmLabel: "OK", cancelLabel: "" }).then(() => undefined),
);

const n = () => encodeURIComponent(props.projectName);

interface TeamMitglied {
  id: string;
  name: string;
}
const allTeam = ref<TeamMitglied[]>([]);

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

// ── Warum es „Ältere laden" braucht ──────────────────────────────────────
//
// Die Liste holte eine feste Zahl neuester Protokolle (100) und bot keinen Weg
// zu den älteren. Der ältere Bestand war im Programm nicht mehr erreichbar —
// die Daten waren da, der Weg dorthin nicht.
//
// Geblättert wird über einen Datums-Cursor (`?vor=`), nicht über einen
// Offset: während jemand blättert, können neue Protokolle dazukommen, und ein
// Offset überspringt dann Zeilen oder zeigt sie doppelt.
const MEETINGS_SEITE = 100;

const meetingsMehr = ref(false);
const laedtMehr = ref(false);

async function ladeAeltereMeetings() {
  const aeltestes = meetings.value.at(-1)?.date;
  if (!aeltestes) return;
  laedtMehr.value = true;
  try {
    const weitere = await api.get<Meeting[]>(`/projects/${n()}/meetings?limit=${MEETINGS_SEITE}&vor=${aeltestes}`);
    // Der Cursor lässt den angefangenen Tag aus (`<`), deshalb erst den
    // bereits geladenen Tag vollständig behalten und dann anhängen.
    meetings.value = [...meetings.value, ...weitere];
    meetingsMehr.value = weitere.length === MEETINGS_SEITE;
  } finally {
    laedtMehr.value = false;
  }
}

// ── Meetings (Migration 012) ─────────────────────────────────────────────
function emptyMeetingDraft(): MeetingDraft {
  return {
    id: null,
    date: heuteIso(),
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
    meetings.value = await api.get<Meeting[]>(`/projects/${n()}/meetings?limit=${MEETINGS_SEITE}`);
    meetingsMehr.value = meetings.value.length === MEETINGS_SEITE;
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

async function exportMeetingDocx(id: string, alsPdf = false) {
  await download(mitVorlage(`/api/exports/meeting/${id}`, "meeting", alsPdf), `Meeting-${id}.${endung(alsPdf)}`);
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
    const url = `/templates/${selectedMeetingTemplateId.value}/render?project=${n()}`;
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
      project: props.projectName,
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
    // 3) Die Akte bitten, ihre Aufgabenliste neu zu holen — sonst sieht man
    //    die neue Aufgabe erst nach einem Neuladen der Seite.
    emit("aufgabeAngelegt");
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
      saved = await api.post<Meeting>(`/projects/${n()}/meetings`, body);
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

async function ladeTeam() {
  try {
    allTeam.value = await api.get<TeamMitglied[]>("/team");
  } catch {
    allTeam.value = [];
  }
}

onMounted(() => {
  void loadMeetings();
  void ladeTeam();
  void loadMeetingTemplates();
  void ladeExportVorlagen();
});

// Projektwechsel ohne Neuaufbau der Komponente (Adresszeile) — sonst zeigte
// der Reiter die Protokolle des vorigen Projekts.
watch(
  () => props.projectName,
  () => {
    meetingsLoaded.value = false;
    meetingDraft.value = null;
    void loadMeetings();
  },
);
</script>

<template>
  <div class="mt-tab">
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
          <button v-if="meetingsMehr" class="mehr-laden" :disabled="laedtMehr" @click="ladeAeltereMeetings">
            {{ laedtMehr ? "lädt …" : "Ältere laden" }}
          </button>
        </div>

        <!-- Rechte Spalte: Editor -->
        <div class="mt-editor" v-if="meetingDraft">
          <div class="flex items-center" style="gap: 8px; margin-bottom: 14px">
            <h3 style="margin: 0; font-size: 16px; font-weight: 600">
              {{ meetingDraft.id ? "Meeting bearbeiten" : "Neues Meeting" }}
            </h3>
            <select
              v-if="vorlagenFuer('meeting').length > 1"
              v-model="gewaehlteVorlage['meeting']"
              class="vorlagen-waehler"
              title="Word-Vorlage wählen"
            >
              <option value="">Standardvorlage</option>
              <option v-for="v in vorlagenFuer('meeting')" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
            <button
              v-if="meetingDraft.id"
              class="patio-btn ghost sm"
              @click="exportMeetingDocx(meetingDraft.id, false)"
              title="Als Word-Datei herunterladen"
            >
              <BIcon name="download" :size="11" />
              <span style="margin-left: 4px">Word</span>
            </button>
            <button
              v-if="pdfMoeglich && meetingDraft.id"
              class="patio-btn ghost sm"
              title="Dieselbe Vorlage, als PDF"
              @click="exportMeetingDocx(meetingDraft.id!, true)"
            >
              <BIcon name="download" :size="11" />
              <span style="margin-left: 4px">PDF</span>
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
                <input v-model="item.text" class="stamm-input" style="flex: 1" :class="{ 'mt-todo-done': item.done }" />
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
</template>

<style scoped>
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
</style>
