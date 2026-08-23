<script setup lang="ts">
// ============================================================
// PATIO — Matrix
// ============================================================
// Vier Spalten nach Rang, ueber ALLE sichtbaren Projekte. Bewusst nicht je
// Projekt: die Grenzen gelten fuer den Tag, nicht fuer die Baustelle. Wer
// den Tag aus drei Projektansichten fuellt, fuellt ihn dreimal.
//
// ── Der Zaehler ueber Rang 1 ────────────────────────────────────────────────
//
// Er ist das wichtigste Element des ganzen Systems. Wenn dort dauerhaft mehr
// als fuenf steht, ist nicht die Grenze falsch, sondern die Einordnung: es
// ist dann nicht mehr alles dringend UND wichtig, sondern „Rang 1" ist zum
// Normalfall geworden — und damit bedeutungslos. Deshalb steht die Zahl
// gross, mit der Grenze daneben, und faerbt sich beim Ueberschreiten.
//
// ── Warum nichts gesperrt wird ──────────────────────────────────────────────
//
// Die sechste Aufgabe in Rang 1 laesst sich anlegen. Eine harte Sperre wird
// nach der zweiten Umgehung zur Gewohnheit, und dann ist das System
// entwertet. Sichtbar machen wirkt laenger als verbieten.
// ============================================================

import { ref, computed, onMounted } from "vue";
import { api } from "../../api";
import { useEvents } from "../../composables/useEvents";
import { useAufgabensystem, alsStunden, RANG_TEXT, type Aufgabe } from "../../composables/useAufgabensystem";

const { matrix, ladeZaehler } = useAufgabensystem();

const alle = ref<Aufgabe[]>([]);
const geladen = ref(false);
const fehler = ref<string | null>(null);

const RAENGE = [1, 2, 3, 4] as const;

/** Wie viele Karten eine Spalte hoechstens zeichnet.
 *
 *  Gemessen an der echten Datenlage: Rang 3 ist der Standard, also liegt dort
 *  der gesamte Altbestand — im Pruefdurchlauf 1125 Aufgaben. Ungebremst waren
 *  das 12.391 DOM-Knoten und 5.679 Schaltflaechen in EINER Spalte, und jede
 *  Rangaenderung rechnet die Liste neu.
 *
 *  Gekuerzt wird nur die Darstellung, nicht die Aussage: die Zahl oben kommt
 *  aus der Aggregation des Servers und zaehlt weiter alles, und unter der
 *  Spalte steht, wie viele nicht gezeichnet sind. Eine stille Kuerzung waere
 *  schlimmer als eine lange Liste — sie saehe aus wie „mehr ist da nicht". */
const MAX_KARTEN = 40;

/** Die Aufgaben je Spalte. Innerhalb einer Spalte: was schon fuer heute
 *  ausgewaehlt ist zuerst, dann nach Aufwand — die kleinen Brocken unten,
 *  damit die Spalte nicht mit Fuellmaterial anfaengt. */
const spalten = computed(() =>
  RAENGE.map((rang) => {
    const zahlen = matrix.value?.spalten.find((s) => s.rang === rang);
    const aufgaben = alle.value
      .filter((a) => a.status !== "done" && a.rang === rang)
      .sort((a, b) => {
        if (a.imTagesplan !== b.imTagesplan) return a.imTagesplan ? -1 : 1;
        return (b.aufwandMin ?? 0) - (a.aufwandMin ?? 0);
      });
    return {
      rang,
      text: RANG_TEXT[rang],
      aufgaben: aufgaben.slice(0, MAX_KARTEN),
      nichtGezeigt: Math.max(0, aufgaben.length - MAX_KARTEN),
      hatAufgaben: aufgaben.length > 0,
      anzahl: zahlen?.anzahl ?? aufgaben.length,
      summeMin: zahlen?.summeMin ?? 0,
      ohneSchaetzung: zahlen?.ohneSchaetzung ?? 0,
      ueberGrenze: zahlen?.ueberGrenze === true,
    };
  }),
);

const maxRang1 = computed(() => matrix.value?.grenzen.maxRang1 ?? 5);

async function laden() {
  try {
    alle.value = await api.get<Aufgabe[]>("/tasks");
    fehler.value = null;
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Aufgaben nicht erreichbar";
  } finally {
    geladen.value = true;
  }
}

async function setzeRang(a: Aufgabe, rang: 1 | 2 | 3 | 4) {
  if (a.rang === rang) return;
  try {
    const aktualisiert = await api.put<Aufgabe>(`/tasks/${a.id}`, { rang, rev: a.rev });
    alle.value = alle.value.map((x) => (x.id === a.id ? aktualisiert : x));
    fehler.value = null;
    await ladeZaehler();
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Konnte nicht gespeichert werden";
    await laden();
  }
}

async function inDenTag(a: Aufgabe, drin: boolean) {
  try {
    await api.put(`/aufgabensystem/tagesplan/${a.id}`, { drin });
    alle.value = alle.value.map((x) => (x.id === a.id ? { ...x, imTagesplan: drin } : x));
    fehler.value = null;
    await ladeZaehler();
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Konnte nicht übernommen werden";
    await laden();
  }
}

onMounted(async () => {
  await Promise.all([laden(), ladeZaehler()]);
});

useEvents(["task"], () => {
  void laden();
  void ladeZaehler();
});
</script>

<template>
  <div class="au-seite">
    <header>
      <div class="au-eyebrow">Aufgaben</div>
      <h1 class="au-titel">Matrix</h1>
      <p class="au-lead">
        Alle offenen Aufgaben nach Rang, über sämtliche Projekte. Der Rang beantwortet zwei Fragen zugleich —
        <strong>dringend</strong> und <strong>wichtig</strong>. Was weder noch ist, steht rechts und darf dort
        verfallen.
      </p>
    </header>

    <p v-if="fehler" class="au-fehler">{{ fehler }}</p>

    <div class="au-matrix">
      <section v-for="s in spalten" :key="s.rang" class="au-spalte" :class="{ 'au-spalte--voll': s.ueberGrenze }">
        <header class="au-spalte-kopf">
          <div class="au-spalte-titel">
            <span class="au-spalte-nr">{{ s.rang }}</span>
            <span>{{ s.text.kurz }}</span>
          </div>
          <p class="au-spalte-lang">{{ s.text.lang }}</p>

          <div class="au-spalte-zahl">
            <span class="au-zahl" :class="{ 'au-zahl--warn': s.ueberGrenze }">{{ s.anzahl }}</span>
            <span v-if="s.rang === 1" class="au-zahl-grenze">von {{ maxRang1 }}</span>
          </div>

          <p class="au-spalte-meta">
            {{ alsStunden(s.summeMin) }}
            <span v-if="s.ohneSchaetzung"> · {{ s.ohneSchaetzung }} ohne Schätzung</span>
          </p>
          <p class="au-spalte-regel">{{ s.text.regel }}</p>
        </header>

        <p v-if="s.rang === 1 && s.ueberGrenze" class="au-warnung">
          Mehr als {{ maxRang1 }} in Rang 1. Nichts ist gesperrt — aber wenn das dauerhaft so bleibt, ist nicht die
          Grenze zu eng, sondern der Rang zum Normalfall geworden.
        </p>

        <p v-if="!geladen" class="au-hinweis">Lade…</p>
        <p v-else-if="!s.hatAufgaben" class="au-hinweis">Leer.</p>

        <ul v-else class="au-liste">
          <li v-for="a in s.aufgaben" :key="a.id" class="au-karte" :class="{ 'au-karte--geplant': a.imTagesplan }">
            <div class="au-karte-text">{{ a.text }}</div>
            <div class="au-karte-meta">
              <span v-if="a.project" class="au-karte-projekt">{{ a.project }}</span>
              <span v-if="a.aufwandMin" class="au-karte-aufwand">{{ alsStunden(a.aufwandMin) }}</span>
              <span v-else class="au-karte-offen">ohne Schätzung</span>
            </div>

            <div class="au-karte-aktionen">
              <div class="au-verschieben">
                <button
                  v-for="r in RAENGE"
                  :key="r"
                  type="button"
                  class="au-rangbtn"
                  :class="{ 'is-active': a.rang === r }"
                  :disabled="a.rang === r"
                  :title="'Nach Rang ' + r + ' — ' + RANG_TEXT[r].kurz"
                  @click="setzeRang(a, r)"
                >
                  {{ r }}
                </button>
              </div>
              <button
                type="button"
                class="pt-btn pt-btn--sm"
                :class="a.imTagesplan ? 'pt-btn--secondary' : 'pt-btn--ghost'"
                @click="inDenTag(a, !a.imTagesplan)"
              >
                {{ a.imTagesplan ? "Im Tag" : "Für heute" }}
              </button>
            </div>
          </li>
        </ul>

        <p v-if="s.nichtGezeigt" class="au-rest">
          … und {{ s.nichtGezeigt }} weitere. Die Zahl oben zählt alle — hier stehen die {{ MAX_KARTEN }} obersten,
          damit die Spalte bedienbar bleibt.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.au-seite {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-8) var(--space-12);
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
  max-width: 72ch;
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

.au-matrix {
  display: grid;
  grid-template-columns: repeat(4, minmax(210px, 1fr));
  gap: var(--space-4);
  align-items: start;
}

.au-spalte {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-subtle);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}
.au-spalte--voll {
  border-color: var(--warn);
}

.au-spalte-kopf {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.au-spalte-titel {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.au-spalte-nr {
  display: inline-grid;
  place-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  background: var(--fg);
  color: var(--fg-inverse);
  font-size: var(--fs-11);
}
.au-spalte-lang {
  margin: 0;
  font-size: var(--fs-11);
  color: var(--fg-subtle);
}

.au-spalte-zahl {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.au-zahl {
  font-size: var(--fs-32);
  font-weight: var(--fw-medium);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--fg);
}
.au-zahl--warn {
  color: var(--warn);
}
.au-zahl-grenze {
  font-size: var(--fs-12);
  color: var(--fg-subtle);
}

.au-spalte-meta {
  margin: 0;
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}
.au-spalte-regel {
  margin: 0;
  font-size: var(--fs-11);
  color: var(--fg-subtle);
}

.au-warnung {
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--warn);
  border-radius: var(--radius-sm);
  background: var(--warn-bg);
  color: var(--warn);
  font-size: var(--fs-11);
  line-height: 1.5;
}

.au-rest {
  margin: 0;
  padding: var(--space-2) var(--space-1) 0;
  font-size: var(--fs-11);
  line-height: 1.5;
  color: var(--fg-subtle);
}

.au-hinweis {
  margin: 0;
  padding: var(--space-4);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  text-align: center;
  font-size: var(--fs-12);
  color: var(--fg-subtle);
}

.au-liste {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.au-karte {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.au-karte--geplant {
  border-color: var(--fg);
}
.au-karte-text {
  font-size: var(--fs-13);
  line-height: 1.45;
  color: var(--fg-body);
  overflow-wrap: anywhere;
}
.au-karte-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--fs-11);
  color: var(--fg-subtle);
}
.au-karte-aufwand {
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}
.au-karte-offen {
  color: var(--warn);
}

.au-karte-aktionen {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.au-verschieben {
  display: inline-flex;
  gap: 2px;
}
.au-rangbtn {
  appearance: none;
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg-muted);
  font-family: var(--font-sans);
  font-size: var(--fs-11);
  cursor: pointer;
}
.au-rangbtn:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--fg);
}
.au-rangbtn.is-active {
  background: var(--fg);
  border-color: var(--fg);
  color: var(--fg-inverse);
  cursor: default;
}

@media (max-width: 1100px) {
  .au-matrix {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .au-seite {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
  .au-matrix {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
