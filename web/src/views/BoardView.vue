<script setup lang="ts">
// ============================================================
// PATIO — Board für den Besprechungsraum
// ============================================================
// Vier Ansichten für einen Bildschirm an der Wand: Heute, Aufgaben, Projekte,
// Woche. Optional wechseln sie von selbst durch.
//
// ── Warum das ein Neubau ist und kein Umbau ────────────────────────────────
//
// Die vorhandenen Ansichten sind auf Maus und Detailtiefe gebaut — der
// Kalender misst 1477 Zeilen, die Projektübersicht 1004. Auf fünf Meter
// Entfernung ist davon nichts lesbar, und jedes Bedienelement darin ist an
// einem Gerät ohne Maus totes Gewicht.
//
// Deshalb: große Schrift, keine Bedienung außer dem Umschalten, keine
// Beträge, keine Kontaktdaten. Was das Board nicht zeigen darf, filtert der
// Server (siehe `src/api/personendaten.ts` und `src/api/geld.ts`) — hier steht
// nur, was es zeigen SOLL.
// ============================================================

import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { formatDate, formatWeekdayShort } from "../utils/format";

type Ansicht = "heute" | "aufgaben" | "projekte" | "woche";
const ANSICHTEN: Ansicht[] = ["heute", "aufgaben", "projekte", "woche"];
const TITEL: Record<Ansicht, string> = {
  heute: "Heute",
  aufgaben: "Offene Aufgaben",
  projekte: "Projekte",
  woche: "Diese Woche",
};

interface Termin {
  text: string;
  uhrzeit: string | null;
  endzeit?: string | null;
  ort?: string | null;
  projekt: string | null;
  projektnummer?: string | null;
}
interface Bautag {
  projekt: string;
  projektnummer: string | null;
  taetigkeiten: string | null;
}
interface Aufgabe {
  text: string;
  faellig: string | null;
  rang: number;
  zugewiesen: string | null;
  projekt: string | null;
  projektnummer: string | null;
}
interface Projekt {
  name: string;
  projektnummer: string | null;
  status: string | null;
  phase: string | null;
  standort: string | null;
  offeneAufgaben: number;
}

const route = useRoute();
const ansicht = ref<Ansicht>("heute");
const heute = ref<{ datum: string; termine: Termin[]; bautagebuch: Bautag[] } | null>(null);
const aufgaben = ref<Aufgabe[]>([]);
const projekte = ref<Projekt[]>([]);
const woche = ref<{ von: string; tage: { datum: string; termine: Termin[] }[] } | null>(null);
const fehler = ref<string | null>(null);
const uhrzeit = ref("");

/** Wechselt selbsttätig durch die Ansichten — `?rotieren=20` (Sekunden).
 *  Ohne den Parameter bleibt das Board stehen, was für einen Bildschirm
 *  neben dem Besprechungstisch das Richtige ist: dort will man lesen, nicht
 *  hinterherschauen. */
const rotieren = computed(() => {
  const v = Number(route.query.rotieren);
  return Number.isFinite(v) && v >= 5 ? v : 0;
});

async function laden() {
  fehler.value = null;
  try {
    const [h, a, p, w] = await Promise.all([
      api.get<typeof heute.value>("/board/heute"),
      api.get<Aufgabe[]>("/board/aufgaben"),
      api.get<Projekt[]>("/board/projekte"),
      api.get<typeof woche.value>("/board/woche"),
    ]);
    heute.value = h;
    aufgaben.value = a;
    projekte.value = p;
    woche.value = w;
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Die Daten sind nicht erreichbar.";
  }
}

function tick() {
  uhrzeit.value = new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

let ladeTimer: ReturnType<typeof setInterval> | undefined;
let uhrTimer: ReturnType<typeof setInterval> | undefined;
let wechselTimer: ReturnType<typeof setInterval> | undefined;

const wochentag = (iso: string) => formatWeekdayShort(new Date(iso + "T00:00:00"));

onMounted(() => {
  tick();
  void laden();
  // Ein Board läuft tagelang. Es holt sich die Daten selbst — der Live-Kanal
  // wäre hier der falsche Weg: an einem Gerät, das nachts durchläuft, ist eine
  // offene Verbindung, die niemand wieder aufbaut, eine Fehlerquelle mehr.
  ladeTimer = setInterval(() => void laden(), 120_000);
  uhrTimer = setInterval(tick, 20_000);
  if (rotieren.value > 0) {
    wechselTimer = setInterval(() => {
      const i = ANSICHTEN.indexOf(ansicht.value);
      ansicht.value = ANSICHTEN[(i + 1) % ANSICHTEN.length];
    }, rotieren.value * 1000);
  }
});

onUnmounted(() => {
  if (ladeTimer) clearInterval(ladeTimer);
  if (uhrTimer) clearInterval(uhrTimer);
  if (wechselTimer) clearInterval(wechselTimer);
});
</script>

<template>
  <div class="bd">
    <header class="bd-kopf">
      <div class="bd-titel">{{ TITEL[ansicht] }}</div>
      <nav class="bd-tabs">
        <button
          v-for="a in ANSICHTEN"
          :key="a"
          :class="['bd-tab', ansicht === a ? 'bd-tab-aktiv' : '']"
          @click="ansicht = a"
        >
          {{ TITEL[a] }}
        </button>
      </nav>
      <div class="bd-uhr">{{ uhrzeit }}</div>
    </header>

    <div v-if="fehler" class="bd-fehler">{{ fehler }}</div>

    <!-- Heute -->
    <section v-else-if="ansicht === 'heute'" class="bd-inhalt">
      <div v-if="!heute?.termine.length && !heute?.bautagebuch.length" class="bd-leer">
        Für heute ist nichts eingetragen.
      </div>
      <template v-else>
        <div v-if="heute?.termine.length" class="bd-block">
          <h2 class="bd-h2">Termine</h2>
          <div v-for="(t, i) in heute.termine" :key="i" class="bd-zeile">
            <span class="bd-zeit">{{ t.uhrzeit ?? "ganztägig" }}</span>
            <span class="bd-haupt">{{ t.text }}</span>
            <span class="bd-neben">{{ [t.projekt, t.ort].filter(Boolean).join(" · ") }}</span>
          </div>
        </div>
        <div v-if="heute?.bautagebuch.length" class="bd-block">
          <h2 class="bd-h2">Auf den Baustellen</h2>
          <div v-for="(b, i) in heute.bautagebuch" :key="i" class="bd-zeile">
            <span class="bd-haupt">{{ b.projekt }}</span>
            <span class="bd-neben">{{ b.taetigkeiten }}</span>
          </div>
        </div>
      </template>
    </section>

    <!-- Aufgaben -->
    <section v-else-if="ansicht === 'aufgaben'" class="bd-inhalt">
      <div v-if="!aufgaben.length" class="bd-leer">Keine offenen Aufgaben.</div>
      <div v-for="(a, i) in aufgaben" :key="i" class="bd-zeile">
        <span class="bd-rang" :class="'bd-rang-' + a.rang">{{ a.rang }}</span>
        <span class="bd-haupt">{{ a.text }}</span>
        <span class="bd-neben">
          {{ [a.zugewiesen, a.projekt, a.faellig ? "bis " + formatDate(a.faellig) : null].filter(Boolean).join(" · ") }}
        </span>
      </div>
    </section>

    <!-- Projekte -->
    <section v-else-if="ansicht === 'projekte'" class="bd-inhalt">
      <div v-if="!projekte.length" class="bd-leer">Keine Projekte.</div>
      <div v-for="p in projekte" :key="p.name" class="bd-zeile">
        <span class="bd-haupt">{{ p.name }}</span>
        <span class="bd-neben">{{ [p.phase, p.standort, p.status].filter(Boolean).join(" · ") }}</span>
        <span class="bd-zahl">{{ p.offeneAufgaben }}</span>
      </div>
    </section>

    <!-- Woche -->
    <section v-else class="bd-inhalt bd-woche">
      <div v-if="!woche?.tage.length" class="bd-leer">Diese Woche ist nichts eingetragen.</div>
      <div v-for="t in woche?.tage ?? []" :key="t.datum" class="bd-tag">
        <div class="bd-tag-kopf">{{ wochentag(t.datum) }} {{ formatDate(t.datum) }}</div>
        <div v-for="(e, i) in t.termine" :key="i" class="bd-tag-zeile">
          <span class="bd-zeit">{{ e.uhrzeit ?? "—" }}</span>
          <span>{{ e.text }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Alles bewusst groß: gelesen wird aus mehreren Metern Entfernung. */
.bd {
  min-height: 100vh;
  padding: 28px 40px;
  background: var(--color-bg);
  color: var(--color-text);
  display: flex;
  flex-direction: column;
}
.bd-kopf {
  display: flex;
  align-items: baseline;
  gap: 24px;
  padding-bottom: 18px;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 22px;
}
.bd-titel {
  font-size: 34px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.bd-tabs {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.bd-tab {
  font-size: 15px;
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.bd-tab-aktiv {
  background: var(--color-text);
  color: var(--color-bg);
  border-color: var(--color-text);
}
.bd-uhr {
  font-size: 34px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.bd-inhalt {
  flex: 1;
  overflow: hidden;
}
.bd-h2 {
  font-size: 15px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  margin: 0 0 8px;
}
.bd-block {
  margin-bottom: 26px;
}
.bd-zeile {
  display: flex;
  align-items: baseline;
  gap: 18px;
  padding: 10px 0;
  border-top: 1px solid var(--color-border-subtle);
  font-size: 21px;
}
.bd-zeile:first-of-type {
  border-top: none;
}
.bd-zeit {
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  min-width: 5.5ch;
}
.bd-haupt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bd-neben {
  font-size: 15px;
  color: var(--color-text-tertiary);
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bd-zahl {
  font-size: 19px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  min-width: 3ch;
  text-align: right;
}
.bd-rang {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 15px;
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.bd-rang-1 {
  background: var(--color-text);
  color: var(--color-bg);
  border-color: var(--color-text);
}
.bd-leer {
  font-size: 22px;
  color: var(--color-text-tertiary);
  padding: 40px 0;
}
.bd-fehler {
  font-size: 20px;
  color: #dc2626;
  padding: 30px 0;
}
.bd-woche {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 18px;
  align-content: start;
}
.bd-tag-kopf {
  font-size: 15px;
  font-weight: 600;
  padding-bottom: 6px;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 8px;
}
.bd-tag-zeile {
  display: flex;
  gap: 10px;
  font-size: 16px;
  padding: 4px 0;
  color: var(--color-text);
}
</style>
