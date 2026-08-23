<script setup lang="ts">
// ============================================================
// PATIO — Eingang
// ============================================================
// „Ein Feld, Enter, naechster Titel, nichts weiter." Die Spezifikation ist
// an dieser Stelle ungewoehnlich streng, und aus einem Grund: jede
// Zusatzabfrage beim Erfassen — Projekt, Rang, Termin — kostet eine
// Entscheidung im falschen Moment. Wer beim Erfassen schon einordnen muss,
// erfasst irgendwann nicht mehr, sondern merkt sich Dinge wieder im Kopf.
//
// Eingeordnet wird deshalb HIER, aber getrennt: unten steht, was noch nicht
// durchgesehen ist, und jede Zeile bekommt Rang und Aufwand in zwei Klicks.
// Sobald ein Aufwand daran steht, verschwindet die Zeile aus dem Eingang.
//
// „Muss abends leer sein" ist die einzige Regel des Eingangs. Deshalb steht
// die Zahl gross oben und nicht klein daneben.
// ============================================================

import { ref, computed, onMounted, nextTick, useTemplateRef } from "vue";
import { api } from "../../api";
import { useEvents } from "../../composables/useEvents";
import ProjektBezug from "../../components/ProjektBezug.vue";
import {
  useAufgabensystem,
  alsStunden,
  AUFWAND_STUFEN,
  RANG_TEXT,
  type Aufgabe,
} from "../../composables/useAufgabensystem";

const { ladeZaehler } = useAufgabensystem();

const alle = ref<Aufgabe[]>([]);
const neu = ref("");
const speichert = ref(false);
const fehler = ref<string | null>(null);
const geladen = ref(false);
const feld = useTemplateRef<HTMLInputElement>("feld");

const RAENGE = [1, 2, 3, 4] as const;

/** Wie viele Zeilen der Eingang hoechstens zeichnet — Begruendung wie in
 *  `MatrixView.vue`: der Altbestand traegt keine Schaetzung und liegt damit
 *  vollstaendig im Eingang (im Pruefdurchlauf 1123 Zeilen a zehn
 *  Schaltflaechen). Die Zahl darueber zaehlt weiter alles. */
const MAX_ZEILEN = 40;

/** Was im Eingang liegt: offen und ohne geschaetzten Aufwand.
 *  Neueste zuerst — was gerade erfasst wurde, steht oben. */
const eingang = computed(() =>
  alle.value
    .filter((a) => a.status !== "done" && a.aufwandMin === null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
);

const gezeigt = computed(() => eingang.value.slice(0, MAX_ZEILEN));
const nichtGezeigt = computed(() => Math.max(0, eingang.value.length - MAX_ZEILEN));

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

async function erfassen() {
  const text = neu.value.trim();
  if (!text || speichert.value) return;
  speichert.value = true;
  // Feld sofort leeren: der naechste Titel darf nicht auf die Antwort des
  // Servers warten. Bei einem Fehler kommt der Text zurueck ins Feld.
  neu.value = "";
  try {
    const angelegt = await api.post<Aufgabe>("/tasks", { text });
    alle.value = [angelegt, ...alle.value];
    fehler.value = null;
    await ladeZaehler();
  } catch (e) {
    neu.value = text;
    fehler.value = e instanceof Error ? e.message : "Konnte nicht gespeichert werden";
  } finally {
    speichert.value = false;
    await nextTick();
    feld.value?.focus();
  }
}

/** Rang oder Aufwand setzen. Beides geht ueber dieselbe Route; sobald ein
 *  Aufwand steht, faellt die Zeile aus dem Eingang. */
async function einordnen(a: Aufgabe, felder: { rang?: 1 | 2 | 3 | 4; aufwandMin?: number }) {
  try {
    const aktualisiert = await api.put<Aufgabe>(`/tasks/${a.id}`, { ...felder, rev: a.rev });
    alle.value = alle.value.map((x) => (x.id === a.id ? aktualisiert : x));
    fehler.value = null;
    await ladeZaehler();
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : "Konnte nicht gespeichert werden";
    // Bei einem Konflikt hat jemand anderes gespeichert — neu laden, sonst
    // scheitert auch der naechste Versuch mit demselben veralteten Zaehler.
    await laden();
  }
}

onMounted(async () => {
  await Promise.all([laden(), ladeZaehler()]);
  feld.value?.focus();
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
      <h1 class="au-titel">Eingang</h1>
      <p class="au-lead">
        Alles hier hinein, ohne einzuordnen. Eingeordnet wird darunter — beim Erfassen kostet jede Rückfrage eine
        Entscheidung im falschen Moment.
      </p>
    </header>

    <form class="au-erfassen" @submit.prevent="erfassen">
      <input
        ref="feld"
        v-model="neu"
        class="pt-input au-erfassen-feld"
        type="text"
        placeholder="Was ist zu tun?"
        autocomplete="off"
        :disabled="speichert"
      />
      <button class="pt-btn pt-btn--primary" type="submit" :disabled="!neu.trim() || speichert">Erfassen</button>
    </form>

    <p v-if="fehler" class="au-fehler">{{ fehler }}</p>

    <section>
      <div class="au-block-kopf">
        <h2 class="au-block-titel">Nicht durchgesehen</h2>
        <span class="au-block-zahl" :class="{ 'au-block-zahl--leer': eingang.length === 0 }">{{ eingang.length }}</span>
      </div>
      <p class="au-block-regel">
        Muss abends leer sein. Eine Zeile verlässt den Eingang, sobald ein Aufwand daran steht.
      </p>

      <p v-if="!geladen" class="au-hinweis">Lade…</p>
      <p v-else-if="eingang.length === 0" class="au-hinweis au-hinweis--gut">
        Der Eingang ist leer. Genau so soll er am Abend aussehen.
      </p>

      <ul v-else class="au-liste">
        <li v-for="a in gezeigt" :key="a.id" class="au-zeile">
          <div class="au-zeile-kopf">
            <span class="au-zeile-text">{{ a.text }}</span>
            <ProjektBezug v-if="a.project" class="au-zeile-projekt" :name="a.project" :nummer="a.projektnummer" />
          </div>

          <div class="au-zeile-steuerung">
            <div class="au-gruppe">
              <span class="au-gruppe-label">Rang</span>
              <div class="pt-segment">
                <button
                  v-for="r in RAENGE"
                  :key="r"
                  type="button"
                  :class="{ 'is-active': a.rang === r }"
                  :title="RANG_TEXT[r].lang + ' — ' + RANG_TEXT[r].regel"
                  @click="einordnen(a, { rang: r })"
                >
                  {{ r }} {{ RANG_TEXT[r].kurz }}
                </button>
              </div>
            </div>

            <div class="au-gruppe">
              <span class="au-gruppe-label">Aufwand</span>
              <div class="pt-segment">
                <button v-for="m in AUFWAND_STUFEN" :key="m" type="button" @click="einordnen(a, { aufwandMin: m })">
                  {{ alsStunden(m) }}
                </button>
              </div>
            </div>
          </div>
        </li>
      </ul>

      <p v-if="nichtGezeigt" class="au-rest">
        … und {{ nichtGezeigt }} weitere. Die Zahl oben zählt alle — hier stehen die {{ MAX_ZEILEN }} zuletzt
        geänderten. Der Rest verschwindet, sobald er einen Aufwand bekommt.
      </p>
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
  max-width: 62ch;
  font-size: var(--fs-13);
  line-height: 1.6;
  color: var(--fg-muted);
}

.au-erfassen {
  display: flex;
  gap: var(--space-2);
}
.au-erfassen-feld {
  flex: 1;
  height: 44px;
  font-size: var(--fs-15);
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

.au-block-kopf {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
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
  color: var(--warn);
}
.au-block-zahl--leer {
  color: var(--ok);
}
.au-block-regel {
  margin: var(--space-1) 0 var(--space-4);
  font-size: var(--fs-12);
  color: var(--fg-subtle);
}

.au-rest {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-11);
  line-height: 1.5;
  color: var(--fg-subtle);
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
.au-hinweis--gut {
  border-style: solid;
  border-color: var(--ok);
  background: var(--ok-bg);
  color: var(--ok);
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
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.au-zeile-kopf {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
}
.au-zeile-text {
  font-size: var(--fs-14);
  color: var(--fg-body);
}
.au-zeile-projekt {
  flex: none;
  font-size: var(--fs-11);
  color: var(--fg-subtle);
}

.au-zeile-steuerung {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
}
.au-gruppe {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.au-gruppe-label {
  font-size: var(--fs-10);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-subtle);
}

@media (max-width: 720px) {
  .au-seite {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
  .au-zeile-steuerung {
    gap: var(--space-3);
  }
}
</style>
