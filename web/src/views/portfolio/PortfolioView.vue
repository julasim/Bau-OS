<script setup lang="ts">
import { formatEUR } from "../../utils/format";
// ============================================================
// PATIO — Portfolio-Cockpit (Leitungssicht)
// ============================================================
// Projektuebergreifende Uebersicht aus GET /portfolio: je Projekt
// Ampel, honorargewichteter Fortschritt, fakturiert vs. Budget,
// naechste Frist, offene High-Prio. Sortiert nach Handlungsbedarf
// (rot zuerst). DB-only — im FS-Modus erscheint ein Hinweis.
// ============================================================
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../../api";
import BIcon from "../../components/BIcon.vue";

type Health = "red" | "amber" | "green";

interface PortfolioEntry {
  projectId: string;
  name: string;
  projektnummer: string | null;
  status: string | null;
  currentPhase: string | null;
  progress: number;
  budget: number | null;
  invoiced: number;
  nextDeadline: string | null;
  nextDeadlineLabel: string | null;
  openHighPrio: number;
  health: Health;
}

const router = useRouter();
const rows = ref<PortfolioEntry[]>([]);
const loaded = ref(false);
const dbOnly = ref(false);
const error = ref<string | null>(null);

const HEALTH_ORDER: Record<Health, number> = { red: 0, amber: 1, green: 2 };
const HEALTH_LABEL: Record<Health, string> = { red: "Handlungsbedarf", amber: "Beobachten", green: "Im Plan" };

const sorted = computed(() => [...rows.value].sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]));
const counts = computed(() => ({
  red: rows.value.filter((r) => r.health === "red").length,
  amber: rows.value.filter((r) => r.health === "amber").length,
  green: rows.value.filter((r) => r.health === "green").length,
}));

function money(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return formatEUR(n);
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function deadlineText(r: PortfolioEntry): string {
  if (!r.nextDeadline) return "—";
  const d = daysUntil(r.nextDeadline);
  const rel = d === null ? "" : d < 0 ? ` (${-d} T überfällig)` : d === 0 ? " (heute)" : ` (in ${d} T)`;
  return `${r.nextDeadline}${rel}`;
}

function open(r: PortfolioEntry) {
  router.push(`/projects/${encodeURIComponent(r.name)}`);
}

async function load() {
  try {
    rows.value = await api.get<PortfolioEntry[]>("/portfolio");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("503") || msg.toLowerCase().includes("db-modus")) dbOnly.value = true;
    else error.value = msg;
  } finally {
    loaded.value = true;
  }
}

onMounted(load);
</script>

<template>
  <div class="pf-wrap">
    <header class="pf-head">
      <h1 class="pf-title">Portfolio</h1>
      <p class="pf-sub">Projektübergreifende Leitungssicht — sortiert nach Handlungsbedarf.</p>
      <div class="pf-kpis">
        <div class="pf-kpi">
          <span class="pf-kpi-val">{{ rows.length }}</span>
          <span class="pf-kpi-lbl">Projekte</span>
        </div>
        <div class="pf-kpi">
          <span class="pf-kpi-val pf-red">{{ counts.red }}</span>
          <span class="pf-kpi-lbl">Handlungsbedarf</span>
        </div>
        <div class="pf-kpi">
          <span class="pf-kpi-val pf-amber">{{ counts.amber }}</span>
          <span class="pf-kpi-lbl">Beobachten</span>
        </div>
        <div class="pf-kpi">
          <span class="pf-kpi-val pf-green">{{ counts.green }}</span>
          <span class="pf-kpi-lbl">Im Plan</span>
        </div>
      </div>
    </header>

    <div v-if="!loaded" class="pf-hint">Lade Portfolio…</div>
    <div v-else-if="dbOnly" class="pf-hint">Das Portfolio-Cockpit ist nur im Datenbank-Modus verfügbar.</div>
    <div v-else-if="error" class="pf-error">{{ error }}</div>
    <div v-else-if="rows.length === 0" class="pf-hint">Keine sichtbaren Projekte.</div>

    <table v-else class="pf-table">
      <thead>
        <tr>
          <th>Status</th>
          <th>Projekt</th>
          <th>Phase</th>
          <th class="pf-col-prog">Fortschritt</th>
          <th class="pf-col-num">Honorar (fakt. / Budget)</th>
          <th>Nächste Frist</th>
          <th class="pf-col-num">High-Prio</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.projectId" class="pf-row" @click="open(r)">
          <td>
            <span class="pf-health" :class="'h-' + r.health" :title="HEALTH_LABEL[r.health]">
              <span class="pf-dot"></span>{{ HEALTH_LABEL[r.health] }}
            </span>
          </td>
          <td>
            <div class="pf-name">{{ r.name }}</div>
            <div v-if="r.projektnummer" class="pf-num">{{ r.projektnummer }}</div>
          </td>
          <td>{{ r.currentPhase ?? "—" }}</td>
          <td class="pf-col-prog">
            <div class="pf-prog">
              <div class="pf-prog-track"><i :style="{ width: r.progress + '%' }"></i></div>
              <span class="pf-prog-val">{{ r.progress }}%</span>
            </div>
          </td>
          <td class="pf-col-num">{{ money(r.invoiced) }} <span class="pf-sep">/</span> {{ money(r.budget) }}</td>
          <td
            :class="{ 'pf-overdue': daysUntil(r.nextDeadline) !== null && (daysUntil(r.nextDeadline) as number) < 0 }"
          >
            {{ deadlineText(r) }}
            <span v-if="r.nextDeadlineLabel" class="pf-dl-lbl">{{ r.nextDeadlineLabel }}</span>
          </td>
          <td class="pf-col-num">
            <span :class="{ 'pf-hp': r.openHighPrio > 0 }">{{ r.openHighPrio }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.pf-wrap {
  padding: 24px 28px 64px;
  max-width: 1200px;
  margin: 0 auto;
}
.pf-head {
  margin-bottom: 20px;
}
.pf-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
  color: var(--color-text);
}
.pf-sub {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 14px;
}
.pf-kpis {
  display: flex;
  gap: 1px;
  margin-top: 18px;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  width: fit-content;
}
.pf-kpi {
  background: var(--color-bg);
  padding: 12px 22px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pf-kpi-val {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text);
}
.pf-kpi-lbl {
  font-size: 12px;
  color: var(--color-text-muted);
}
.pf-red {
  color: var(--color-danger-text);
}
.pf-amber {
  color: var(--color-warning-text);
}
.pf-green {
  color: var(--color-success-text);
}
.pf-hint,
.pf-error {
  padding: 28px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
  border: 1px dashed var(--color-border);
  border-radius: 12px;
}
.pf-error {
  color: var(--color-danger-text);
  border-style: solid;
  border-color: var(--color-danger-border);
  background: var(--color-danger-bg);
}
.pf-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
}
.pf-table th {
  text-align: left;
  padding: 10px 14px;
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  font-weight: 600;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border);
}
.pf-col-num {
  text-align: right;
}
.pf-col-prog {
  width: 180px;
}
.pf-row {
  cursor: pointer;
  transition: background 0.1s;
}
.pf-row:hover {
  background: var(--color-bg-subtle);
}
.pf-row td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
  color: var(--color-text-secondary);
  vertical-align: middle;
}
.pf-name {
  font-weight: 600;
  color: var(--color-text);
}
.pf-num {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.pf-health {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.pf-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.h-red {
  color: var(--color-danger-text);
}
.h-red .pf-dot {
  background: var(--color-danger, #b3261e);
}
.h-amber {
  color: var(--color-warning-text);
}
.h-amber .pf-dot {
  background: var(--color-warning, #9a6a12);
}
.h-green {
  color: var(--color-success-text);
}
.h-green .pf-dot {
  background: var(--color-success, #2f7d4f);
}
.pf-prog {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pf-prog-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: var(--color-bg-muted);
  overflow: hidden;
}
.pf-prog-track i {
  display: block;
  height: 100%;
  background: var(--color-accent);
  border-radius: 999px;
}
.pf-prog-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pf-col-num {
  font-variant-numeric: tabular-nums;
}
.pf-sep {
  color: var(--color-text-faint);
}
.pf-overdue {
  color: var(--color-danger-text);
  font-weight: 600;
}
.pf-dl-lbl {
  display: block;
  font-size: 11px;
  color: var(--color-text-tertiary);
}
.pf-hp {
  display: inline-block;
  min-width: 20px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--color-warning-bg);
  color: var(--color-warning-text);
  font-weight: 600;
  font-size: 12px;
}
</style>
