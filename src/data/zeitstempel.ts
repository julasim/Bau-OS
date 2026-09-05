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

// ── Ein reines Datum (Spaltentyp `date`) ────────────────────────────────────
//
// `alsIso` liefert einen vollen Zeitstempel — für eine `date`-Spalte ist das
// zu viel. Diese beiden schneiden auf `YYYY-MM-DD`.
//
// ── Warum das hier steht und nicht sechsmal in den Repos ────────────────────
//
// Weil es dort sechsmal STAND. Nachgezählt am 01.09.2026: als benannte
// Funktion `dateStr` in `db-invoices.ts` und `db-phases.ts`, als lokale
// Konstante gleichen Namens in `db-bautagebuch.ts`, `db-meetings.ts` und
// `db-time-entries.ts` — und ein sechstes Mal in `db-entscheidungen.ts`, dort
// unter dem Namen `datum`.
//
// Der abweichende Name ist der eigentliche Punkt: Wer nach `dateStr` sucht,
// findet fünf Stellen und hält die Sache für vollständig. Genau so entsteht
// die Stelle, die beim nächsten Mal vergessen wird — und der Kopf dieser
// Datei warnt seit dem 23.08. vor der Falle, gegen die sich alle sechs
// einzeln abgesichert haben.
//
// **Der Grund, dass es sie braucht:** postgres.js liefert `date`-Spalten als
// `Date` mit UTC-Mitternacht. `toISOString().slice(0, 10)` ist damit
// unabhängig von der Zeitzone des Prozesses richtig — auch westlich von UTC.
// `String(…)` dagegen ergibt „Sat Jun 20 2026 …", beginnt also mit dem
// Wochentag.

/** Ein `date`-Wert aus der Datenbank als `YYYY-MM-DD`. `null` bleibt `null`. */
export function dateStr(wert: unknown): string | null {
  if (wert === null || wert === undefined) return null;
  if (wert instanceof Date) return wert.toISOString().slice(0, 10);
  return String(wert).slice(0, 10);
}

/** Wie `dateStr`, aber für Spalten mit `NOT NULL`.
 *
 *  Eigene Funktion statt `dateStr(x)!`: Das Rufzeichen behauptet nur, hier
 *  stünde nie `null`. Steht dort wider Erwarten doch eines — eine Spalte
 *  verliert ihr `NOT NULL`, ein `LEFT JOIN` liefert eine leere Zeile —, wäre
 *  das Ergebnis die Zeichenkette „null" mitten in einem Datumsfeld, und die
 *  läuft still durch bis in die Oberfläche. Hier fällt sie stattdessen sofort
 *  auf, an der Stelle, an der sie entsteht. */
export function dateStrPflicht(wert: unknown): string {
  const iso = dateStr(wert);
  if (iso === null) throw new Error("Datumsfeld ist leer, obwohl die Spalte NOT NULL ist");
  return iso;
}

// ── Ein Datum, das es wirklich gibt ─────────────────────────────────────────
//
// Sechs Repositories hielten je eine eigene Kopie von `/^\d{4}-\d{2}-\d{2}$/`
// und prueften damit die FORM eines Datums, nicht das Datum. `2026-13-99`
// besteht diese Pruefung — und schlaegt dann in Postgres auf:
//
//   date/time field value out of range: "2026-13-99"
//
// Fuer den Aufrufer heisst das ein 500er statt einer Absage. Gefunden beim Bau
// des Blaetter-Cursors, wo der Wert direkt aus der URL kommt; dieselbe Luecke
// steckt aber in jedem Datumsfeld, das aus einem Formular kommt.
const ISO_FORM = /^\d{4}-\d{2}-\d{2}$/;

/** Ist das ein gueltiges Datum im Format `YYYY-MM-DD`? */
export function istIsoDatum(wert: unknown): wert is string {
  if (typeof wert !== "string" || !ISO_FORM.test(wert)) return false;
  const d = new Date(`${wert}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Der Rueckweg faengt die Faelle, die JavaScript still zurechtbiegt:
  // `2026-02-30` wird zu `2026-03-02`, ohne dass irgendwo etwas rot wird.
  return d.toISOString().slice(0, 10) === wert;
}
