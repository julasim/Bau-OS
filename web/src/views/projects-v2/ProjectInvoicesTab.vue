<script setup lang="ts">
import { formatEUR } from "../../utils/format";
// ── Rechnungs-Tab (Teilrechnungen + Honorarsicht) ────────────────────────
// Zeigt die Honorar-Bilanz je Projekt (aus /finance) und verwaltet die
// Teilrechnungen (CRUD). Optionale Zuordnung jeder Rechnung zu einer
// Leistungsphase. DB-only.
import { ref, computed, onMounted, watch } from "vue";
import { api, ApiError } from "../../api";
import BIcon from "../../components/BIcon.vue";
import { dateiHolen } from "../../utils/download";

const props = defineProps<{ projectName: string }>();

type InvoiceStatus = "entwurf" | "gestellt" | "bezahlt";

interface InvoicePosition {
  text: string;
  menge: number;
  einheit: string | null;
  einzelpreis: number;
  ustSatz: number;
}

/** Wiederverwendbare Leistung aus dem Positionskatalog (Migration 046). */
interface KatalogItem {
  id: string;
  text: string;
  einheit: string | null;
  einzelpreis: number;
  ustSatz: number;
}

interface ProjectInvoice {
  id: string;
  projectId: string;
  phaseId: string | null;
  phaseName: string | null;
  nummer: string | null;
  betrag: number;
  positionen: InvoicePosition[];
  datum: string | null;
  status: InvoiceStatus;
  note: string | null;
  rev?: number;
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
  positionen: InvoicePosition[];
  datum: string;
  status: InvoiceStatus;
  phaseId: string | null;
  note: string;
  rev?: number;
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
const katalog = ref<KatalogItem[]>([]);

/** Vorschau der Summe im Editor. Der Server rechnet dasselbe noch einmal —
 *  hier steht sie nur, damit man beim Tippen sieht, was herauskommt. */
const positionsSumme = computed(() => {
  if (!draft.value) return 0;
  return Math.round(draft.value.positionen.reduce((s, p) => s + p.menge * p.einzelpreis, 0) * 100) / 100;
});

function positionHinzufuegen(k?: KatalogItem) {
  if (!draft.value) return;
  draft.value.positionen.push(
    k
      ? // Aus dem Katalog wird KOPIERT, nicht referenziert: eine spaetere
        // Preisanpassung im Katalog darf gestellte Rechnungen nicht
        // rueckwirkend aendern.
        { text: k.text, menge: 1, einheit: k.einheit, einzelpreis: k.einzelpreis, ustSatz: k.ustSatz }
      : { text: "", menge: 1, einheit: null, einzelpreis: 0, ustSatz: 20 },
  );
}

function positionEntfernen(i: number) {
  draft.value?.positionen.splice(i, 1);
}

const encName = computed(() => encodeURIComponent(props.projectName));

const offenGesamt = computed(() => {
  if (!finance.value || finance.value.budget == null) return null;
  return Math.round((finance.value.budget - finance.value.invoicedTotal) * 100) / 100;
});

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return formatEUR(n);
}

async function load() {
  try {
    const [inv, fin, ph, kat] = await Promise.all([
      api.get<ProjectInvoice[]>(`/projects/${encName.value}/invoices`),
      api.get<Finance>(`/projects/${encName.value}/finance`).catch(() => null),
      api
        .get<{ phases: { id: string; name: string }[] }>(`/projects/${encName.value}/phases`)
        .then((r) => r.phases ?? [])
        .catch(() => []),
      // Der Katalog ist ans Geld-Recht gebunden und antwortet sonst mit 403.
      // Dieser Reiter ist ohnehin nur mit dem Recht erreichbar; das `catch`
      // deckt den Fall ab, dass es waehrend der Sitzung entzogen wird.
      api.get<KatalogItem[]>("/positionskatalog").catch(() => [] as KatalogItem[]),
    ]);
    invoices.value = Array.isArray(inv) ? inv : [];
    finance.value = fin;
    katalog.value = Array.isArray(kat) ? kat : [];
    phases.value = ph.map((p) => ({ id: p.id, name: p.name }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Rechnungen konnten nicht geladen werden.";
  } finally {
    loaded.value = true;
  }
}

function emptyDraft(): InvoiceDraft {
  return {
    id: null,
    nummer: "",
    betrag: "",
    positionen: [],
    datum: "",
    status: "entwurf",
    phaseId: null,
    note: "",
  };
}
/** Die naechste freie Rechnungsnummer, aus der Projektnummer abgeleitet.
 *
 *  Ein VORSCHLAG: die Rechnungsnummer ist steuerlich relevant, und Stornos,
 *  uebernommene Vorgaenge und Korrekturen folgen keinem Schema. Er steht im
 *  Feld und laesst sich ueberschreiben.
 *
 *  Erst beim Anlegen geholt und nicht beim Seitenaufbau — beim Bearbeiten
 *  einer bestehenden Rechnung waere er falsch. */
async function newInvoice() {
  draft.value = emptyDraft();
  try {
    const { vorschlag } = await api.get<{ vorschlag: string | null }>(
      `/projects/${encodeURIComponent(props.projectName)}/invoices/naechste-nummer`,
    );
    // Nur setzen, wenn das Formular noch leer ist: der Aufruf ist
    // asynchron, und wer schnell tippt, soll nicht ueberschrieben werden.
    if (vorschlag && draft.value && draft.value.nummer === "") draft.value.nummer = vorschlag;
  } catch {
    // Ein fehlender Vorschlag ist kein Fehler — das Projekt hat dann keine
    // (echte) Nummer. Das Feld bleibt leer und ist von Hand ausfuellbar.
  }
}

/** Trägt eine andere Rechnung im HAUS bereits diese Nummer?
 *
 *  Warnung, keine Sperre. Ein Doppel kann gewollt sein (Korrektur, Storno,
 *  übernommener Vorgang) — die Software kennt die Buchhaltung des Hauses nicht
 *  gut genug, um das zu verbieten.
 *
 *  ── Warum das der Server beantwortet ──────────────────────────────────────
 *
 *  Die erste Fassung durchsuchte `invoices.value`, also nur die Rechnungen
 *  DIESES Projekts. Der Nummernraum ist aber hausweit: nach einer Korrektur
 *  der Projektnummer wird die freigewordene Nummer neu vergeben, und dann
 *  schlägt PATIO in zwei Projekten `…-R01` vor. Die projektlokale Warnung
 *  schwieg dazu — und § 11 UStG verlangt Einmaligkeit.
 *
 *  Die Antwort ist ein blankes Ja/Nein. Welches Projekt die Nummer trägt,
 *  bleibt ungenannt: es kann eines sein, das der Fragende nicht sehen darf. */
const nummerDoppelt = ref(false);

let nummerLauf = 0;
watch(
  () => draft.value?.nummer ?? "",
  async (roh) => {
    const lauf = ++nummerLauf;
    if (!roh.trim()) {
      nummerDoppelt.value = false;
      return;
    }
    try {
      const frage = new URLSearchParams({ nummer: roh.trim() });
      if (draft.value?.id) frage.set("ausserId", draft.value.id);
      const { vergeben } = await api.get<{ vergeben: boolean }>(
        `/projects/${encodeURIComponent(props.projectName)}/invoices/nummer-frei?${frage}`,
      );
      // Nur übernehmen, wenn seither nicht weitergetippt wurde — sonst zeigt
      // die Warnung das Ergebnis einer veralteten Anfrage.
      if (lauf === nummerLauf) nummerDoppelt.value = vergeben;
    } catch {
      // Eine nicht erreichbare Prüfung darf das Speichern nicht behindern.
      if (lauf === nummerLauf) nummerDoppelt.value = false;
    }
  },
);
function selectInvoice(inv: ProjectInvoice) {
  draft.value = {
    id: inv.id,
    nummer: inv.nummer ?? "",
    betrag: String(inv.betrag ?? ""),
    positionen: (inv.positionen ?? []).map((p) => ({ ...p })),
    datum: inv.datum ?? "",
    status: inv.status,
    phaseId: inv.phaseId,
    note: inv.note ?? "",
    // Der beim Laden mitgelieferte Zaehler geht beim Speichern zurueck —
    // sonst gaelte wieder „wer zuletzt speichert, gewinnt".
    rev: inv.rev,
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
  // Leere Zeilen fliegen raus — der Server wuerde sie sonst als Fehler
  // zurueckweisen, obwohl der Benutzer sie nur nicht ausgefuellt hat.
  const positionen = d.positionen
    .filter((p) => p.text.trim())
    .map((p) => ({
      text: p.text.trim(),
      menge: Number(p.menge) || 0,
      einheit: p.einheit?.trim() || null,
      einzelpreis: Number(p.einzelpreis) || 0,
      ustSatz: Number(p.ustSatz) || 0,
    }));
  const body = {
    nummer: d.nummer.trim() || null,
    // Zaehlt nur, solange es keine Positionen gibt — sonst leitet der Server
    // den Betrag aus ihnen ab.
    betrag: Number(d.betrag) || 0,
    positionen,
    datum: d.datum || null,
    status: d.status,
    phaseId: d.phaseId,
    note: d.note.trim() || null,
    ...(d.id ? { rev: d.rev } : {}),
  };
  try {
    if (d.id) await api.put(`/invoices/${d.id}`, body);
    else await api.post(`/projects/${encName.value}/invoices`, body);
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

// ── Rechnung ausgeben ────────────────────────────────────────────────────
//
// Die fünfte Export-Art. Sie fehlte ganz, obwohl alle Daten im System stehen:
// Positionen, Menge, Einzelpreis, Umsatzsteuersatz, Phase, Projektnummer. Für
// ein Büro, das Honorare abrechnet, ist eine Rechnung die einzige Datenart,
// die das Haus wirklich verlässt.
const pdfMoeglich = ref(false);

async function exportieren(alsPdf: boolean) {
  const inv = draft.value;
  if (!inv?.id) return;
  busy.value = true;
  try {
    const url = `/api/exports/invoice/${inv.id}` + (alsPdf ? "?format=pdf" : "");
    const fehler = await dateiHolen(url, `Rechnung ${inv.nummer ?? inv.id}.${alsPdf ? "pdf" : "docx"}`);
    if (fehler) error.value = fehler;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  void load();
  try {
    pdfMoeglich.value = (await api.get<{ pdf: boolean }>("/exports/faehigkeiten")).pdf;
  } catch {
    pdfMoeglich.value = false;
  }
});
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
        <button class="patio-btn solid sm" @click="newInvoice">
          <BIcon name="plus" :size="11" /><span style="margin-left: 4px">Teilrechnung</span>
        </button>
      </div>

      <div v-if="invoices.length === 0 && !draft" class="empty-state" style="margin-top: 8px">
        <div class="empty-state-icon"><BIcon name="archive" :size="26" /></div>
        <div class="empty-state-text">Noch keine Teilrechnungen für dieses Projekt.</div>
        <button class="patio-btn solid sm" @click="newInvoice">
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
            <button v-if="draft.id" class="patio-btn ghost sm" :disabled="busy" @click="exportieren(false)">
              <BIcon name="download" :size="11" /><span style="margin-left: 4px">Word</span>
            </button>
            <button
              v-if="draft.id && pdfMoeglich"
              class="patio-btn ghost sm"
              :disabled="busy"
              title="Dieselbe Vorlage, als PDF"
              @click="exportieren(true)"
            >
              <BIcon name="download" :size="11" /><span style="margin-left: 4px">PDF</span>
            </button>
            <button v-if="draft.id" class="patio-btn ghost sm" :disabled="busy" @click="remove">
              <BIcon name="trash" :size="11" /><span style="margin-left: 4px">Löschen</span>
            </button>
            <button v-else class="patio-btn ghost sm" :disabled="busy" @click="cancelEdit">Abbrechen</button>
          </div>

          <div class="ph-field-row">
            <div class="ph-field">
              <label class="ph-label">Nummer</label>
              <input v-model="draft.nummer" type="text" class="stamm-input" placeholder="z. B. SAZTG-2026-014-R01" />
              <!-- Warnung, keine Sperre: ein Doppel kann gewollt sein
                   (Korrektur, Storno, übernommener Vorgang). -->
              <p v-if="nummerDoppelt" class="inv-nr-warnung">Diese Nummer trägt bereits eine andere Rechnung.</p>
            </div>
            <div class="ph-field">
              <label class="ph-label">
                Betrag €
                <span v-if="draft.positionen.length" class="pos-hint">— ergibt sich aus den Positionen</span>
              </label>
              <input
                v-if="!draft.positionen.length"
                v-model="draft.betrag"
                type="number"
                min="0"
                step="0.01"
                class="stamm-input"
                placeholder="0"
              />
              <!-- Mit Positionen ist der Betrag abgeleitet und nicht mehr
                   eingebbar: sonst könnte die Rechnung eine andere Summe
                   behaupten als sie auflistet. -->
              <div v-else class="pos-summe">{{ money(positionsSumme) }}</div>
            </div>
          </div>

          <!-- Positionen (Migration 046) -->
          <div class="ph-field">
            <div class="pos-head">
              <label class="ph-label">Positionen</label>
              <div class="pos-head-actions">
                <select
                  v-if="katalog.length"
                  class="stamm-input pos-katalog"
                  @change="
                    (e) => {
                      const id = (e.target as HTMLSelectElement).value;
                      const k = katalog.find((x) => x.id === id);
                      if (k) positionHinzufuegen(k);
                      (e.target as HTMLSelectElement).value = '';
                    }
                  "
                >
                  <option value="">Aus Katalog übernehmen…</option>
                  <option v-for="k in katalog" :key="k.id" :value="k.id">
                    {{ k.text }} · {{ money(k.einzelpreis) }}{{ k.einheit ? " / " + k.einheit : "" }}
                  </option>
                </select>
                <button class="patio-btn ghost sm" @click="positionHinzufuegen()">
                  <BIcon name="plus" :size="11" /> Zeile
                </button>
              </div>
            </div>

            <div v-if="!draft.positionen.length" class="pos-leer">
              Ohne Positionen zählt der eingetragene Betrag. Sobald eine Zeile da ist, ergibt sich die Summe aus ihr.
            </div>

            <div v-for="(pos, i) in draft.positionen" :key="i" class="pos-row">
              <input v-model="pos.text" type="text" class="stamm-input pos-text" placeholder="Leistung" />
              <input v-model.number="pos.menge" type="number" min="0" step="0.01" class="stamm-input pos-num" />
              <input v-model="pos.einheit" type="text" class="stamm-input pos-einheit" placeholder="h" />
              <input v-model.number="pos.einzelpreis" type="number" min="0" step="0.01" class="stamm-input pos-num" />
              <input v-model.number="pos.ustSatz" type="number" min="0" max="100" class="stamm-input pos-num" />
              <span class="pos-zeilensumme">{{ money(pos.menge * pos.einzelpreis) }}</span>
              <button class="patio-btn ghost sm" @click="positionEntfernen(i)"><BIcon name="x" :size="11" /></button>
            </div>

            <div v-if="draft.positionen.length" class="pos-legende">
              Leistung · Menge · Einheit · Einzelpreis · USt % · Zeilensumme
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
            <button class="patio-btn solid sm" :disabled="busy" @click="save">
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
/* Wurzel des Rechnungsreiters. */
.inv-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.inv-nr-warnung {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--warn);
}

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

/* ── Positionen (Migration 046) ─────────────────────────────────────────── */
.pos-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.pos-head-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.pos-katalog {
  max-width: 260px;
  font-size: 11px;
}
.pos-hint {
  font-weight: 400;
  color: var(--color-text-tertiary);
  font-size: 10px;
}
.pos-summe {
  font-variant-numeric: tabular-nums;
  padding: 6px 0;
  font-size: 13px;
}
.pos-leer {
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.5;
  padding: 4px 0;
}
.pos-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
}
.pos-text {
  flex: 1;
  min-width: 0;
}
.pos-num {
  width: 78px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pos-einheit {
  width: 64px;
}
.pos-zeilensumme {
  width: 88px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}
.pos-legende {
  font-size: 10px;
  color: var(--color-text-tertiary);
  margin-top: 4px;
}
</style>
