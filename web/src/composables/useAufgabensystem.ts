// ============================================================
// PATIO — Aufgabensystem im Frontend
// ============================================================
// Ein Zustand fuer alle vier Ansichten des Aufgabenreiters. Der Grund ist
// derselbe wie bei `useBranding`: die Zaehler am Umschalter stehen in JEDER
// Ansicht, und wenn jede sie selbst laedt, sind es vier Abfragen fuer
// dieselbe Zahl — und nach dem ersten Haken vier verschiedene Zahlen.
//
// Zwei Abfragen decken alles ab, was der Umschalter braucht:
//
//   /aufgabensystem/matrix     → Rang-1-Zaehler UND (ueber die Summe der
//                                Spalten ohne Schaetzung) der Eingang
//   /aufgabensystem/tagesplan  → Budget und die Aufgaben von heute
//
// Die Aufgabenliste selbst (`/tasks`) laedt die jeweilige Ansicht, weil
// immer nur eine sichtbar ist.
// ============================================================

import { ref, computed } from "vue";
import { api } from "../api";

export interface Aufgabe {
  id: string;
  rev?: number;
  text: string;
  status: "open" | "in_progress" | "done";
  project: string | null;
  date: string | null;
  assigneeName?: string | null;
  rang: 1 | 2 | 3 | 4;
  aufwandMin: number | null;
  imTagesplan: boolean;
  updatedAt: string;
}

export interface MatrixSpalte {
  rang: 1 | 2 | 3 | 4;
  anzahl: number;
  summeMin: number;
  ohneSchaetzung: number;
  ueberGrenze?: boolean;
}

export interface Grenzen {
  maxRang1: number;
  tagesbudgetMin: number;
  maxRang3Min: number;
}

export interface Tagesbudget {
  belegtMin: number;
  budgetMin: number;
  auslastung: number;
  rang3Min: number;
  rang3UeberGrenze: boolean;
  hatRang2: boolean;
  ohneSchaetzung: number;
}

/** Die vier Raenge als Text — an einer Stelle, damit „Sofort" nicht in der
 *  einen Ansicht anders heisst als in der anderen. */
export const RANG_TEXT: Record<1 | 2 | 3 | 4, { kurz: string; lang: string; regel: string }> = {
  1: { kurz: "Sofort", lang: "Dringend und wichtig", regel: "höchstens 5 offen" },
  2: { kurz: "Terminieren", lang: "Wichtig, nicht dringend", regel: "mindestens eine pro Tag" },
  3: { kurz: "Sammeln", lang: "Dringend, nicht wichtig", regel: "höchstens 60 min pro Tag" },
  4: { kurz: "Streichen", lang: "Weder noch", regel: "verfällt nach 30 Tagen" },
};

/** Die Stufen für den geschätzten Aufwand. Muss zur CHECK-Bedingung der
 *  Migration 050 passen — ein Wert daneben käme als 400 zurück. */
export const AUFWAND_STUFEN = [15, 30, 60, 120, 180, 240] as const;

/** Minuten als „1 h 30" — im Balken und in den Spaltensummen steht sonst
 *  „285 min", und das rechnet niemand im Kopf gegen fünf Stunden. */
export function alsStunden(min: number): string {
  if (min <= 0) return "0";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m}`;
}

// ── Geteilter Zustand (Modulebene, nicht pro Komponente) ────────────────────
const matrix = ref<{ spalten: MatrixSpalte[]; grenzen: Grenzen } | null>(null);
const tagesbudget = ref<Tagesbudget | null>(null);
const tagesplanAufgaben = ref<Aufgabe[]>([]);
const fehler = ref<string | null>(null);
let laufend: Promise<void> | null = null;

async function holeZaehler(): Promise<void> {
  const [m, t] = await Promise.all([
    api.get<{ spalten: MatrixSpalte[]; grenzen: Grenzen }>("/aufgabensystem/matrix"),
    api.get<{ tagesbudget: Tagesbudget; aufgaben: Aufgabe[] }>("/aufgabensystem/tagesplan"),
  ]);
  matrix.value = m;
  tagesbudget.value = t.tagesbudget;
  tagesplanAufgaben.value = t.aufgaben;
}

export function useAufgabensystem() {
  /** Laedt Matrix und Tagesplan. Parallele Aufrufer teilen sich denselben
   *  Lauf — beim Ansichtswechsel feuern sonst zwei gleichzeitig. */
  async function ladeZaehler(): Promise<void> {
    if (laufend) return laufend;
    laufend = (async () => {
      try {
        await holeZaehler();
        fehler.value = null;
      } catch (e) {
        fehler.value = e instanceof Error ? e.message : "Aufgabensystem nicht erreichbar";
      } finally {
        laufend = null;
      }
    })();
    return laufend;
  }

  /** Der Eingang: offene Aufgaben ohne geschaetzten Aufwand.
   *
   *  Warum das die Definition ist: `aufwand_min IS NULL` heisst laut
   *  Migration 050 genau das — noch nicht eingeschaetzt, also noch nicht
   *  durchgesehen. Ein eigenes Kennzeichen „im Eingang" waere ein zweiter
   *  Zustand fuer dieselbe Aussage, und der eine wuerde irgendwann nicht
   *  mitgepflegt. */
  const eingangAnzahl = computed(() =>
    matrix.value ? matrix.value.spalten.reduce((s, sp) => s + sp.ohneSchaetzung, 0) : 0,
  );

  const rang1Anzahl = computed(() => matrix.value?.spalten.find((s) => s.rang === 1)?.anzahl ?? 0);
  const tagesplanAnzahl = computed(() => tagesplanAufgaben.value.length);

  return {
    matrix,
    tagesbudget,
    tagesplanAufgaben,
    fehler,
    ladeZaehler,
    eingangAnzahl,
    rang1Anzahl,
    tagesplanAnzahl,
  };
}
