// ============================================================
// PATIO — Benachrichtigungen im Frontend
// ============================================================
// Modul-Zustand, keine Instanz je Aufruf: der Zähler an der Glocke und die
// Liste in der Ansicht sind DIESELBE Zahl. Zwei Kopien liefen sonst
// auseinander, sobald jemand eine Meldung liest.
//
// `useEvents` war lange das Gegenbeispiel: dort legte JEDER Aufruf eine eigene
// `EventSource` an, auf einer Seite liefen dadurch drei Verbindungen für
// dieselben Ereignisse. Seit dem 01.09.2026 macht es dasselbe wie hier — eine
// geteilte Verbindung, Modul-Zustand, Auf- und Abbau per Referenzzähler.
// Festgehalten in `tests/web/use-events.test.ts`.
// ============================================================

import { ref } from "vue";
import { api } from "../api";

export interface Meldung {
  id: string;
  anlass: string;
  titel: string;
  ausloeser: string | null;
  zielTyp: string | null;
  zielId: string | null;
  projectId: string | null;
  projectName: string | null;
  erstelltAm: string;
  gelesenAm: string | null;
}

const meldungen = ref<Meldung[]>([]);
const ungelesen = ref(0);
let laeuft: Promise<void> | null = null;

/** Zähler holen. Mehrfachaufrufe teilen sich denselben laufenden Aufruf —
 *  beim Seitenwechsel fragen sonst Glocke und Liste gleichzeitig. */
export async function ladeAnzahl(): Promise<void> {
  if (laeuft) return laeuft;
  laeuft = (async () => {
    try {
      ungelesen.value = (await api.get<{ ungelesen: number }>("/benachrichtigungen/anzahl")).ungelesen;
    } catch {
      // Kein Zähler ist besser als eine falsche Zahl.
      ungelesen.value = 0;
    } finally {
      laeuft = null;
    }
  })();
  return laeuft;
}

export async function ladeListe(nurUngelesen = false): Promise<void> {
  try {
    meldungen.value = await api.get<Meldung[]>(`/benachrichtigungen${nurUngelesen ? "?ungelesen=1" : ""}`);
  } catch {
    meldungen.value = [];
  }
}

export async function alsGelesen(id: string): Promise<void> {
  await api.post(`/benachrichtigungen/${id}/gelesen`, {});
  const m = meldungen.value.find((x) => x.id === id);
  if (m && !m.gelesenAm) {
    m.gelesenAm = new Date().toISOString();
    ungelesen.value = Math.max(0, ungelesen.value - 1);
  }
}

export async function alleGelesen(): Promise<void> {
  await api.post("/benachrichtigungen/gelesen", {});
  const jetzt = new Date().toISOString();
  for (const m of meldungen.value) if (!m.gelesenAm) m.gelesenAm = jetzt;
  ungelesen.value = 0;
}

export function useBenachrichtigungen() {
  return { meldungen, ungelesen, ladeAnzahl, ladeListe, alsGelesen, alleGelesen };
}
