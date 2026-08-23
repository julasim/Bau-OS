// ============================================================
// PATIO — Projektnummer in der Oberfläche
// ============================================================
// Ein Ort für die Darstellung der Projektnummer. Sie ist seit Migration 052
// die Kennung, unter der ein Projekt im Haus geführt wird — im Büro in der
// Form `SAZTG-2026-000`.
//
// ── Warum das hier steht und nicht importiert wird ──────────────────────────
//
// Die Regeln der Nummer liegen serverseitig in `src/data/projektnummer.ts`.
// `web/tsconfig.json` schließt aber nur `web/src/**` ein — die Oberfläche kann
// aus dem Server-Baum nicht importieren. Die Kennung des Platzhalters steht
// deshalb bewusst zweimal im Baum. Wer sie dort ändert, muss sie hier
// mitändern; ein Test hält das fest.
//
// ── Warum es überhaupt eine gemeinsame Stelle braucht ───────────────────────
//
// Gemessen: an 82 Stellen zeigt die Oberfläche einen Projektnamen roh an. Wenn
// jede davon selbst entscheidet, ob und wie die Nummer danebensteht, sieht das
// Programm nach drei Runden an zwanzig Stellen unterschiedlich aus. Format und
// Trennzeichen gehören darum hierher, nicht in die Templates.
// ============================================================

/** Präfix der Platzhalter, die Migration 052 für Projekte ohne Nummer gesetzt
 *  hat. **Muss zu `PLATZHALTER_PRAEFIX` in `src/data/projektnummer.ts`
 *  passen** — siehe Kasten oben, warum die Konstante doppelt steht. */
export const PLATZHALTER_PRAEFIX = "OHNE-NUMMER-";

/** Beispielform für Eingabefelder und Hinweise. */
export const PROJEKTNUMMER_BEISPIEL = "SAZTG-2026-000";

/**
 * Ist das nur der Platzhalter aus der Migration und keine echte Nummer?
 *
 * Wichtig für die Anzeige: der Platzhalter darf NICHT wie eine Aktennummer
 * aussehen. Stünde er ungefiltert in Kopfzeile, Portfolio, Ausdruck und
 * Export, hätte das Büro plötzlich Aktennummern, die niemand vergeben hat.
 */
export function istPlatzhalter(nummer: string | null | undefined): boolean {
  return !!nummer && nummer.startsWith(PLATZHALTER_PRAEFIX);
}

/**
 * Die Nummer, wie sie angezeigt werden darf — oder `null`.
 *
 * `null` heißt: hier steht keine Nummer, die Oberfläche soll den Platz
 * entweder leer lassen oder zum Nachtragen auffordern.
 */
export function anzeigeNummer(nummer: string | null | undefined): string | null {
  if (!nummer || istPlatzhalter(nummer)) return null;
  return nummer;
}

/**
 * Projekt als eine Zeile: `SAZTG-2026-014 · Villa Müller`.
 *
 * Die Nummer steht VORNE. Wer eine Liste überfliegt, sucht die Akte, nicht den
 * Namen — und eine Spalte, in der alle Einträge an derselben Stelle mit
 * derselben Zeichenzahl beginnen, liest sich deutlich schneller als eine, in
 * der der Name die Position bestimmt.
 *
 * Ohne Nummer bleibt es beim Namen. Ein führendes Trennzeichen, weil die
 * Nummer fehlt, wäre schlechter als gar keine Nummer.
 */
export function projektZeile(name: string | null | undefined, nummer: string | null | undefined): string {
  const nr = anzeigeNummer(nummer);
  if (!name) return nr ?? "";
  return nr ? `${nr} · ${name}` : name;
}

/**
 * Nur die Nummer, sonst ein sprechender Ersatz.
 *
 * Für Spalten und Felder, in denen ausschließlich die Nummer steht. Der Text
 * „ohne Nummer" ist bewusst kein Bindestrich: er ist eine Aufforderung, kein
 * Formatierungszeichen.
 */
export function nummerOderHinweis(nummer: string | null | undefined): string {
  return anzeigeNummer(nummer) ?? "ohne Nummer";
}
