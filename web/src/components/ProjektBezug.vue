<script setup lang="ts">
// ============================================================
// PATIO — Projektbezug anzeigen
// ============================================================
// Der eine Baustein, mit dem ein Projekt in der Oberfläche erscheint:
// Nummer und Name, immer in derselben Reihenfolge, immer gleich getrennt.
//
// Gemessen vor dem Einbau: an 82 Stellen stand der Projektname roh im
// Template. Hätte jede davon selbst entschieden, ob und wie die Nummer
// danebensteht, sähe PATIO nach drei Runden an zwanzig Stellen anders aus.
//
// ── Warum die Nummer vorne steht ────────────────────────────────────────────
//
// Wer eine Liste überfliegt, sucht die Akte. Eine Spalte, in der alle Einträge
// an derselben Stelle mit derselben Zeichenzahl beginnen, liest sich deutlich
// schneller als eine, in der der Projektname die Position bestimmt.
//
// ── Warum der Platzhalter nicht erscheint ───────────────────────────────────
//
// Migration 052 hat Bestandsprojekten ohne Nummer ein `OHNE-NUMMER-<id>`
// eingetragen, damit die Spalte Pflicht werden konnte. Stünde das ungefiltert
// hier, hätte das Büro plötzlich Aktennummern, die niemand vergeben hat.
// `anzeigeNummer()` filtert sie heraus; mit `hinweis` wird daraus eine
// sichtbare Aufforderung statt einer stillen Lücke.
// ============================================================

import { computed } from "vue";
import { anzeigeNummer } from "../utils/projektnummer";

const props = withDefaults(
  defineProps<{
    /** Projektname. Fehlt er, steht nur die Nummer da. */
    name?: string | null;
    /** Projektnummer (Migration 052). */
    nummer?: string | null;
    /** Fehlt die Nummer: „ohne Nummer" anzeigen statt nichts.
     *  Sinnvoll dort, wo man sie nachtragen kann — nicht in engen Listen. */
    hinweis?: boolean;
    /** Nur die Nummer zeigen, ohne den Namen. Für Spalten, die den Namen
     *  bereits daneben führen. */
    nurNummer?: boolean;
  }>(),
  { name: null, nummer: null, hinweis: false, nurNummer: false },
);

const nr = computed(() => anzeigeNummer(props.nummer));
</script>

<template>
  <span class="pb">
    <span v-if="nr" class="pb-nr">{{ nr }}</span>
    <span v-else-if="hinweis" class="pb-fehlt">ohne Nummer</span>
    <span v-if="!nurNummer && name" class="pb-name">{{ name }}</span>
  </span>
</template>

<style scoped>
.pb {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

/* Tabellenziffern: die Nummern stehen in Listen untereinander, und
   proportionale Ziffern lassen dieselbe Stelle jedes Mal woanders sitzen. */
.pb-nr {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-size: 0.92em;
  letter-spacing: 0.01em;
  color: var(--fg-muted);
  white-space: nowrap;
}

/* Fehlt die Nummer, ist das keine Formatierungslücke, sondern eine offene
   Aufgabe — deshalb die Warnfarbe und nicht das übliche Grau. */
.pb-fehlt {
  flex: none;
  font-size: 0.92em;
  color: var(--warn);
  white-space: nowrap;
}

.pb-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Das Trennzeichen sitzt im Layout, nicht im Text — so lässt es sich an einer
   Stelle ändern und taucht beim Kopieren nicht mit auf. */
.pb-nr + .pb-name::before,
.pb-fehlt + .pb-name::before {
  content: "·";
  margin-right: var(--space-2);
  color: var(--fg-subtle);
}
</style>
