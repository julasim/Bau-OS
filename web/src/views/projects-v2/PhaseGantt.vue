<script setup lang="ts">
import { formatMonthShort } from "../../utils/format";
// ── Phasen-Gantt / Zeitleiste ────────────────────────────────────────────
// Stellt die Leistungsphasen auf einer Zeitachse dar: Soll-Balken (Umriss)
// und Ist-Balken (gefuellt), Meilenstein-Raute am Soll-Ende, sowie
// Vorgaenger-Pfeile (depends_on) als SVG-Overlay. Reine Anzeige.
import { computed } from "vue";

interface GanttPhase {
  id: string;
  name: string;
  status: "offen" | "aktiv" | "fertig";
  progress: number;
  sollStart: string | null;
  sollEnde: string | null;
  istStart: string | null;
  istEnde: string | null;
  dependsOnPhaseId: string | null;
}

const props = defineProps<{ phases: GanttPhase[] }>();

const ROW_H = 38;

function toDay(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso + "T00:00:00").getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 86400000);
}

// Zeitfenster ueber alle Phasen (Soll + Ist).
const range = computed(() => {
  const days: number[] = [];
  for (const p of props.phases) {
    for (const d of [p.sollStart, p.sollEnde, p.istStart, p.istEnde]) {
      const v = toDay(d);
      if (v !== null) days.push(v);
    }
  }
  if (days.length === 0) return null;
  let min = Math.min(...days);
  let max = Math.max(...days);
  if (max === min) max = min + 1; // Div-0 vermeiden
  // etwas Rand
  const pad = Math.max(1, Math.round((max - min) * 0.04));
  return { min: min - pad, max: max + pad };
});

function pct(iso: string | null): number | null {
  const d = toDay(iso);
  const r = range.value;
  if (d === null || !r) return null;
  return ((d - r.min) / (r.max - r.min)) * 100;
}

interface Bar {
  phase: GanttPhase;
  index: number;
  soll: { left: number; width: number } | null;
  ist: { left: number; width: number } | null;
  milestone: number | null; // pct des Soll-Endes
  midY: number;
}

const bars = computed<Bar[]>(() =>
  props.phases.map((p, index) => {
    const ss = pct(p.sollStart);
    const se = pct(p.sollEnde);
    const is = pct(p.istStart);
    const ie = pct(p.istEnde);
    const span = (a: number | null, b: number | null) => {
      if (a === null && b === null) return null;
      const left = a ?? b!;
      const right = b ?? a!;
      return { left: Math.min(left, right), width: Math.max(1.2, Math.abs(right - left)) };
    };
    return {
      phase: p,
      index,
      soll: span(ss, se),
      ist: span(is, ie),
      milestone: se,
      midY: index * ROW_H + ROW_H / 2,
    };
  }),
);

const totalH = computed(() => props.phases.length * ROW_H);

// Vorgaenger-Pfeile: vom Ende des Vorgaengers (Soll-Ende, sonst -Start) zum
// Start des Nachfolgers (Soll-Start, sonst -Ende).
interface Arrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const arrows = computed<Arrow[]>(() => {
  const byId = new Map(bars.value.map((b) => [b.phase.id, b]));
  const out: Arrow[] = [];
  for (const b of bars.value) {
    const depId = b.phase.dependsOnPhaseId;
    if (!depId) continue;
    const pred = byId.get(depId);
    if (!pred) continue;
    const x1 =
      pred.soll?.left != null ? pred.soll.left + pred.soll.width : pred.ist ? pred.ist.left + pred.ist.width : null;
    const x2 = b.soll?.left ?? b.ist?.left ?? null;
    if (x1 === null || x2 === null) continue;
    out.push({ x1, y1: pred.midY, x2, y2: b.midY });
  }
  return out;
});

// Monats-Gitter (grobe Achse).
const ticks = computed(() => {
  const r = range.value;
  if (!r) return [];
  const out: { left: number; label: string }[] = [];
  const start = new Date(r.min * 86400000);
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  let guard = 0;
  while (d.getTime() / 86400000 <= r.max && guard < 120) {
    const day = Math.floor(d.getTime() / 86400000);
    if (day >= r.min) {
      out.push({
        left: ((day - r.min) / (r.max - r.min)) * 100,
        label: formatMonthShort(d),
      });
    }
    d.setUTCMonth(d.getUTCMonth() + 1);
    guard++;
  }
  return out;
});
</script>

<template>
  <div v-if="!range" class="gantt-empty">Keine Termine an den Phasen — bitte Soll-/Ist-Daten pflegen.</div>
  <div v-else class="gantt">
    <div class="gantt-labels">
      <div class="gantt-corner"></div>
      <div v-for="b in bars" :key="b.phase.id" class="gantt-label" :title="b.phase.name">
        <span class="gantt-dot" :class="'st-' + b.phase.status"></span>{{ b.phase.name }}
      </div>
    </div>

    <div class="gantt-chart">
      <!-- Achse -->
      <div class="gantt-axis">
        <span v-for="(t, i) in ticks" :key="i" class="gantt-tick" :style="{ left: t.left + '%' }">{{ t.label }}</span>
      </div>

      <!-- Zeilen mit Balken -->
      <div class="gantt-rows" :style="{ height: totalH + 'px' }">
        <div v-for="t in ticks" :key="'g' + t.left" class="gantt-grid" :style="{ left: t.left + '%' }"></div>

        <div v-for="b in bars" :key="b.phase.id" class="gantt-row" :style="{ height: ROW_H + 'px' }">
          <div
            v-if="b.soll"
            class="gantt-bar gantt-soll"
            :style="{ left: b.soll.left + '%', width: b.soll.width + '%' }"
          ></div>
          <div
            v-if="b.ist"
            class="gantt-bar gantt-ist"
            :class="'st-' + b.phase.status"
            :style="{ left: b.ist.left + '%', width: b.ist.width + '%' }"
            :title="`Ist · ${b.phase.progress}%`"
          ></div>
          <div
            v-if="b.milestone !== null"
            class="gantt-ms"
            :style="{ left: b.milestone + '%' }"
            title="Meilenstein (Soll-Ende)"
          ></div>
        </div>

        <!-- Vorgaenger-Pfeile -->
        <svg class="gantt-arrows" :viewBox="`0 0 100 ${totalH}`" preserveAspectRatio="none">
          <path
            v-for="(a, i) in arrows"
            :key="i"
            :d="`M ${a.x1} ${a.y1} L ${a.x1 + 1.5} ${a.y1} L ${a.x2 - 1.5} ${a.y2} L ${a.x2} ${a.y2}`"
            fill="none"
            class="gantt-arrow"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gantt-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-faint);
  font-size: 13px;
  border: 1px dashed var(--color-border);
  border-radius: 10px;
}
.gantt {
  display: grid;
  grid-template-columns: 180px 1fr;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
}
.gantt-labels {
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-subtle);
}
.gantt-corner {
  height: 24px;
  border-bottom: 1px solid var(--color-border);
}
.gantt-label {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  font-size: 12.5px;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gantt-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.gantt-dot.st-offen {
  background: var(--color-text-faint);
}
.gantt-dot.st-aktiv {
  background: var(--color-primary, #1d4ed8);
}
.gantt-dot.st-fertig {
  background: var(--color-success, #2f7d4f);
}
.gantt-chart {
  position: relative;
  overflow: hidden;
}
.gantt-axis {
  position: relative;
  height: 24px;
  border-bottom: 1px solid var(--color-border);
}
.gantt-tick {
  position: absolute;
  top: 5px;
  transform: translateX(2px);
  font-size: 10px;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.gantt-rows {
  position: relative;
}
.gantt-grid {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-border-subtle);
}
.gantt-row {
  position: relative;
  border-bottom: 1px solid var(--color-border-subtle);
}
.gantt-bar {
  position: absolute;
  height: 9px;
  border-radius: 4px;
}
.gantt-soll {
  top: 8px;
  border: 1px solid var(--color-text-faint);
  background: transparent;
}
.gantt-ist {
  top: 20px;
  background: var(--color-accent);
}
.gantt-ist.st-fertig {
  background: var(--color-success, #2f7d4f);
}
.gantt-ist.st-aktiv {
  background: var(--color-primary, #1d4ed8);
}
.gantt-ms {
  position: absolute;
  top: 11px;
  width: 11px;
  height: 11px;
  background: var(--color-warning, #9a6a12);
  transform: translateX(-50%) rotate(45deg);
  border-radius: 2px;
}
.gantt-arrows {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}
.gantt-arrow {
  stroke: var(--color-text-tertiary, #9a9aa0);
  stroke-width: 1.5;
  stroke-dasharray: 3 2;
}
</style>
