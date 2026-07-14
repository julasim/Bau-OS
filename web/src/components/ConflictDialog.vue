<script setup lang="ts">
// ============================================================
// PATIO — Konflikt-Auflösungs-Dialog (Phase 5b)
// ============================================================
// Wenn ein Termin sowohl in PATIO als auch in Outlook geändert
// wurde, lehnt Microsoft das PATCH mit ETag-Mismatch ab und der
// Termin landet in ms_sync_status='conflict'. Dieser Dialog zeigt
// beide Versionen Side-by-Side und lässt den User wählen welche
// gewinnt.
//
// Edge-Case: Outlook hat den Event gelöscht. Dann ist remote=null
// und wir bieten nur "PATIO-Version behalten + neu in Outlook
// anlegen" oder "PATIO-Termin auch löschen" an.
// ============================================================

import { ref, computed, onMounted } from "vue";
import { api } from "../api";

interface MsEventDateTime {
  dateTime: string;
  timeZone: string;
}
interface MsRemote {
  id: string;
  subject: string | null;
  start: MsEventDateTime | null;
  end: MsEventDateTime | null;
  location: string | null;
  isAllDay: boolean;
  attendees: { email: string | null; name: string | null }[];
  etag: string | null;
}
interface ConflictResponse {
  hasConflict: boolean;
  deletedInOutlook?: boolean;
  local: {
    id: string;
    text: string;
    datum: string;
    uhrzeit: string | null;
    endzeit: string | null;
    location: string | null;
    assignees: string[];
    msSyncStatus?: string | null;
  };
  remote: MsRemote | null;
}

const props = defineProps<{
  terminId: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "resolved"): void;
}>();

const data = ref<ConflictResponse | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await api.get<ConflictResponse>(`/termine/${props.terminId}/conflict`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Konnte Konflikt-Daten nicht laden";
  } finally {
    loading.value = false;
  }
}

async function resolve(resolution: "local" | "remote" | "delete-local") {
  busy.value = true;
  error.value = null;
  try {
    await api.post(`/termine/${props.terminId}/resolve`, { resolution });
    emit("resolved");
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Auflösung fehlgeschlagen";
  } finally {
    busy.value = false;
  }
}

// ── Display-Mapping: ISO-MS-Datum für Side-by-Side anzeigen ────────────────
const remoteDatum = computed(() => {
  const dt = data.value?.remote?.start?.dateTime;
  if (!dt) return null;
  const iso = dt.split("T")[0];
  if (!iso) return null;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
});
const remoteZeit = computed(() => {
  const dt = data.value?.remote?.start?.dateTime;
  if (!dt || data.value?.remote?.isAllDay) return null;
  return dt.split("T")[1]?.slice(0, 5) ?? null;
});
const remoteEndzeit = computed(() => {
  const dt = data.value?.remote?.end?.dateTime;
  if (!dt || data.value?.remote?.isAllDay) return null;
  return dt.split("T")[1]?.slice(0, 5) ?? null;
});
const remoteAttendees = computed(() => {
  return (data.value?.remote?.attendees ?? [])
    .map((a) => a.name || a.email || "")
    .filter(Boolean)
    .join(", ");
});

// Diff-Detektor: hebt Felder hervor die zwischen lokal/remote unterschiedlich sind.
function diffClass(field: "text" | "datum" | "uhrzeit" | "endzeit" | "location"): string {
  if (!data.value?.remote) return "";
  const l = data.value.local;
  const r = data.value.remote;
  let lv: string | null = null;
  let rv: string | null = null;
  if (field === "text") {
    lv = l.text;
    rv = r.subject;
  } else if (field === "datum") {
    lv = l.datum;
    rv = remoteDatum.value;
  } else if (field === "uhrzeit") {
    lv = l.uhrzeit;
    rv = remoteZeit.value;
  } else if (field === "endzeit") {
    lv = l.endzeit;
    rv = remoteEndzeit.value;
  } else if (field === "location") {
    lv = l.location;
    rv = r.location;
  }
  return (lv ?? "") !== (rv ?? "") ? "diff" : "";
}

onMounted(() => void load());
</script>

<template>
  <div class="conflict-overlay" @click.self="emit('close')">
    <div class="conflict-card">
      <div class="conflict-header">
        <div>
          <h2 style="margin: 0; font-size: 16px; font-weight: 600">Termin-Konflikt mit Outlook</h2>
          <div class="text-xs" style="color: var(--color-text-muted); margin-top: 4px">
            Dieser Termin wurde sowohl in PATIO als auch in Outlook geändert. Welche Version soll gewinnen?
          </div>
        </div>
        <button @click="emit('close')" class="close-btn" aria-label="Schließen">×</button>
      </div>

      <div v-if="loading" style="padding: 40px; text-align: center; color: var(--color-text-muted)">
        Lade Konflikt-Daten…
      </div>

      <div v-else-if="error" class="error-banner">{{ error }}</div>

      <div v-else-if="data?.deletedInOutlook" class="deleted-state">
        <div style="margin-bottom: 16px">
          <strong>Der Termin wurde in Outlook gelöscht.</strong> Wenn du ihn in PATIO behältst, wird er beim nächsten
          Sync neu in Outlook angelegt.
        </div>
        <div class="local-summary">
          <div class="eyebrow">PATIO-Version</div>
          <div style="font-size: 14px; font-weight: 500">{{ data.local.text }}</div>
          <div class="text-xs" style="color: var(--color-text-muted); margin-top: 4px">
            {{ data.local.datum }}{{ data.local.uhrzeit ? ` · ${data.local.uhrzeit}` : "" }}
            {{ data.local.location ? ` · ${data.local.location}` : "" }}
          </div>
        </div>
        <div class="action-row">
          <button @click="resolve('local')" :disabled="busy" class="btn-primary">
            PATIO behalten + neu in Outlook anlegen
          </button>
          <button @click="resolve('delete-local')" :disabled="busy" class="btn-danger">
            PATIO-Termin auch löschen
          </button>
        </div>
      </div>

      <div v-else-if="data?.remote" class="diff-grid">
        <!-- PATIO-Spalte -->
        <div class="version-col">
          <div class="version-header">
            <div class="version-label">PATIO</div>
          </div>
          <div class="field" :class="diffClass('text')">
            <div class="field-label">Titel</div>
            <div class="field-value">{{ data.local.text }}</div>
          </div>
          <div class="field" :class="diffClass('datum')">
            <div class="field-label">Datum</div>
            <div class="field-value">{{ data.local.datum }}</div>
          </div>
          <div class="field" :class="diffClass('uhrzeit')">
            <div class="field-label">Uhrzeit</div>
            <div class="field-value">{{ data.local.uhrzeit || "ganztägig" }}</div>
          </div>
          <div class="field" :class="diffClass('endzeit')">
            <div class="field-label">Ende</div>
            <div class="field-value">{{ data.local.endzeit || "—" }}</div>
          </div>
          <div class="field" :class="diffClass('location')">
            <div class="field-label">Ort</div>
            <div class="field-value">{{ data.local.location || "—" }}</div>
          </div>
          <div class="field">
            <div class="field-label">Teilnehmer</div>
            <div class="field-value">{{ data.local.assignees.join(", ") || "—" }}</div>
          </div>
          <button @click="resolve('local')" :disabled="busy" class="btn-primary">PATIO-Version behalten</button>
        </div>

        <!-- Outlook-Spalte -->
        <div class="version-col">
          <div class="version-header">
            <div class="ms-badge-inline">O</div>
            <div class="version-label">Outlook</div>
          </div>
          <div class="field" :class="diffClass('text')">
            <div class="field-label">Titel</div>
            <div class="field-value">{{ data.remote.subject }}</div>
          </div>
          <div class="field" :class="diffClass('datum')">
            <div class="field-label">Datum</div>
            <div class="field-value">{{ remoteDatum }}</div>
          </div>
          <div class="field" :class="diffClass('uhrzeit')">
            <div class="field-label">Uhrzeit</div>
            <div class="field-value">{{ remoteZeit || "ganztägig" }}</div>
          </div>
          <div class="field" :class="diffClass('endzeit')">
            <div class="field-label">Ende</div>
            <div class="field-value">{{ remoteEndzeit || "—" }}</div>
          </div>
          <div class="field" :class="diffClass('location')">
            <div class="field-label">Ort</div>
            <div class="field-value">{{ data.remote.location || "—" }}</div>
          </div>
          <div class="field">
            <div class="field-label">Teilnehmer</div>
            <div class="field-value">{{ remoteAttendees || "—" }}</div>
          </div>
          <button @click="resolve('remote')" :disabled="busy" class="btn-secondary">Outlook-Version übernehmen</button>
        </div>
      </div>

      <div class="conflict-footer">
        <div class="text-xs" style="color: var(--color-text-tertiary)">
          Die nicht gewählte Version wird überschrieben — beide Stände bleiben aber im Audit-Log.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conflict-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}
.conflict-card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  width: 100%;
  max-width: 720px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
}
.conflict-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.close-btn {
  background: transparent;
  border: 0;
  font-size: 28px;
  line-height: 1;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 0 8px;
}
.close-btn:hover {
  color: var(--color-text);
}
.error-banner {
  padding: 12px 16px;
  margin: 16px 24px;
  border-radius: 6px;
  background: #fee2e2;
  color: #991b1b;
  font-size: 13px;
}
.diff-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--color-border);
  margin: 0;
}
.version-col {
  background: var(--color-bg);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.version-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.version-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.ms-badge-inline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: #0078d4;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid transparent;
}
.field.diff {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.3);
}
.field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  font-weight: 600;
}
.field-value {
  font-size: 13px;
  color: var(--color-text);
  word-break: break-word;
}
.btn-primary,
.btn-secondary,
.btn-danger {
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  margin-top: auto;
  transition: opacity 180ms ease;
}
.btn-primary {
  background: var(--color-primary, #111827);
  color: var(--color-bg);
  border: 0;
}
.btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}
.btn-secondary {
  background: #fff;
  color: #111827;
  border: 1px solid var(--color-border);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--color-border-subtle);
}
.btn-danger {
  background: transparent;
  color: #dc2626;
  border: 1px solid #dc2626;
}
.btn-danger:hover:not(:disabled) {
  background: #fee2e2;
}
.btn-primary:disabled,
.btn-secondary:disabled,
.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.conflict-footer {
  padding: 12px 24px 20px;
  border-top: 1px solid var(--color-border-subtle);
}
.deleted-state {
  padding: 24px;
}
.local-summary {
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.eyebrow {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  font-weight: 600;
  margin-bottom: 6px;
}
.action-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 600px) {
  .diff-grid {
    grid-template-columns: 1fr;
  }
}
</style>
