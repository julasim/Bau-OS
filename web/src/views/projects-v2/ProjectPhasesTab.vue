<script setup lang="ts">
// ── Phasen-Tab (Leistungsphasen) ─────────────────────────────────────────
// Verwaltet die Leistungsphasen eines Projekts: anlegen, bearbeiten, sortieren,
// loeschen. Fortschritt pro Phase wird serverseitig aus den verknuepften
// Aufgaben abgeleitet (progress = progressManual ?? taskDone/taskTotal).
// Der honorargewichtete Gesamtfortschritt kommt direkt aus der API.
import { ref, computed, onMounted } from "vue";
import { api, ApiError } from "../../api";
import BIcon from "../../components/BIcon.vue";
import PhaseGantt from "./PhaseGantt.vue";
import { formatDate } from "../../utils/format";

const props = defineProps<{ projectName: string }>();

type PhaseStatus = "offen" | "aktiv" | "fertig";

interface ProjectPhase {
  id: string;
  projectId: string;
  projectName?: string | null;
  name: string;
  sortOrder: number;
  status: PhaseStatus;
  progressManual: number | null;
  feeShare: number;
  sollStart: string | null;
  sollEnde: string | null;
  istStart: string | null;
  istEnde: string | null;
  dependsOnPhaseId: string | null;
  progress: number;
  taskTotal: number;
  taskDone: number;
  createdAt: string;
  updatedAt: string;
  /** Konfliktzähler (Migration 042) — die Route liefert ihn mit, hier wurde
   *  er nur weggeworfen. */
  rev?: number;
}

// Entwurf fuer den Editor — Zahlenfelder als String, damit leere Eingabe = null.
interface PhaseDraft {
  id: string | null;
  name: string;
  status: PhaseStatus;
  feeShare: string;
  progressManual: string;
  sollStart: string;
  sollEnde: string;
  istStart: string;
  istEnde: string;
  dependsOnPhaseId: string | null;
  /** Konfliktzähler der geöffneten Phase — beim Anlegen `undefined`. */
  rev?: number;
}

const STATUS_LABEL: Record<PhaseStatus, string> = {
  offen: "Offen",
  aktiv: "Aktiv",
  fertig: "Fertig",
};

// Verknuepfbare Objekte (zur Zuordnung an eine Phase).
interface PhaseTask {
  id: string;
  text: string;
  status: string;
  phaseId: string | null;
}
interface PhaseTermin {
  id: string;
  text: string;
  datum: string;
  phaseId: string | null;
  isMilestone?: boolean;
}

const phases = ref<ProjectPhase[]>([]);
const projectProgress = ref(0);
const tasks = ref<PhaseTask[]>([]);
const termine = ref<PhaseTermin[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const draft = ref<PhaseDraft | null>(null);
const view = ref<"liste" | "gantt">("liste");

const encName = computed(() => encodeURIComponent(props.projectName));

// Moegliche Vorgaenger im Editor (alle Phasen ausser der bearbeiteten).
const predecessorOptions = computed(() => (draft.value ? phases.value.filter((p) => p.id !== draft.value!.id) : []));

const feeSum = computed(() => phases.value.reduce((s, p) => s + Number(p.feeShare || 0), 0));
const feeSumOff = computed(() => Math.abs(feeSum.value - 100) > 0.01 && phases.value.length > 0);

// Aufgaben/Termine bezogen auf die gerade bearbeitete Phase.
const editId = computed(() => draft.value?.id ?? null);
const tasksInPhase = computed(() => (editId.value ? tasks.value.filter((t) => t.phaseId === editId.value) : []));
const termineInPhase = computed(() => (editId.value ? termine.value.filter((t) => t.phaseId === editId.value) : []));
const assignableTasks = computed(() =>
  editId.value ? tasks.value.filter((t) => t.phaseId !== editId.value && t.status !== "done") : [],
);
const assignableTermine = computed(() => (editId.value ? termine.value.filter((t) => t.phaseId !== editId.value) : []));

function asArray<T>(v: T[] | { [k: string]: unknown } | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

async function load() {
  try {
    const [phaseRes, taskRes, terminRes] = await Promise.all([
      api.get<{ phases: ProjectPhase[]; progress: number }>(`/projects/${encName.value}/phases`),
      api.get<PhaseTask[]>(`/tasks?project=${encName.value}`).catch(() => [] as PhaseTask[]),
      api.get<PhaseTermin[]>(`/termine?project=${encName.value}`).catch(() => [] as PhaseTermin[]),
    ]);
    phases.value = phaseRes.phases ?? [];
    projectProgress.value = phaseRes.progress ?? 0;
    tasks.value = asArray(taskRes);
    termine.value = asArray(terminRes);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Phasen konnten nicht geladen werden.";
  } finally {
    loaded.value = true;
  }
}

/**
 * Aufgabe einer Phase zuordnen.
 *
 * Bewusst OHNE Konfliktzähler: Diese Ansicht lädt die Aufgabe nie ganz, sie
 * kennt nur ihre ID aus einer Auswahlliste. Einen Zähler mitzuschicken, den
 * man nicht gelesen hat, wäre eine Attrappe — und ein aus der Liste
 * geratener Wert erzeugte 409er, die niemand versteht. Hier gilt „zuletzt
 * gewinnt", und das ist für eine Zuordnung die richtige Antwort.
 */
async function assignTask(taskId: string, phaseId: string | null) {
  busy.value = true;
  try {
    await api.put(`/tasks/${taskId}`, { phaseId });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Zuordnung fehlgeschlagen.";
  } finally {
    busy.value = false;
  }
}

async function assignTermin(terminId: string, phaseId: string | null) {
  busy.value = true;
  try {
    await api.put(`/termine/${terminId}`, { phaseId });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Zuordnung fehlgeschlagen.";
  } finally {
    busy.value = false;
  }
}

function onAssignTaskPick(e: Event) {
  const el = e.target as HTMLSelectElement;
  const id = el.value;
  el.value = "";
  if (id && editId.value) void assignTask(id, editId.value);
}

function onAssignTerminPick(e: Event) {
  const el = e.target as HTMLSelectElement;
  const id = el.value;
  el.value = "";
  if (id && editId.value) void assignTermin(id, editId.value);
}

function emptyDraft(): PhaseDraft {
  return {
    id: null,
    name: "",
    status: "offen",
    feeShare: "",
    progressManual: "",
    sollStart: "",
    sollEnde: "",
    istStart: "",
    istEnde: "",
    dependsOnPhaseId: null,
    rev: undefined,
  };
}

function newPhase() {
  draft.value = emptyDraft();
}

function selectPhase(p: ProjectPhase) {
  draft.value = {
    id: p.id,
    name: p.name,
    status: p.status,
    feeShare: p.feeShare != null ? String(p.feeShare) : "",
    progressManual: p.progressManual != null ? String(p.progressManual) : "",
    sollStart: p.sollStart ?? "",
    sollEnde: p.sollEnde ?? "",
    istStart: p.istStart ?? "",
    istEnde: p.istEnde ?? "",
    dependsOnPhaseId: p.dependsOnPhaseId ?? null,
    // Konfliktzähler beim Öffnen merken (Muster wie in
    // ProjectEntscheidungenTab): beim Speichern geht er nur im
    // Bearbeiten-Fall mit, beim Anlegen gibt es noch keinen.
    rev: p.rev,
  };
}

function cancelEdit() {
  draft.value = null;
}

function toNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function save() {
  if (!draft.value) return;
  const d = draft.value;
  if (!d.name.trim()) {
    error.value = "Bitte einen Phasennamen angeben.";
    return;
  }
  error.value = null;
  busy.value = true;
  const body = {
    name: d.name.trim(),
    status: d.status,
    feeShare: toNum(d.feeShare),
    progressManual: d.progressManual.trim() === "" ? null : toNum(d.progressManual),
    sollStart: d.sollStart || null,
    sollEnde: d.sollEnde || null,
    istStart: d.istStart || null,
    istEnde: d.istEnde || null,
    dependsOnPhaseId: d.dependsOnPhaseId,
  };
  try {
    if (d.id) {
      await api.put(`/phases/${d.id}`, { ...body, rev: d.rev });
    } else {
      await api.post(`/projects/${encName.value}/phases`, body);
    }
    draft.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen.";
    // ── Nach einem Konflikt neu laden ──────────────────────────────────────
    //
    // ⚠ Ohne diese Zeile war die Ansicht festgefahren: Der Entwurf behielt
    // den veralteten Zähler, und weil weder hier noch über SSE neu geladen
    // wurde, ergab JEDER weitere Versuch denselben 409 — auch nach Abbrechen
    // und erneutem Öffnen, weil die Liste dahinter ebenfalls alt war.
    // Ausweg war nur ein Reiterwechsel, unter Verlust der Eingabe.
    //
    // Der Entwurf liegt in einem eigenen `ref`; `load()` füllt nur die Liste
    // und wirft die Eingabe deshalb nicht weg.
    if (e instanceof ApiError && e.istKonflikt) await load();
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!draft.value?.id) return;
  if (!confirm("Diese Phase wirklich löschen? Verknüpfte Aufgaben/Termine bleiben erhalten (Zuordnung wird entfernt)."))
    return;
  busy.value = true;
  try {
    await api.delete(`/phases/${draft.value.id}`);
    draft.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen.";
  } finally {
    busy.value = false;
  }
}

async function move(index: number, dir: -1 | 1) {
  const target = index + dir;
  if (target < 0 || target >= phases.value.length) return;
  const ordered = phases.value.map((p) => p.id);
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  busy.value = true;
  try {
    await api.post(`/projects/${encName.value}/phases/reorder`, { orderedIds: ordered });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Sortieren fehlgeschlagen.";
  } finally {
    busy.value = false;
  }
}

function fmtRange(start: string | null, ende: string | null): string {
  if (!start && !ende) return "—";
  return `${start ?? "?"} → ${ende ?? "?"}`;
}

onMounted(() => void load());
</script>

<template>
  <div class="phases-tab">
    <div v-if="!loaded" class="empty-hint">Lade Phasen…</div>

    <template v-else>
      <!-- Action-Bar + Gesamtfortschritt -->
      <div class="ph-bar">
        <button class="patio-btn solid sm" @click="newPhase">
          <BIcon name="plus" :size="11" />
          <span style="margin-left: 4px">Phase hinzufügen</span>
        </button>
        <div class="ph-viewtoggle">
          <button :class="['ph-vt', view === 'liste' ? 'active' : '']" @click="view = 'liste'">Liste</button>
          <button :class="['ph-vt', view === 'gantt' ? 'active' : '']" @click="view = 'gantt'">Zeitleiste</button>
        </div>
        <div class="ph-bar-meta">
          <div class="ph-overall">
            <span class="ph-overall-label">Gesamtfortschritt</span>
            <div class="ph-progress ph-progress-lg">
              <div class="ph-progress-fill" :style="{ width: projectProgress + '%' }"></div>
            </div>
            <span class="ph-overall-pct">{{ projectProgress }}%</span>
          </div>
          <span
            class="ph-feesum"
            :class="{ warn: feeSumOff }"
            :title="feeSumOff ? 'Summe der Honoraranteile weicht von 100 % ab' : 'Summe der Honoraranteile'"
          >
            Honorar Σ {{ feeSum.toFixed(0) }}%
          </span>
        </div>
      </div>

      <div v-if="error" class="ph-error">{{ error }}</div>

      <!-- Leerzustand -->
      <PhaseGantt v-if="view === 'gantt'" :phases="phases" />

      <template v-else>
        <div v-if="phases.length === 0 && !draft" class="empty-state" style="margin-top: 16px">
          <div class="empty-state-icon"><BIcon name="timeline" :size="26" /></div>
          <div class="empty-state-text">Noch keine Leistungsphasen für dieses Projekt.</div>
          <button class="patio-btn solid sm" @click="newPhase">
            <BIcon name="plus" :size="11" :stroke-width="2" />
            Erste Phase anlegen
          </button>
        </div>

        <div v-else class="ph-grid">
          <!-- Liste -->
          <div class="ph-list">
            <div
              v-for="(p, i) in phases"
              :key="p.id"
              :class="['ph-row', draft?.id === p.id ? 'ph-row-active' : '']"
              @click="selectPhase(p)"
            >
              <div class="ph-sort" @click.stop>
                <button class="ph-sort-btn" :disabled="i === 0 || busy" title="Nach oben" @click="move(i, -1)">
                  <span class="ph-flip"><BIcon name="chevronDown" :size="13" /></span>
                </button>
                <button
                  class="ph-sort-btn"
                  :disabled="i === phases.length - 1 || busy"
                  title="Nach unten"
                  @click="move(i, 1)"
                >
                  <BIcon name="chevronDown" :size="13" />
                </button>
              </div>
              <div class="ph-main">
                <div class="ph-row-head">
                  <span class="ph-name">{{ p.name }}</span>
                  <span class="ph-status" :class="'st-' + p.status">{{ STATUS_LABEL[p.status] }}</span>
                </div>
                <div class="ph-progress">
                  <div class="ph-progress-fill" :style="{ width: p.progress + '%' }"></div>
                </div>
                <div class="ph-row-foot">
                  <span class="ph-pct">{{ p.progress }}%</span>
                  <span class="ph-foot-sep">·</span>
                  <span :title="'erledigte / gesamte verknüpfte Aufgaben'"
                    >{{ p.taskDone }}/{{ p.taskTotal }} Aufgaben</span
                  >
                  <span class="ph-foot-sep">·</span>
                  <span>Honorar {{ Number(p.feeShare).toFixed(0) }}%</span>
                  <span class="ph-foot-sep">·</span>
                  <span class="ph-dates">{{ fmtRange(p.sollStart, p.sollEnde) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Editor -->
          <div class="ph-editor" v-if="draft">
            <div class="ph-editor-head">
              <h3>{{ draft.id ? "Phase bearbeiten" : "Neue Phase" }}</h3>
              <button v-if="draft.id" class="patio-btn ghost sm" :disabled="busy" @click="remove">
                <BIcon name="trash" :size="11" /><span style="margin-left: 4px">Löschen</span>
              </button>
              <button v-else class="patio-btn ghost sm" :disabled="busy" @click="cancelEdit">Abbrechen</button>
            </div>

            <div class="ph-field">
              <label class="ph-label">Name <span class="req">*</span></label>
              <input
                v-model="draft.name"
                type="text"
                class="stamm-input"
                placeholder="z. B. Entwurfsplanung"
                @keyup.enter="save"
              />
            </div>

            <div class="ph-field-row">
              <div class="ph-field">
                <label class="ph-label">Status</label>
                <select v-model="draft.status" class="stamm-input">
                  <option value="offen">Offen</option>
                  <option value="aktiv">Aktiv</option>
                  <option value="fertig">Fertig</option>
                </select>
              </div>
              <div class="ph-field">
                <label class="ph-label">Honoraranteil %</label>
                <input
                  v-model="draft.feeShare"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  class="stamm-input"
                  placeholder="0"
                />
              </div>
            </div>

            <div class="ph-field">
              <label class="ph-label">
                Fortschritt manuell %
                <span class="hint">leer = automatisch aus Aufgaben</span>
              </label>
              <input
                v-model="draft.progressManual"
                type="number"
                min="0"
                max="100"
                step="1"
                class="stamm-input"
                placeholder="auto"
              />
            </div>

            <div class="ph-field-row">
              <div class="ph-field">
                <label class="ph-label">Soll-Start</label>
                <input v-model="draft.sollStart" type="date" class="stamm-input" />
              </div>
              <div class="ph-field">
                <label class="ph-label">Soll-Ende</label>
                <input v-model="draft.sollEnde" type="date" class="stamm-input" />
              </div>
            </div>
            <div class="ph-field-row">
              <div class="ph-field">
                <label class="ph-label">Ist-Start</label>
                <input v-model="draft.istStart" type="date" class="stamm-input" />
              </div>
              <div class="ph-field">
                <label class="ph-label">Ist-Ende</label>
                <input v-model="draft.istEnde" type="date" class="stamm-input" />
              </div>
            </div>

            <div class="ph-field" v-if="predecessorOptions.length">
              <label class="ph-label">Vorgänger (Abhängigkeit)</label>
              <select v-model="draft.dependsOnPhaseId" class="stamm-input">
                <option :value="null">— (keiner)</option>
                <option v-for="p in predecessorOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>

            <div class="ph-editor-actions">
              <button class="patio-btn solid sm" :disabled="busy" @click="save">
                <BIcon name="check" :size="11" /><span style="margin-left: 4px">{{
                  draft.id ? "Speichern" : "Anlegen"
                }}</span>
              </button>
            </div>

            <!-- Zuordnung: Aufgaben & Termine (nur bei bestehender Phase) -->
            <template v-if="draft.id">
              <div class="ph-assign">
                <div class="ph-assign-head">Aufgaben in dieser Phase</div>
                <div v-if="tasksInPhase.length === 0" class="ph-assign-empty">Keine zugeordnet</div>
                <div v-for="t in tasksInPhase" :key="t.id" class="ph-assign-row">
                  <span class="ph-assign-text">{{ t.text }}</span>
                  <button
                    class="ph-assign-x"
                    :disabled="busy"
                    title="Aus Phase entfernen"
                    @click="assignTask(t.id, null)"
                  >
                    <BIcon name="x" :size="12" />
                  </button>
                </div>
                <select
                  v-if="assignableTasks.length"
                  class="stamm-input ph-assign-pick"
                  :disabled="busy"
                  @change="onAssignTaskPick"
                >
                  <option value="">+ Aufgabe zuordnen…</option>
                  <option v-for="t in assignableTasks" :key="t.id" :value="t.id">{{ t.text }}</option>
                </select>
              </div>

              <div class="ph-assign">
                <div class="ph-assign-head">Termine in dieser Phase</div>
                <div v-if="termineInPhase.length === 0" class="ph-assign-empty">Keine zugeordnet</div>
                <div v-for="t in termineInPhase" :key="t.id" class="ph-assign-row">
                  <span class="ph-assign-text">
                    <span class="ph-assign-date">{{ formatDate(t.datum) }}</span> {{ t.text }}
                    <BIcon v-if="t.isMilestone" name="zap" :size="11" title="Meilenstein" />
                  </span>
                  <button
                    class="ph-assign-x"
                    :disabled="busy"
                    title="Aus Phase entfernen"
                    @click="assignTermin(t.id, null)"
                  >
                    <BIcon name="x" :size="12" />
                  </button>
                </div>
                <select
                  v-if="assignableTermine.length"
                  class="stamm-input ph-assign-pick"
                  :disabled="busy"
                  @change="onAssignTerminPick"
                >
                  <option value="">+ Termin zuordnen…</option>
                  <option v-for="t in assignableTermine" :key="t.id" :value="t.id">
                    {{ formatDate(t.datum) }} · {{ t.text }}
                  </option>
                </select>
              </div>
            </template>
          </div>
          <div v-else class="ph-editor-empty">
            <BIcon name="timeline" :size="22" />
            <span>Phase auswählen oder neu anlegen</span>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
/* Wurzel des Phasenreiters. */
.phases-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ph-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.ph-viewtoggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  overflow: hidden;
}
.ph-vt {
  border: none;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12.5px;
  padding: 5px 12px;
  cursor: pointer;
}
.ph-vt.active {
  background: var(--color-bg-muted);
  color: var(--color-text);
  font-weight: 600;
}
.ph-bar-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-left: auto;
  flex-wrap: wrap;
}
.ph-overall {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ph-overall-label {
  font-size: 12px;
  color: var(--color-text-faint);
}
.ph-overall-pct {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  min-width: 34px;
}
.ph-feesum {
  font-size: 12px;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 4px 8px;
}
.ph-feesum.warn {
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border-color: var(--color-warning-border);
}
.ph-error {
  font-size: 13px;
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
}
.ph-grid {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 18px;
  align-items: start;
}
@media (max-width: 860px) {
  .ph-grid {
    grid-template-columns: 1fr;
  }
}
.ph-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ph-row {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
}
.ph-row:hover {
  border-color: var(--color-text-faint);
}
.ph-row-active {
  border-color: var(--color-accent);
  background: var(--color-bg-subtle);
}
.ph-sort {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
}
.ph-sort-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  border-radius: 5px;
  width: 22px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-muted);
}
.ph-sort-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.ph-sort-btn:not(:disabled):hover {
  background: var(--color-bg-muted);
  color: var(--color-text);
}
.ph-flip {
  display: inline-flex;
  transform: rotate(180deg);
}
.ph-main {
  flex: 1;
  min-width: 0;
}
.ph-row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}
.ph-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ph-status {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 7px;
  border-radius: 5px;
  flex: 0 0 auto;
}
.st-offen {
  color: var(--color-text-muted);
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
}
.st-aktiv {
  color: var(--color-primary, #1d4ed8);
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
}
.st-fertig {
  color: var(--color-success-text);
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
}
.ph-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--color-bg-muted);
  overflow: hidden;
}
.ph-progress-lg {
  width: 120px;
  height: 7px;
}
.ph-progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 999px;
  transition: width 0.2s;
}
.ph-row-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 7px;
  font-size: 11.5px;
  color: var(--color-text-muted);
}
.ph-pct {
  font-weight: 600;
  color: var(--color-text);
}
.ph-foot-sep {
  color: var(--color-text-faint);
}
.ph-dates {
  font-variant-numeric: tabular-nums;
}
.ph-editor {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--color-bg);
  position: sticky;
  top: 8px;
}
.ph-editor-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.ph-editor-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  flex: 1;
}
.ph-field {
  margin-bottom: 12px;
}
.ph-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.ph-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
  margin-bottom: 5px;
}
.ph-label .req {
  color: var(--color-danger-text);
}
.ph-label .hint {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--color-text-faint);
  margin-left: 6px;
  font-size: 10px;
}
.ph-editor-actions {
  margin-top: 4px;
}
.ph-editor-empty {
  border: 1px dashed var(--color-border);
  border-radius: 12px;
  padding: 28px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--color-text-faint);
  font-size: 13px;
}
.ph-assign {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border-subtle);
}
.ph-assign-head {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
  margin-bottom: 8px;
}
.ph-assign-empty {
  font-size: 12px;
  color: var(--color-text-faint);
  font-style: italic;
  margin-bottom: 8px;
}
.ph-assign-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}
.ph-assign-text {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ph-assign-date {
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
  font-size: 11px;
}
.ph-assign-x {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  border-radius: 5px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-muted);
  flex: 0 0 auto;
}
.ph-assign-x:not(:disabled):hover {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
  border-color: var(--color-danger-border);
}
.ph-assign-pick {
  margin-top: 8px;
  font-size: 12.5px;
}
</style>
