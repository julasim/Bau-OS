<script setup lang="ts">
// ============================================================
// PATIO — Mein Tag
// ============================================================
// Die Auswahl fuer heute, plus der Budgetbalken: wie viel von fuenf
// Fokusstunden belegt ist, aufgeteilt nach Rang.
//
// ── Warum fuenf Stunden und nicht acht ──────────────────────────────────────
//
// Weil ein Arbeitstag keine acht Stunden Aufgabenzeit hat. Besprechungen,
// Telefonate, Rueckfragen und der Weg dazwischen sind kein Ausfall, sondern
// der Beruf. Ein Plan gegen acht Stunden geht jeden Tag nicht auf, und ein
// Plan, der jeden Tag nicht aufgeht, wird nach zwei Wochen nicht mehr
// gemacht.
//
// ── Der Balken zeigt auch, was ueber der Grenze liegt ───────────────────────
//
// Bei Ueberbuchung waechst die Skala mit, statt bei 100 % abzuschneiden. Ein
// Balken, der voll ist, sieht wie „passt genau" aus; einer, der ueber die
// Marke hinauslaeuft, sieht aus wie das, was er ist.
//
// ── Der Tag beginnt leer ────────────────────────────────────────────────────
//
// Um Mitternacht raeumt `src/maintenance.ts` die Auswahl fuer alle ab. Kein
// Uebertrag, keine Rueckstandsliste — Nichterledigtes faellt in sein Projekt
// zurueck und gilt ausdruecklich nicht als Rueckstand.
// ============================================================

import { ref, computed, onMounted } from "vue";
import { api } from "../../api";
import { useEvents } from "../../composables/useEvents";
import { useAufgabensystem, alsStunden, RANG_TEXT, type Aufgabe } from "../../composables/useAufgabensystem";

const { tagesbudget, tagesplanAufgaben, ladeZaehler } = useAufgabensystem();

const geladen = ref(false);
const fehler = ref<string | null>(null);

const RAENGE = [1, 2, 3, 4] as const;

/** Die Skala des Balkens: normalerweise das Budget, bei Ueberbuchung die
 *  belegte Zeit. So bleibt die Budget-Marke sichtbar, statt dass der Balken
 *  bei 100 % anschlaegt und die Ueberbuchung verschluckt. */
const skalaMin = computed(() => {
  const b = tagesbudget.value;
  if (!b) return 300;
  return Math.max(b.budgetMin, b.belegtMin);
});

/** Ein Abschnitt je Rang, proportional zur Skala. Nur Raenge mit Zeit —
 *  sonst stuenden vier Legendeneintraege fuer einen einzigen Balken. */
const abschnitte = computed(() =>
  RAENGE.map((rang) => {
    const min = tagesplanAufgaben.value.filter((a) => a.rang === rang).reduce((s, a) => s + (a.aufwandMin ?? 0), 0);
    return { rang, min, anteil: (min / skalaMin.value) * 100 };
  }).filter((s) => s.min > 0),
);

/** Wo die Budget-Marke steht. Bei Ueberbuchung wandert sie nach links —
 *  alles rechts davon ist die Ueberbuchung. */
const budgetMarke = computed(() => {
  const b = tagesbudget.value;
  if (!b) return 100;
  return (b.budgetMin / skalaMin.value) * 100;
});

const ueberbucht = computed(() => {
  const b = tagesbudget.value;
  return !!b && b.belegtMin > b.budgetMin;
});

async function laden() {
  try {
    await ladeZaehler();
    fehler.value = null;
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Tagesplan nicht erreichbar";
  } finally {
    geladen.value = true;
  }
}

async function heraus(a: Aufgabe) {
  try {
    await api.put(`/aufgabensystem/tagesplan/${a.id}`, { drin: false });
    fehler.value = null;
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Konnte nicht entfernt werden";
  }
  await laden();
}

async function erledigt(a: Aufgabe) {
  try {
    await api.put(`/tasks/${a.id}`, { status: "done", rev: a.rev });
    fehler.value = null;
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Konnte nicht abgehakt werden";
  }
  await laden();
}

onMounted(laden);
useEvents(["task"], () => void laden());
</script>

<template>
  <div class="au-seite">
    <header>
      <div class="au-eyebrow">Aufgaben</div>
      <h1 class="au-titel">Mein Tag</h1>
      <p class="au-lead">
        Was du dir für heute vorgenommen hast, gemessen an fünf Fokusstunden. Um Mitternacht wird die Auswahl geleert —
        was offen bleibt, fällt in sein Projekt zurück und ist <strong>kein Rückstand</strong>.
      </p>
    </header>

    <p v-if="fehler" class="au-fehler">{{ fehler }}</p>

    <section v-if="tagesbudget" class="au-budget">
      <div class="au-budget-kopf">
        <div>
          <span class="au-budget-zahl" :class="{ 'au-budget-zahl--warn': ueberbucht }">
            {{ alsStunden(tagesbudget.belegtMin) }}
          </span>
          <span class="au-budget-von">von {{ alsStunden(tagesbudget.budgetMin) }}</span>
        </div>
        <span class="au-budget-prozent" :class="{ 'au-budget-zahl--warn': ueberbucht }"
          >{{ tagesbudget.auslastung }} %</span
        >
      </div>

      <!-- Die Budget-Marke haengt in der HUELLE, nicht im Balken: der Balken
           beschneidet seinen Inhalt (`overflow: hidden`), damit die Abschnitte
           die runden Ecken nicht ueberzeichnen — und schnitt damit genau die
           zwei Pixel weg, mit denen die Marke oben und unten herausragen soll. -->
      <div class="au-balken-huelle">
        <div
          class="au-balken"
          role="img"
          :aria-label="`${tagesbudget.belegtMin} von ${tagesbudget.budgetMin} Minuten belegt`"
        >
          <div
            v-for="s in abschnitte"
            :key="s.rang"
            class="au-balken-teil"
            :class="`au-balken-teil--r${s.rang}`"
            :style="{ width: s.anteil + '%' }"
            :title="`Rang ${s.rang} — ${alsStunden(s.min)}`"
          ></div>
        </div>
        <div
          v-if="ueberbucht"
          class="au-balken-marke"
          :style="{ left: budgetMarke + '%' }"
          :title="`Budgetgrenze — ${alsStunden(tagesbudget.budgetMin)}`"
        ></div>
      </div>

      <div class="au-legende">
        <span v-for="s in abschnitte" :key="s.rang" class="au-legende-eintrag">
          <span class="au-legende-farbe" :class="`au-balken-teil--r${s.rang}`"></span>
          {{ s.rang }} {{ RANG_TEXT[s.rang].kurz }} · {{ alsStunden(s.min) }}
        </span>
        <span v-if="!abschnitte.length" class="au-legende-leer">Noch nichts ausgewählt.</span>
      </div>

      <ul class="au-befunde">
        <li v-if="ueberbucht" class="au-befund au-befund--warn">
          {{ alsStunden(tagesbudget.belegtMin - tagesbudget.budgetMin) }} über dem Budget. Nichts ist gesperrt — aber
          etwas davon wird heute nicht fertig, und die Entscheidung, was, triffst du besser jetzt als um 17 Uhr.
        </li>
        <li v-if="tagesbudget.rang3UeberGrenze" class="au-befund au-befund--warn">
          {{ alsStunden(tagesbudget.rang3Min) }} auf Rang 3 („Sammeln"). Empfohlen sind höchstens
          {{ alsStunden(60) }} pro Tag — Dringendes ohne Wichtigkeit frisst sonst den Tag.
        </li>
        <li v-if="!tagesbudget.hatRang2 && tagesplanAufgaben.length > 0" class="au-befund">
          Keine Aufgabe aus Rang 2 dabei. Ohne mindestens eine wird nur noch Dringendes abgearbeitet — und das Wichtige
          rutscht so lange, bis es dringend ist.
        </li>
        <li v-if="tagesbudget.ohneSchaetzung" class="au-befund">
          {{ tagesbudget.ohneSchaetzung }} Aufgabe(n) ohne Schätzung. Der Balken zeigt sie mit null Minuten — er ist
          damit eine Untergrenze, nicht die Wahrheit.
        </li>
      </ul>
    </section>

    <section>
      <div class="au-block-kopf">
        <h2 class="au-block-titel">Für heute ausgewählt</h2>
        <span class="au-block-zahl">{{ tagesplanAufgaben.length }}</span>
      </div>

      <p v-if="!geladen" class="au-hinweis">Lade…</p>
      <p v-else-if="tagesplanAufgaben.length === 0" class="au-hinweis">
        Noch nichts ausgewählt. In der <strong>Matrix</strong> stehen die offenen Aufgaben nach Rang — von dort mit „Für
        heute" übernehmen.
      </p>

      <ul v-else class="au-liste">
        <li v-for="a in tagesplanAufgaben" :key="a.id" class="au-zeile">
          <span class="au-zeile-rang" :class="`au-balken-teil--r${a.rang}`">{{ a.rang }}</span>
          <div class="au-zeile-mitte">
            <div class="au-zeile-text">{{ a.text }}</div>
            <div class="au-zeile-meta">
              <span v-if="a.project">{{ a.project }}</span>
              <span v-if="a.aufwandMin" class="au-zeile-aufwand">{{ alsStunden(a.aufwandMin) }}</span>
              <span v-else class="au-zeile-offen">ohne Schätzung</span>
            </div>
          </div>
          <div class="au-zeile-aktionen">
            <button type="button" class="pt-btn pt-btn--sm pt-btn--ghost" @click="heraus(a)">Heraus</button>
            <button type="button" class="pt-btn pt-btn--sm pt-btn--secondary" @click="erledigt(a)">Erledigt</button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.au-seite {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-8) var(--space-12);
  max-width: 940px;
}

.au-eyebrow {
  font-size: var(--fs-10);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-subtle);
}
.au-titel {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-34);
  font-weight: var(--fw-medium);
  color: var(--fg);
  letter-spacing: -0.02em;
}
.au-lead {
  margin: var(--space-3) 0 0;
  max-width: 68ch;
  font-size: var(--fs-13);
  line-height: 1.6;
  color: var(--fg-muted);
}

.au-fehler {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: var(--fs-13);
}

/* ── Budgetbalken ───────────────────────────────────────────────────────── */
.au-budget {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.au-budget-kopf {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}
.au-budget-zahl {
  font-size: var(--fs-28);
  font-weight: var(--fw-medium);
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}
.au-budget-zahl--warn {
  color: var(--warn);
}
.au-budget-von {
  margin-left: var(--space-2);
  font-size: var(--fs-13);
  color: var(--fg-subtle);
}
.au-budget-prozent {
  font-size: var(--fs-15);
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}

.au-balken-huelle {
  position: relative;
  /* Platz fuer die zwei Pixel, mit denen die Marke oben und unten aus dem
     Balken herausragt — sonst schoebe sie die Legende darunter an. */
  padding: 3px 0;
}

.au-balken {
  display: flex;
  height: 16px;
  border-radius: var(--radius-sm);
  background: var(--fill);
  overflow: hidden;
}
.au-balken-teil {
  height: 100%;
  min-width: 2px;
}
/* Vier Abstufungen statt vier Farben — das System ist monochrom, und der
   Rang ist eine Rangfolge, keine Kategorie. */
.au-balken-teil--r1 {
  background: var(--fg);
}
.au-balken-teil--r2 {
  background: #4a4a4a;
}
.au-balken-teil--r3 {
  background: #8c8c8c;
}
.au-balken-teil--r4 {
  background: #c4c4c4;
}

.au-balken-marke {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--warn);
}

.au-legende {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  font-size: var(--fs-11);
  color: var(--fg-muted);
}
.au-legende-eintrag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-variant-numeric: tabular-nums;
}
.au-legende-farbe {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.au-legende-leer {
  font-size: var(--fs-11);
  color: var(--fg-subtle);
}

.au-befunde {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-befund {
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  font-size: var(--fs-12);
  line-height: 1.5;
  color: var(--fg-muted);
}
.au-befund--warn {
  border-color: var(--warn);
  background: var(--warn-bg);
  color: var(--warn);
}

/* ── Liste ──────────────────────────────────────────────────────────────── */
.au-block-kopf {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.au-block-titel {
  margin: 0;
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.au-block-zahl {
  font-size: var(--fs-20);
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}

.au-hinweis {
  margin: 0;
  padding: var(--space-6);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  text-align: center;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.au-liste {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-zeile {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  padding: var(--space-3) var(--space-4);
}
.au-zeile-rang {
  flex: none;
  display: inline-grid;
  place-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  color: var(--fg-inverse);
  font-size: var(--fs-11);
}
.au-balken-teil--r4.au-zeile-rang,
.au-balken-teil--r3.au-zeile-rang {
  color: var(--fg);
}
.au-zeile-mitte {
  flex: 1;
  min-width: 0;
}
.au-zeile-text {
  font-size: var(--fs-14);
  color: var(--fg-body);
  overflow-wrap: anywhere;
}
.au-zeile-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: 2px;
  font-size: var(--fs-11);
  color: var(--fg-subtle);
}
.au-zeile-aufwand {
  font-variant-numeric: tabular-nums;
}
.au-zeile-offen {
  color: var(--warn);
}
.au-zeile-aktionen {
  flex: none;
  display: flex;
  gap: var(--space-2);
}

@media (max-width: 720px) {
  .au-seite {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
  .au-zeile {
    flex-wrap: wrap;
  }
}
</style>
