// ============================================================
// PATIO — Zeitstempel nach aussen
// ============================================================
// Eine Regel für alle Repos: **jedes Datum verlässt den Server als ISO 8601.**
//
// ── Warum es diese Datei gibt ───────────────────────────────────────────────
//
// postgres.js liefert `timestamptz`-Spalten als JavaScript-`Date`. Wer daraus
// mit `String(wert)` eine Zeichenkette macht, bekommt NICHT ISO, sondern die
// Ausgabe von `Date.prototype.toString()`:
//
//     "Wed Aug 05 2026 19:44:33 GMT+0200 (Mitteleuropäische Sommerzeit)"
//
// Diese Zeichenkette beginnt mit dem WOCHENTAG. Jeder Vergleich darauf —
// `localeCompare`, `<`, `sort()` — sortiert damit alphabetisch nach
// „Fri, Mon, Sat, Sun, Thu, Tue, Wed" statt nach der Zeit. Das sieht nicht
// nach einem Fehler aus, es sieht nach einer eigenwilligen Reihenfolge aus,
// und genau deshalb ist es lange niemandem aufgefallen.
//
// Gemessen am 2026-08-23, bevor diese Datei entstand: sechs Repos wandelten
// selbst nach ISO, acht nicht. Derselbe Feldname `updatedAt` lieferte also
// zwei verschiedene Formate, je nachdem, welche Route man fragte. Betroffen
// waren unter anderem:
//
//   * `web/src/views/tasks-v2/TasksListPane.vue` und
//     `views/notes-v2/NotesListPane.vue` — beide sortieren „zuletzt geändert
//     zuerst" über `localeCompare(updatedAt)` und taten das nach Wochentag.
//   * `src/api/routes/papierkorb.ts` — sortiert alle Einträge über
//     `geloeschtAm`. Weil ein Teil der Repos ISO lieferte und ein Teil nicht,
//     war die Liste nicht bloss falsch sortiert, sondern in zwei Formaten
//     gemischt.
//
// ── Warum ISO und nicht das gewohnte Format ─────────────────────────────────
//
// ISO 8601 ist die einzige verbreitete Datumsschreibweise, bei der die
// alphabetische Reihenfolge mit der zeitlichen übereinstimmt. Damit ist ein
// String-Vergleich im Frontend von sich aus richtig — und die Sortierung
// funktioniert auch dort, wo niemand daran gedacht hat, vorher zu parsen.
// Angezeigt wird ohnehin nie die Rohform, sondern das Ergebnis von
// `web/src/utils/format.ts`.
// ============================================================

/**
 * Ein Datenbankwert als ISO-8601-Zeichenkette.
 *
 * `Date` → `toISOString()`. Alles andere (bereits eine Zeichenkette, eine
 * Zahl) wird durchgereicht — Migrationen und ältere Abfragen liefern
 * gelegentlich schon Text, und der soll nicht durch eine zweite Umwandlung
 * gehen.
 */
export function alsIso(wert: unknown): string {
  return wert instanceof Date ? wert.toISOString() : String(wert);
}

/** Wie `alsIso`, aber `null`/`undefined` bleiben `null`.
 *  Für Spalten, die leer sein dürfen (`completed_at`, `deleted_at`). */
export function alsIsoOderNull(wert: unknown): string | null {
  return wert === null || wert === undefined ? null : alsIso(wert);
}
