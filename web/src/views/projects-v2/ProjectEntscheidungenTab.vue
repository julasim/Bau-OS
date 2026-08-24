<script setup lang="ts">
// ── Entscheidungen (Entscheidungslog, Migration 045) ─────────────────────────
//
// Löst das Freitextfeld am Besprechungsprotokoll ab. Der eigentliche Wert
// steckt nicht in der Entscheidung selbst, sondern in der Begründung und den
// verworfenen Alternativen: ein halbes Jahr später fragt der Bauherr „warum
// eigentlich Holz-Alu?" — und genau dann soll die Antwort hier stehen.
//
// Portiert aus `apps/patio-app-lokal`; die Aufrufschicht ist die des Servers
// (JWT statt Shared-Secret), deshalb neu geschrieben statt kopiert.
import { ref, computed, onMounted } from "vue";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";
import TeamPicker from "../../components/TeamPicker.vue";
import { useConfirm } from "../../composables/useConfirm";
import { useEvents } from "../../composables/useEvents";
import { formatDate, heuteIso } from "../../utils/format";

const props = defineProps<{ projectName: string }>();
const { confirm } = useConfirm();

type Status = "entwurf" | "bestaetigt";

interface Alternative {
  text: string;
  verworfenWeil?: string | null;
}

interface Entscheidung {
  id: string;
  datum: string;
  titel: string;
  begruendung: string | null;
  alternativen: Alternative[];
  beteiligteIds: string[];
  beteiligteResolved?: { id: string; name: string }[];
  beteiligteExtern: string[];
  status: Status;
  relatedMeetingId: string | null;
  relatedMeetingResolved?: { id: string; title: string; date: string } | null;
  createdByUsername?: string;
  updatedAt: string;
  rev?: number;
}

interface Besprechung {
  id: string;
  title: string;
  date: string;
}

const eintraege = ref<Entscheidung[]>([]);
const besprechungen = ref<Besprechung[]>([]);
const geladen = ref(false);
const fehler = ref<string | null>(null);

// ── Editor ──────────────────────────────────────────────────────────────────
const editorOffen = ref(false);
const bearbeiteteId = ref<string | null>(null);
const entwurf = ref(leererEntwurf());

function leererEntwurf() {
  return {
    datum: heuteIso(),
    titel: "",
    begruendung: "",
    alternativen: [] as Alternative[],
    beteiligteIds: [] as string[],
    beteiligteExtern: [] as string[],
    status: "entwurf" as Status,
    relatedMeetingId: null as string | null,
    rev: undefined as number | undefined,
  };
}

const titelFehlt = computed(() => entwurf.value.titel.trim().length === 0);

async function laden() {
  fehler.value = null;
  try {
    const pfad = encodeURIComponent(props.projectName);
    eintraege.value = await api.get<Entscheidung[]>(`/projects/${pfad}/entscheidungen`);
    besprechungen.value = await api.get<Besprechung[]>(`/projects/${pfad}/meetings`);
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Entscheidungen konnten nicht geladen werden";
  } finally {
    geladen.value = true;
  }
}

function neu() {
  bearbeiteteId.value = null;
  entwurf.value = leererEntwurf();
  editorOffen.value = true;
}

function bearbeiten(e: Entscheidung) {
  bearbeiteteId.value = e.id;
  entwurf.value = {
    datum: e.datum,
    titel: e.titel,
    begruendung: e.begruendung ?? "",
    alternativen: e.alternativen.map((a) => ({ ...a })),
    beteiligteIds: [...e.beteiligteIds],
    beteiligteExtern: [...e.beteiligteExtern],
    status: e.status,
    relatedMeetingId: e.relatedMeetingId,
    // Der beim Laden mitgelieferte Zähler geht beim Speichern zurück. Ohne
    // ihn gölte wieder „wer zuletzt speichert, gewinnt".
    rev: e.rev,
  };
  editorOffen.value = true;
}

function alternativeHinzufuegen() {
  entwurf.value.alternativen.push({ text: "", verworfenWeil: "" });
}

function alternativeEntfernen(i: number) {
  entwurf.value.alternativen.splice(i, 1);
}

async function speichern() {
  if (titelFehlt.value) return;
  fehler.value = null;
  const koerper = {
    datum: entwurf.value.datum,
    titel: entwurf.value.titel.trim(),
    begruendung: entwurf.value.begruendung.trim() || null,
    // Leere Zeilen aus dem Formular fliegen raus — sonst stünde in der Liste
    // eine Alternative ohne Text.
    alternativen: entwurf.value.alternativen
      .filter((a) => a.text.trim())
      .map((a) => ({ text: a.text.trim(), verworfenWeil: (a.verworfenWeil ?? "").trim() || null })),
    beteiligteIds: entwurf.value.beteiligteIds,
    beteiligteExtern: entwurf.value.beteiligteExtern,
    status: entwurf.value.status,
    relatedMeetingId: entwurf.value.relatedMeetingId,
    ...(bearbeiteteId.value ? { rev: entwurf.value.rev } : {}),
  };
  try {
    if (bearbeiteteId.value) {
      await api.patch(`/entscheidungen/${bearbeiteteId.value}`, koerper);
    } else {
      await api.post(`/projects/${encodeURIComponent(props.projectName)}/entscheidungen`, koerper);
    }
    editorOffen.value = false;
    await laden();
  } catch (e) {
    // Der Server antwortet bei einem veralteten Zähler mit 409 und einem Text,
    // der sagt, was zu tun ist. Der Editor bleibt offen, damit die Eingabe
    // nicht verloren geht.
    fehler.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
  }
}

async function loeschen(e: Entscheidung) {
  if (!(await confirm(`Entscheidung „${e.titel}" löschen?`))) return;
  try {
    await api.delete(`/entscheidungen/${e.id}`);
    await laden();
  } catch (err) {
    fehler.value = err instanceof Error ? err.message : "Löschen fehlgeschlagen";
  }
}

useEvents(["entscheidung"], () => {
  void laden();
});

onMounted(laden);
</script>

<template>
  <div class="ent-tab">
    <div class="ent-head">
      <div>
        <div class="eyebrow">Entscheidungslog</div>
        <p class="ent-lead">
          Was entschieden wurde — und warum. Die verworfenen Alternativen sind der eigentliche Wert: sie beantworten die
          Rückfrage, die ein halbes Jahr später kommt.
        </p>
      </div>
      <button class="row-action" @click="neu"><BIcon name="plus" :size="12" /> Neue Entscheidung</button>
    </div>

    <div v-if="fehler" class="ent-error">{{ fehler }}</div>

    <div v-if="!geladen" class="empty-hint">Lade…</div>
    <div v-else-if="eintraege.length === 0 && !editorOffen" class="empty-hint">
      Für dieses Projekt ist noch keine Entscheidung festgehalten.
    </div>

    <!-- Editor -->
    <div v-if="editorOffen" class="ent-editor">
      <div class="ent-row">
        <label class="ent-field">
          <span class="eyebrow">Datum</span>
          <input v-model="entwurf.datum" type="date" class="stamm-input" />
        </label>
        <label class="ent-field ent-field-wide">
          <span class="eyebrow">Titel</span>
          <input v-model="entwurf.titel" type="text" class="stamm-input" placeholder="z.B. Fenster in Holz-Alu" />
        </label>
        <label class="ent-field">
          <span class="eyebrow">Status</span>
          <select v-model="entwurf.status" class="stamm-input">
            <option value="entwurf">Entwurf</option>
            <option value="bestaetigt">Bestätigt</option>
          </select>
        </label>
      </div>

      <label class="ent-field">
        <span class="eyebrow">Begründung</span>
        <textarea
          v-model="entwurf.begruendung"
          class="stamm-input"
          rows="3"
          placeholder="Warum so und nicht anders?"
        ></textarea>
      </label>

      <div class="ent-field">
        <div class="ent-alt-head">
          <span class="eyebrow">Erwogene Alternativen</span>
          <button class="row-action" @click="alternativeHinzufuegen">
            <BIcon name="plus" :size="10" /> Alternative
          </button>
        </div>
        <div v-for="(alt, i) in entwurf.alternativen" :key="i" class="ent-alt-row">
          <input v-model="alt.text" type="text" class="stamm-input" placeholder="Was wurde erwogen?" />
          <input v-model="alt.verworfenWeil" type="text" class="stamm-input" placeholder="Verworfen, weil …" />
          <button class="row-action row-action-danger" @click="alternativeEntfernen(i)">
            <BIcon name="x" :size="10" />
          </button>
        </div>
      </div>

      <div class="ent-row">
        <div class="ent-field ent-field-wide">
          <span class="eyebrow">Beteiligte</span>
          <TeamPicker
            mode="multi"
            :model-value="entwurf.beteiligteIds"
            :free-text="entwurf.beteiligteExtern"
            @update:model-value="(v) => (entwurf.beteiligteIds = (v as string[]) ?? [])"
            @update:free-text="(v) => (entwurf.beteiligteExtern = v)"
          />
        </div>
        <label class="ent-field ent-field-wide">
          <span class="eyebrow">Aus Besprechung</span>
          <select v-model="entwurf.relatedMeetingId" class="stamm-input">
            <option :value="null">— kein Bezug —</option>
            <option v-for="m in besprechungen" :key="m.id" :value="m.id">
              {{ formatDate(m.date) }} · {{ m.title }}
            </option>
          </select>
        </label>
      </div>

      <div class="ent-actions">
        <button class="row-action" :disabled="titelFehlt" @click="speichern">Speichern</button>
        <button class="row-action" @click="editorOffen = false">Abbrechen</button>
      </div>
    </div>

    <!-- Liste -->
    <ul v-if="eintraege.length > 0" class="ent-list">
      <li v-for="e in eintraege" :key="e.id" class="ent-item">
        <div class="ent-item-head">
          <span class="ent-datum font-mono">{{ formatDate(e.datum) }}</span>
          <span class="ent-titel">{{ e.titel }}</span>
          <span class="ent-status" :class="`ent-status-${e.status}`">
            {{ e.status === "bestaetigt" ? "Bestätigt" : "Entwurf" }}
          </span>
          <span class="ent-item-actions">
            <button class="row-action" @click="bearbeiten(e)"><BIcon name="pencil" :size="11" /></button>
            <button class="row-action row-action-danger" @click="loeschen(e)">
              <BIcon name="x" :size="11" />
            </button>
          </span>
        </div>

        <p v-if="e.begruendung" class="ent-begruendung">{{ e.begruendung }}</p>

        <ul v-if="e.alternativen.length > 0" class="ent-alt-list">
          <li v-for="(alt, i) in e.alternativen" :key="i">
            <span class="ent-alt-text">{{ alt.text }}</span>
            <span v-if="alt.verworfenWeil" class="ent-alt-grund">— verworfen: {{ alt.verworfenWeil }}</span>
          </li>
        </ul>

        <div class="ent-meta">
          <span v-if="e.beteiligteResolved?.length || e.beteiligteExtern.length">
            <BIcon name="users" :size="10" />
            {{ [...(e.beteiligteResolved ?? []).map((b) => b.name), ...e.beteiligteExtern].join(", ") }}
          </span>
          <span v-if="e.relatedMeetingResolved">
            <BIcon name="kanban" :size="10" />
            {{ e.relatedMeetingResolved.title }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ent-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ent-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.ent-lead {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
  margin: 4px 0 0;
  max-width: 64ch;
}
.ent-error {
  border: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
  padding: 8px 12px;
  font-size: 12px;
}
.ent-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--color-border);
  padding: 16px;
}
.ent-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.ent-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
}
.ent-field-wide {
  flex: 1;
  min-width: 220px;
}
.ent-alt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ent-alt-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.ent-alt-row .stamm-input {
  flex: 1;
}
.ent-actions {
  display: flex;
  gap: 8px;
}
.ent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px solid var(--color-border);
}
.ent-item {
  padding: 12px 4px;
  border-bottom: 1px solid var(--color-border);
}
.ent-item-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ent-datum {
  font-size: 11px;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
.ent-titel {
  font-size: 13px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
}
.ent-status {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.ent-status-bestaetigt {
  color: var(--color-text);
  border-color: var(--color-text);
}
.ent-item-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.ent-begruendung {
  font-size: 12px;
  line-height: 1.6;
  margin: 6px 0 0;
  color: var(--color-text-muted);
  white-space: pre-wrap;
}
.ent-alt-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  font-size: 12px;
}
.ent-alt-list li {
  padding: 2px 0 2px 10px;
  border-left: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
.ent-alt-grund {
  color: var(--color-text-tertiary);
  margin-left: 4px;
}
.ent-meta {
  display: flex;
  gap: 14px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}
.ent-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
