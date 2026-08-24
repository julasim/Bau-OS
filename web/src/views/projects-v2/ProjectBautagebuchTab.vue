<script setup lang="ts">
// ============================================================
// PATIO — Projektakte, Reiter „Bautagebuch" (Migration 011)
// ============================================================
// Ein Eintrag je Kalendertag: Witterung, Temperaturen, anwesendes Personal,
// Geräte, Tätigkeiten, Vorkommnisse. Herausgelöst aus `ProjectDetailView.vue`.
//
// Der Reiter lädt seine Daten selbst — Einträge, Team (für die Personalauswahl)
// und die Word-Vorlagen. Die Akte lud das früher mit, auch wenn niemand den
// Reiter öffnete.
//
// ── Warum ein Eintrag je Datum und kein „neuer Eintrag" ────────────────────
//
// Weil das Bautagebuch ein Tagesprotokoll ist: es gibt den 24.08. genau
// einmal. Gespeichert wird deshalb per PUT auf das Datum, nicht per POST —
// wer denselben Tag zweimal öffnet, ergänzt ihn, statt ihn zu verdoppeln.
// ============================================================

import { ref, watch, onMounted } from "vue";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";
import TeamPicker from "../../components/TeamPicker.vue";
import { useConfirm } from "../../composables/useConfirm";
import { useWordExport } from "../../composables/useWordExport";
import { heuteIso } from "../../utils/format";

const props = defineProps<{ projectName: string }>();
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

// ── Warum es „Ältere laden" braucht ──────────────────────────────────────
//
// Die Liste holte eine feste Zahl neuester Einträge (60) und bot keinen Weg zu
// den älteren. Nach rund zwei Monaten täglicher Einträge war der ältere
// Bestand im Programm nicht mehr erreichbar — die Daten waren da, der Weg
// dorthin nicht.
//
// Geblättert wird über einen Datums-Cursor (`?vor=`), nicht über einen
// Offset: während jemand blättert, können neue Einträge dazukommen, und ein
// Offset überspringt dann Zeilen oder zeigt sie doppelt.
const BAUTAGEBUCH_SEITE = 60;
const bautagebuchMehr = ref(false);
const laedtMehr = ref(false);

async function ladeAeltereBautagebuch() {
  const aeltester = bautagebuchEntries.value.at(-1)?.date;
  if (!aeltester) return;
  laedtMehr.value = true;
  try {
    const weitere = await api.get<BautagebuchEntry[]>(
      `/projects/${n()}/bautagebuch?limit=${BAUTAGEBUCH_SEITE}&vor=${aeltester}`,
    );
    bautagebuchEntries.value = [...bautagebuchEntries.value, ...weitere];
    bautagebuchMehr.value = weitere.length === BAUTAGEBUCH_SEITE;
  } finally {
    laedtMehr.value = false;
  }
}

async function loadBautagebuch() {
  try {
    bautagebuchEntries.value = await api.get<BautagebuchEntry[]>(
      `/projects/${n()}/bautagebuch?limit=${BAUTAGEBUCH_SEITE}`,
    );
    bautagebuchMehr.value = bautagebuchEntries.value.length === BAUTAGEBUCH_SEITE;
    bautagebuchLoaded.value = true;
    // Wenn nichts ausgewählt: Heute, falls Eintrag vorhanden — sonst neu für heute.
    if (!bautagebuchSelectedDate.value) {
      const today = heuteIso();
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
  bautagebuchSelectedDate.value = heuteIso();
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

    const date = bautagebuchSelectedDate.value;
    const saved = await api.put<BautagebuchEntry>(`/projects/${n()}/bautagebuch/${date}`, body);

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
    const date = bautagebuchSelectedDate.value;
    await api.delete(`/projects/${n()}/bautagebuch/${date}`);
    bautagebuchEntries.value = bautagebuchEntries.value.filter((e) => e.date !== date);
    bautagebuchSelectedDate.value = "";
    bautagebuchDraft.value = null;
  } catch (e) {
    bautagebuchError.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
  }
}

async function exportBautagebuchDocx(id: string, alsPdf = false) {
  await download(
    mitVorlage(`/api/exports/bautagebuch/${id}`, "bautagebuch", alsPdf),
    `Bautagebuch-${id}.${endung(alsPdf)}`,
  );
}

async function ladeTeam() {
  try {
    allTeam.value = await api.get<TeamMitglied[]>("/team");
  } catch {
    allTeam.value = [];
  }
}

onMounted(() => {
  void loadBautagebuch();
  void ladeTeam();
  void ladeExportVorlagen();
});

// Projektwechsel ohne Neuaufbau der Komponente (Adresszeile) — sonst zeigte
// der Reiter das Bautagebuch des vorigen Projekts.
watch(
  () => props.projectName,
  () => {
    bautagebuchLoaded.value = false;
    bautagebuchSelectedDate.value = "";
    bautagebuchDraft.value = null;
    void loadBautagebuch();
  },
);
</script>

<template>
  <div class="bt-tab">
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
          <button v-if="bautagebuchMehr" class="mehr-laden" :disabled="laedtMehr" @click="ladeAeltereBautagebuch">
            {{ laedtMehr ? "lädt …" : "Ältere laden" }}
          </button>
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
            <select
              v-if="vorlagenFuer('bautagebuch').length > 1"
              v-model="gewaehlteVorlage['bautagebuch']"
              class="vorlagen-waehler"
              title="Word-Vorlage wählen"
            >
              <option value="">Standardvorlage</option>
              <option v-for="v in vorlagenFuer('bautagebuch')" :key="v.id" :value="v.id">{{ v.name }}</option>
            </select>
            <button
              v-if="bautagebuchEntries.find((e) => e.date === bautagebuchSelectedDate)"
              class="patio-btn ghost sm"
              @click="
                exportBautagebuchDocx(bautagebuchEntries.find((e) => e.date === bautagebuchSelectedDate)!.id, false)
              "
              title="Diesen Tag als Word herunterladen"
            >
              <BIcon name="download" :size="11" />
              <span style="margin-left: 4px">Word</span>
            </button>
            <button
              v-if="pdfMoeglich"
              class="patio-btn ghost sm"
              title="Dieselbe Vorlage, als PDF"
              @click="
                exportBautagebuchDocx(bautagebuchEntries.find((e) => e.date === bautagebuchSelectedDate)!.id, true)
              "
            >
              <BIcon name="download" :size="11" />
              <span style="margin-left: 4px">PDF</span>
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
</template>

<style scoped>
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
</style>
