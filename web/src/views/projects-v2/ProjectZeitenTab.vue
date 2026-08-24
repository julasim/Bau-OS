<script setup lang="ts">
// ============================================================
// PATIO — Projektakte, Reiter „Stunden" (Migration 014)
// ============================================================
// Erfasste Arbeitszeit eines Projekts: Liste links, Editor rechts, Summen je
// Mitarbeiter darüber. Herausgelöst aus `ProjectDetailView.vue` — die Akte
// trug alle dreizehn Reiter in einer Datei.
//
// Der Reiter lädt seine Daten selbst. Das ist eine Anfrage mehr beim Öffnen,
// aber die Alternative wäre gewesen, ein Dutzend Zustandsfelder als Eigenschaft
// durchzureichen — und die Akte hätte weiterhin Stunden geladen, die niemand
// ansieht.
// ============================================================

import { ref, computed, watch, onMounted } from "vue";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";
import { useConfirm } from "../../composables/useConfirm";
import { useWordExport } from "../../composables/useWordExport";
import { heuteIso } from "../../utils/format";

const props = defineProps<{ projectName: string }>();
const { confirm } = useConfirm();
const { pdfMoeglich, gewaehlteVorlage, ladeExportVorlagen, vorlagenFuer, mitVorlage, endung, download } = useWordExport(
  (fehler) => confirm({ message: fehler, confirmLabel: "OK", cancelLabel: "" }).then(() => undefined),
);

/** Eine Seite hält 200 Einträge. Ältere kommen über „Ältere laden" nach —
 *  ohne das war ab dem 201. Eintrag nichts mehr erreichbar. */
const STUNDEN_SEITE = 200;

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
  hours: string; // String fuers Eingabefeld — beim Speichern zu Number
  startTime: string;
  endTime: string;
  breakMinutes: string;
  activity: string;
  notes: string;
}
interface TeamMitglied {
  id: string;
  name: string;
}

const timeEntries = ref<TimeEntry[]>([]);
const timeSummary = ref<TimeSummaryRow[]>([]);
const timeLoaded = ref(false);
const timeDraft = ref<TimeDraft | null>(null);
const timeSaving = ref(false);
const timeError = ref<string | null>(null);
const stundenMehr = ref(false);
const laedtMehr = ref(false);
const allTeam = ref<TeamMitglied[]>([]);

const n = () => encodeURIComponent(props.projectName);

// ── Zeit-Eingabe ────────────────────────────────────────────────────────

/** Parser fuer flexible Zeit-Eingabe. Akzeptiert:
 *   "8"    → "08:00"
 *   "8:30" → "08:30"
 *   "830"  → "08:30"
 *   "0830" → "08:30"
 *   leer / nicht parsbar → null
 *  Damit kann getippt statt geklickt werden. */
function parseTimeInput(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
    return null;
  }
  m = t.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    return h >= 0 && h <= 23 ? `${String(h).padStart(2, "0")}:00` : null;
  }
  m = t.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    return h <= 23 && min <= 59 ? `${m[1]}:${m[2]}` : null;
  }
  m = t.match(/^(\d)(\d{2})$/);
  if (m) {
    const min = parseInt(m[2], 10);
    return min <= 59 ? `0${m[1]}:${m[2]}` : null;
  }
  return null;
}

/** Differenz in Minuten zwischen zwei HH:MM-Angaben. Ende vor Beginn gilt als
 *  Schicht über Mitternacht (22:00–02:00 = 4 h). */
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

/** Bei vorhandenem Beginn und Ende: Stunden minus Pause. `null`, wenn nicht
 *  beide lesbar sind — dann bleibt das Stundenfeld zur Handeingabe frei. */
const computedTimeHours = computed(() => {
  if (!timeDraft.value) return null;
  const diff = timeDiffMinutes(timeDraft.value.startTime, timeDraft.value.endTime);
  if (diff === null) return null;
  const breakMin = Number(timeDraft.value.breakMinutes) || 0;
  return Math.max(0, diff - breakMin) / 60;
});

// Schreibt die gerechneten Stunden in den Entwurf, sobald Beginn und Ende
// lesbar sind. Handeingabe bleibt möglich — die nächste Zeitänderung
// überschreibt sie wieder. Klare Regel: wer Zeiten eingibt, bekommt die
// Rechnung dazu.
watch(computedTimeHours, (val) => {
  if (val !== null && timeDraft.value) timeDraft.value.hours = val.toFixed(2);
});

function normalizeStartTime() {
  if (!timeDraft.value) return;
  const v = parseTimeInput(timeDraft.value.startTime);
  if (v) timeDraft.value.startTime = v;
}
function normalizeEndTime() {
  if (!timeDraft.value) return;
  const v = parseTimeInput(timeDraft.value.endTime);
  if (v) timeDraft.value.endTime = v;
}

// ── Entwürfe ────────────────────────────────────────────────────────────

function emptyTimeDraft(): TimeDraft {
  return {
    id: null,
    date: heuteIso(),
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

// ── Laden ───────────────────────────────────────────────────────────────

async function ladeSummen() {
  const sum = await api.get<{ data: TimeSummaryRow[] }>(`/projects/${n()}/time-entries/summary?groupBy=member`);
  timeSummary.value = sum.data;
}

async function loadTimeEntries() {
  try {
    timeEntries.value = await api.get<TimeEntry[]>(`/projects/${n()}/time-entries?limit=${STUNDEN_SEITE}`);
    stundenMehr.value = timeEntries.value.length === STUNDEN_SEITE;
    await ladeSummen();
    timeLoaded.value = true;
  } catch (e) {
    timeError.value = e instanceof Error ? e.message : "Stunden nicht ladbar";
    timeLoaded.value = true;
  }
}

async function ladeAeltereStunden() {
  const aeltester = timeEntries.value.at(-1)?.date;
  if (!aeltester) return;
  laedtMehr.value = true;
  try {
    const weitere = await api.get<TimeEntry[]>(`/projects/${n()}/time-entries?limit=${STUNDEN_SEITE}&to=${aeltester}`);
    // `to` ist einschliessend — was schon dasteht, muss raus.
    const bekannt = new Set(timeEntries.value.map((e) => e.id));
    const neu = weitere.filter((e) => !bekannt.has(e.id));
    timeEntries.value = [...timeEntries.value, ...neu];
    stundenMehr.value = weitere.length === STUNDEN_SEITE && neu.length > 0;
  } finally {
    laedtMehr.value = false;
  }
}

const timeTotalHours = computed(() => timeEntries.value.reduce((s, e) => s + e.hours, 0));

// ── Bedienung ───────────────────────────────────────────────────────────

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

/** Beim Wählen eines Team-Mitglieds den Namen mitnehmen — sonst stünde im
 *  Stundenzettel eine ID. */
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

  // Zeiten normalisieren, falls direkt gespeichert wurde, ohne dass das Feld
  // den Fokus verloren hat (Tab + Enter). Nicht Lesbares weist der Server ab.
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
      saved = await api.post<TimeEntry>(`/projects/${n()}/time-entries`, body);
      timeEntries.value.unshift(saved);
      timeEntries.value.sort((a, b) => b.date.localeCompare(a.date));
    }
    await ladeSummen(); // ein neuer Eintrag ändert das Aggregat
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
    await ladeSummen();
  } catch (e) {
    timeError.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

async function exportTimeEntriesDocx(alsPdf = false) {
  await download(
    mitVorlage(`/api/exports/time-entries?project=${n()}`, "time-entry", alsPdf),
    `Stundenzettel-${props.projectName}.${endung(alsPdf)}`,
  );
}

// ── Start ───────────────────────────────────────────────────────────────

async function ladeTeam() {
  try {
    allTeam.value = await api.get<TeamMitglied[]>("/team");
  } catch {
    allTeam.value = [];
  }
}

onMounted(() => {
  void loadTimeEntries();
  void ladeTeam();
  void ladeExportVorlagen();
});

// Projektwechsel ohne Neuaufbau der Komponente (Adresszeile) — sonst zeigte
// der Reiter die Stunden des vorigen Projekts.
watch(
  () => props.projectName,
  () => {
    timeLoaded.value = false;
    timeDraft.value = null;
    void loadTimeEntries();
  },
);
</script>

<template>
  <div class="time-tab">
    <div v-if="!timeLoaded" class="empty-hint">Lade Stunden…</div>
    <div v-else>
      <!-- Kopfzeile mit Summe -->
      <div class="flex items-center" style="gap: 8px; margin-bottom: 14px; flex-wrap: wrap">
        <button class="patio-btn solid sm" @click="newTimeEntry">
          <BIcon name="plus" :size="11" />
          <span style="margin-left: 4px">Stunden eintragen</span>
        </button>
        <select
          v-if="timeEntries.length > 0 && vorlagenFuer('time-entry').length > 1"
          v-model="gewaehlteVorlage['time-entry']"
          class="vorlagen-waehler"
          title="Word-Vorlage wählen"
        >
          <option value="">Standardvorlage</option>
          <option v-for="v in vorlagenFuer('time-entry')" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
        <button
          v-if="timeEntries.length > 0"
          class="patio-btn ghost sm"
          title="Stundenzettel als Word herunterladen"
          @click="exportTimeEntriesDocx(false)"
        >
          <BIcon name="download" :size="11" />
          <span style="margin-left: 4px">Stundenzettel</span>
        </button>
        <button
          v-if="timeEntries.length > 0 && pdfMoeglich"
          class="patio-btn ghost sm"
          title="Stundenzettel als PDF"
          @click="exportTimeEntriesDocx(true)"
        >
          <BIcon name="download" :size="11" />
          <span style="margin-left: 4px">PDF</span>
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
          <button v-if="stundenMehr" class="mehr-laden" :disabled="laedtMehr" @click="ladeAeltereStunden">
            {{ laedtMehr ? "lädt …" : "Ältere laden" }}
          </button>
        </div>

        <!-- Rechte Spalte: Editor -->
        <div v-if="timeDraft" class="time-editor">
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
                <span v-if="computedTimeHours !== null" class="time-auto-hinweis">(auto: Beginn–Ende)</span>
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

          <!-- Mitarbeiter: Auswahl aus dem Team oder Freitext für Externe -->
          <div class="time-field">
            <label class="time-label">Mitarbeiter <span style="color: var(--color-danger-text)">*</span></label>
            <div class="flex items-center" style="gap: 8px; flex-wrap: wrap">
              <select
                :value="timeDraft.memberId ?? ''"
                class="stamm-input"
                style="flex: 1; min-width: 180px"
                @change="onTimeMemberChange(($event.target as HTMLSelectElement).value)"
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
              <!-- `type="text"`, damit flexibel getippt werden kann („8", „8:30",
                   „0830"). Beim Verlassen des Felds wird auf „HH:MM"
                   normalisiert; `inputmode` bringt am Handy die Zifferntastatur. -->
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
            <input v-model="timeDraft.activity" class="stamm-input" placeholder="z.B. Einreichplanung, Bauaufsicht" />
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
            <span v-if="timeError" style="font-size: 11px; color: var(--color-danger-text)">{{ timeError }}</span>
          </div>
        </div>

        <div v-else class="time-editor empty-hint time-editor-leer">
          Eintrag links auswählen oder „Stunden eintragen" klicken.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

/* Hinweis „(auto: Beginn–Ende)" neben dem Stunden-Feld — stand vorher als
   sieben Zeilen inline im Template. */
.time-auto-hinweis {
  font-size: 9px;
  font-weight: 400;
  color: var(--color-text-faint);
  margin-left: 6px;
  text-transform: none;
  letter-spacing: 0;
}
.time-editor-leer {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
