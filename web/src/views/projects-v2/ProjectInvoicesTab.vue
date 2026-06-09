<script setup lang="ts">
// ── Rechnungs-Tab (Teilrechnungen + Honorarsicht) ────────────────────────
// Zeigt die Honorar-Bilanz je Projekt (aus /finance) und verwaltet die
// Teilrechnungen (CRUD). Optionale Zuordnung jeder Rechnung zu einer
// Leistungsphase. DB-only.
import { ref, computed, onMounted } from "vue";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";

const props = defineProps<{ projectName: string }>();

type InvoiceStatus = "entwurf" | "gestellt" | "bezahlt";

interface ProjectInvoice {
  id: string;
  projectId: string;
  phaseId: string | null;
  phaseName: string | null;
  nummer: string | null;
  betrag: number;
  datum: string | null;
  status: InvoiceStatus;
  note: string | null;
}

interface FinancePhase {
  phaseId: string;
  name: string;
  status: string;
  feeShare: number;
  progress: number;
  sollHonorar: number | null;
  invoiced: number;
  offen: number | null;
  kostenIst: number;
  deckung: number | null;
}
interface Finance {
  budget: number | null;
  invoicedTotal: number;
  unassignedInvoiced: number;
  kostenIstTotal: number;
  feeShareSum: number;
  perPhase: FinancePhase[];
}

interface InvoiceDraft {
  id: string | null;
  nummer: string;
  betrag: string;
  datum: string;
  status: InvoiceStatus;
  phaseId: string | null;
  note: string;
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  entwurf: "Entwurf",
  gestellt: "Gestellt",
  bezahlt: "Bezahlt",
};

const invoices = ref<ProjectInvoice[]>([]);
const finance = ref<Finance | null>(null);
const phases = ref<{ id: string; name: string }[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const draft = ref<InvoiceDraft | null>(null);

const encName = computed(() => encodeURIComponent(props.projectName));

const offenGesamt = computed(() => {
  if (!finance.value || finance.value.budget == null) return null;
  return Math.round((finance.value.budget - finance.value.invoicedTotal) * 100) / 100;
});

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("de-AT", { maximumFractionDigits: 0 }) + " €";
}

async function load() {
  try {
    const [inv, fin, ph] = await Promise.all([
      api.get<ProjectInvoice[]>(`/projects/${encName.value}/invoices`),
      api.get<Finance>(`/projects/${encName.value}/finance`).catch(() => null),
      api
        .get<{ phases: { id: string; name: string }[] }>(`/projects/${encName.value}/phases`)
        .then((r) => r.phases ?? [])
        .catch(() => []),
    ]);
    invoices.value = Array.isArray(inv) ? inv : [];
    finance.value = fin;
    phases.value = ph.map((p) => ({ id: p.id, name: p.name }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Rechnungen konnten nicht geladen werden.";
  } finally {
    loaded.value = true;
  }
}

function emptyDraft(): InvoiceDraft {
  return { id: null, nummer: "", betrag: "", datum: "", status: "entwurf", phaseId: null, note: "" };
}
function newInvoice() {
  draft.value = emptyDraft();
}
function selectInvoice(inv: ProjectInvoice) {
  draft.value = {
    id: inv.id,
    nummer: inv.nummer ?? "",
    betrag: String(inv.betrag ?? ""),
    datum: inv.datum ?? "",
    status: inv.status,
    phaseId: inv.phaseId,
    note: inv.note ?? "",
  };
}
function cancelEdit() {
  draft.value = null;
}

async function save() {
  if (!draft.value) return;
  const d = draft.value;
  error.value = null;
  busy.value = true;
  const body = {
    nummer: d.nummer.trim() || null,
    betrag: Number(d.betrag) || 0,
    datum: d.datum || null,
    status: d.status,
    phaseId: d.phaseId,
    note: d.note.trim() || null,
  };
  try {
    if (d.id) await api.put(`/invoices/${d.id}`, body);
    else await api.post(`/projects/${encName.value}/invoices`, body);
    draft.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Speichern fehlgeschlagen.";
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!draft.value?.id) return;
  if (!confirm("Diese Teilrechnung wirklich löschen?")) return;
  busy.value = true;
  try {
    await api.delete(`/invoices/${draft.value.id}`);
    draft.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Löschen fehlgeschlagen.";
  } finally {
    busy.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="inv-tab">
    <div v-if="!loaded" class="empty-hint">Lade Rechnungen…</div>

    <template v-else>
      <!-- Honorar-Bilanz -->
      <div v-if="finance" class="inv-summary">
        <div class="inv-sum-item">
          <span class="inv-sum-lbl">Budget</span><span class="inv-sum-val">{{ money(finance.budget) }}</span>
        </div>
        <div class="inv-sum-item">
          <span class="inv-sum-lbl">Fakturiert</span><span class="inv-sum-val">{{ money(finance.invoicedTotal) }}</span>
        </div>
        <div class="inv-sum-item">
          <span class="inv-sum-lbl">Offen</span><span class="inv-sum-val">{{ money(offenGesamt) }}</span>
        </div>
        <div v-if="finance.kostenIstTotal > 0" class="inv-sum-item">
          <span class="inv-sum-lbl">Ist-Kosten</span
          ><span class="inv-sum-val">{{ money(finance.kostenIstTotal) }}</span>
        </div>
        <div v-if="finance.unassignedInvoiced > 0" class="inv-sum-item">
          <span class="inv-sum-lbl">ohne Phase</span
          ><span class="inv-sum-val">{{ money(finance.unassignedInvoiced) }}</span>
        </div>
      </div>

      <div v-if="error" class="ph-error">{{ error }}</div>

      <!-- Honorar je Phase -->
      <div v-if="finance && finance.perPhase.length" class="inv-phasetable">
        <div class="inv-pt-head">Honorar je Phase</div>
        <table>
          <thead>
            <tr>
              <th>Phase</th>
              <th class="r">Anteil</th>
              <th class="r">Soll-Honorar</th>
              <th class="r">Fakturiert</th>
              <th class="r">Offen</th>
              <th class="r">Ist-Kosten</th>
              <th class="r">Deckung</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in finance.perPhase" :key="p.phaseId">
              <td>{{ p.name }}</td>
              <td class="r">{{ p.feeShare }}%</td>
              <td class="r">{{ money(p.sollHonorar) }}</td>
              <td class="r">{{ money(p.invoiced) }}</td>
              <td class="r" :class="{ 'inv-neg': p.offen !== null && p.offen < 0 }">{{ money(p.offen) }}</td>
              <td class="r">{{ money(p.kostenIst) }}</td>
              <td class="r" :class="{ 'inv-neg': p.deckung !== null && p.deckung < 0 }">{{ money(p.deckung) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Rechnungs-Liste + Editor -->
      <div class="inv-bar">
        <button class="bauos-btn solid sm" @click="newInvoice">
          <BIcon name="plus" :size="11" /><span style="margin-left: 4px">Teilrechnung</span>
        </button>
      </div>

      <div v-if="invoices.length === 0 && !draft" class="empty-state" style="margin-top: 8px">
        <div class="empty-state-icon"><BIcon name="archive" :size="26" /></div>
        <div class="empty-state-text">Noch keine Teilrechnungen für dieses Projekt.</div>
        <button class="bauos-btn solid sm" @click="newInvoice">
          <BIcon name="plus" :size="11" />Erste Teilrechnung
        </button>
      </div>

      <div v-else class="inv-grid">
        <div class="inv-list">
          <div
            v-for="inv in invoices"
            :key="inv.id"
            :class="['inv-row', draft?.id === inv.id ? 'inv-row-active' : '']"
            @click="selectInvoice(inv)"
          >
            <div class="inv-row-main">
              <span class="inv-nr">{{ inv.nummer || "(ohne Nr.)" }}</span>
              <span class="inv-status" :class="'st-' + inv.status">{{ STATUS_LABEL[inv.status] }}</span>
            </div>
            <div class="inv-row-meta">
              <span class="inv-betrag">{{ money(inv.betrag) }}</span>
              <span v-if="inv.datum" class="inv-sep">·</span><span v-if="inv.datum">{{ inv.datum }}</span>
              <span v-if="inv.phaseName" class="inv-sep">·</span><span v-if="inv.phaseName">{{ inv.phaseName }}</span>
            </div>
          </div>
        </div>

        <div class="inv-editor" v-if="draft">
          <div class="inv-editor-head">
            <h3>{{ draft.id ? "Rechnung bearbeiten" : "Neue Teilrechnung" }}</h3>
            <button v-if="draft.id" class="bauos-btn ghost sm" :disabled="busy" @click="remove">
              <BIcon name="trash" :size="11" /><span style="margin-left: 4px">Löschen</span>
            </button>
            <button v-else class="bauos-btn ghost sm" :disabled="busy" @click="cancelEdit">Abbrechen</button>
          </div>

          <div class="ph-field-row">
            <div class="ph-field">
              <label class="ph-label">Nummer</label>
              <input v-model="draft.nummer" type="text" class="stamm-input" placeholder="z. B. 2026-014" />
            </div>
            <div class="ph-field">
              <label class="ph-label">Betrag €</label>
              <input v-model="draft.betrag" type="number" min="0" step="0.01" class="stamm-input" placeholder="0" />
            </div>
          </div>
          <div class="ph-field-row">
            <div class="ph-field">
              <label class="ph-label">Datum</label>
              <input v-model="draft.datum" type="date" class="stamm-input" />
            </div>
            <div class="ph-field">
              <label class="ph-label">Status</label>
              <select v-model="draft.status" class="stamm-input">
                <option value="entwurf">Entwurf</option>
                <option value="gestellt">Gestellt</option>
                <option value="bezahlt">Bezahlt</option>
              </select>
            </div>
          </div>
          <div class="ph-field" v-if="phases.length">
            <label class="ph-label">Phase</label>
            <select v-model="draft.phaseId" class="stamm-input">
              <option :value="null">— (ohne Phase)</option>
              <option v-for="ph in phases" :key="ph.id" :value="ph.id">{{ ph.name }}</option>
            </select>
          </div>
          <div class="ph-field">
            <label class="ph-label">Notiz</label>
            <input v-model="draft.note" type="text" class="stamm-input" placeholder="(optional)" />
          </div>
          <div>
            <button class="bauos-btn solid sm" :disabled="busy" @click="save">
              <BIcon name="check" :size="11" /><span style="margin-left: 4px">{{
                draft.id ? "Speichern" : "Anlegen"
              }}</span>
            </button>
          </div>
        </div>
        <div v-else class="ph-editor-empty">
          <BIcon name="archive" :size="22" /><span>Rechnung auswählen oder neu anlegen</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.inv-summary {
  display: flex;
  gap: 1px;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  width: fit-content;
  margin-bottom: 16px;
}
.inv-sum-item {
  background: var(--color-bg);
  padding: 10px 20px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.inv-sum-lbl {
  font-size: 11px;
  color: var(--color-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.inv-sum-val {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.inv-phasetable {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 18px;
}
.inv-pt-head {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
  padding: 9px 14px;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}
.inv-phasetable table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.inv-phasetable th {
  text-align: left;
  padding: 7px 14px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
  font-weight: 600;
}
.inv-phasetable td {
  padding: 7px 14px;
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.inv-phasetable .r {
  text-align: right;
}
.inv-neg {
  color: var(--color-danger-text);
}
.inv-bar {
  margin-bottom: 12px;
}
.inv-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 18px;
  align-items: start;
}
@media (max-width: 860px) {
  .inv-grid {
    grid-template-columns: 1fr;
  }
}
.inv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.inv-row {
  padding: 11px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  cursor: pointer;
}
.inv-row:hover {
  border-color: var(--color-text-faint);
}
.inv-row-active {
  border-color: var(--color-accent);
  background: var(--color-bg-subtle);
}
.inv-row-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.inv-nr {
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}
.inv-status {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 7px;
  border-radius: 5px;
}
.st-entwurf {
  color: var(--color-text-muted);
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border);
}
.st-gestellt {
  color: var(--color-warning-text);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
}
.st-bezahlt {
  color: var(--color-success-text);
  background: var(--color-success-bg);
  border: 1px solid var(--color-success-border);
}
.inv-row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}
.inv-betrag {
  font-weight: 600;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.inv-sep {
  color: var(--color-text-faint);
}
.inv-editor {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 16px;
  background: var(--color-bg);
  position: sticky;
  top: 8px;
}
.inv-editor-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.inv-editor-head h3 {
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
.ph-error {
  font-size: 13px;
  color: var(--color-danger-text);
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
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
</style>
