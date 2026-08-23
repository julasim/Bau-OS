<script setup lang="ts">
// ============================================================
// PATIO — Umschalter im Aufgabenreiter
// ============================================================
// Vier Arbeitsweisen auf denselben Daten, nicht vier Bereiche:
//
//   Eingang   erfassen, ohne zu denken
//   Matrix    ordnen (der Blick am Morgen)
//   Mein Tag  auswaehlen, mit Budget
//   Liste     die gewohnte Aufgabenliste mit Detailspalte
//
// Bewusst KEIN eigener Eintrag in der Navigationsleiste: es ist ein und
// dieselbe Sache — Aufgaben. Vier Rail-Eintraege haetten aus einem Reiter
// vier Orte gemacht, an denen man die Aufgabe von gestern sucht.
//
// Der Umschalter steht in allen vier Ansichten an derselben Stelle ganz
// oben. Die Zaehler stehen bewusst am Streifen und nicht erst in der
// Ansicht: „Eingang 12" ist die Aufforderung, ihn zu leeren, und man muss
// dafuer nicht hineingesehen haben.
// ============================================================

import { useRouter, useRoute } from "vue-router";

defineProps<{
  /** Anzahl unsortierter Aufgaben — steht am Eingang, wenn > 0. */
  eingang?: number | null;
  /** Anzahl Aufgaben in Rang 1 — steht an der Matrix, wenn > 0. */
  rang1?: number | null;
  /** Anzahl Aufgaben im Tagesplan — steht an „Mein Tag", wenn > 0. */
  tagesplan?: number | null;
}>();

const router = useRouter();
const route = useRoute();

const MODI = [
  { name: "tasks-eingang", label: "Eingang", zaehler: "eingang" },
  { name: "tasks-matrix", label: "Matrix", zaehler: "rang1" },
  { name: "tasks-heute", label: "Mein Tag", zaehler: "tagesplan" },
  { name: "tasks", label: "Liste", zaehler: null },
] as const;

function aktiv(name: string): boolean {
  return route.name === name;
}
</script>

<template>
  <nav class="au-umschalter" aria-label="Ansicht im Aufgabenreiter">
    <div class="pt-segment">
      <button
        v-for="m in MODI"
        :key="m.name"
        type="button"
        :class="{ 'is-active': aktiv(m.name) }"
        :aria-current="aktiv(m.name) ? 'page' : undefined"
        @click="router.push({ name: m.name })"
      >
        {{ m.label }}
        <span
          v-if="m.zaehler === 'eingang' && eingang"
          class="au-zaehler"
          :class="{ 'au-zaehler--warn': eingang > 0 }"
          >{{ eingang }}</span
        >
        <span v-else-if="m.zaehler === 'rang1' && rang1" class="au-zaehler">{{ rang1 }}</span>
        <span v-else-if="m.zaehler === 'tagesplan' && tagesplan" class="au-zaehler">{{ tagesplan }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.au-umschalter {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.au-zaehler {
  display: inline-grid;
  place-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--surface-muted);
  color: var(--fg-muted);
  font-size: var(--fs-11);
  font-variant-numeric: tabular-nums;
}

.pt-segment button.is-active .au-zaehler {
  background: var(--fill);
  color: var(--fg-body);
}

/* Der Eingang faellt auf, solange etwas drin liegt — er soll abends leer
   sein, und ein grauer Zaehler erinnert daran nicht. */
.au-zaehler--warn {
  background: var(--warn-bg);
  color: var(--warn);
}
</style>
