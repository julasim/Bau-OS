// Zentrale Datums-/Zahlen-Formatierung (PERF-2).
//
// Alle Intl-Formatter werden EINMAL beim Modul-Load instanziiert und bei jedem
// Aufruf wiederverwendet. Der bisherige Stil (`new Date(x).toLocaleDateString(
// "de-AT", { ... })` inline in ~14 Views) erzeugt bei jedem Aufruf implizit
// einen neuen Intl.DateTimeFormat — spuerbar teuer in Listen/Tabellen (Portfolio,
// Rechnungen, Gantt), die pro Zeile und pro Re-Render formatieren.
//
// Locale einheitlich de-AT. Jede Funktion parst robust (ISO mit/ohne Zeitanteil,
// Date, Timestamp) und liefert bei ungueltigem/leerem Input einen leeren String,
// statt "Invalid Date" anzuzeigen.

const LOCALE = "de-AT";
const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE, opts);

const _date = dtf({ day: "2-digit", month: "2-digit", year: "numeric" });
const _dateShort = dtf({ day: "2-digit", month: "2-digit", year: "2-digit" });
const _dayMonth = dtf({ day: "2-digit", month: "2-digit" });
const _dateTime = dtf({ day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const _timestamp = dtf({
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const _weekdayDayMonth = dtf({ weekday: "short", day: "numeric", month: "long" });
const _weekdayFull = dtf({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const _monthLong = dtf({ month: "long", year: "numeric" });
const _monthShort = dtf({ month: "short", year: "2-digit" });
const _weekdayShort = dtf({ weekday: "short" });

const _int = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** Robustes Parsing. Akzeptiert ISO-Strings (mit/ohne "T"-Zeitanteil), Date,
 *  oder einen Timestamp. Reine Datums-Strings (YYYY-MM-DD) werden als lokale
 *  Mitternacht interpretiert, nicht als UTC — sonst kippt das Datum je nach
 *  Zeitzone um einen Tag. Liefert null bei leer/ungueltig. */
function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    d = new Date(input + "T00:00:00");
  } else if (typeof input === "string" && /^\d{2}\.\d{2}\.\d{4}$/.test(input)) {
    // ── Deutsches Datum: hier, nicht in den Ansichten ──────────────────────
    //
    // ⚠ `new Date("05.09.2026")` liest US-Notation und ergibt den **9. Mai**;
    // `new Date("15.09.2026")` ergibt `Invalid Date`, und `formatDate` gibt
    // dann eine leere Zeichenkette zurueck. Am 02.09.2026 gemessen.
    //
    // Solche Werte sind moeglich, weil `tasks.date` weiterhin eine
    // TEXT-Spalte ohne Formatpruefung ist — Migration 060 hat nur
    // `termine.datum` angefasst.
    //
    // Drei Ansichten hatten dafuer eine EIGENE Abfangzeile
    // (`if (d.includes(".")) return d;`); beim Zusammenlegen auf diese
    // gemeinsame Funktion sind sie entfallen, und aus einer verdrehten Anzeige
    // wurde eine plausibel falsche. Deshalb steht die Behandlung jetzt hier,
    // einmal, statt in jeder Ansicht neu.
    const [tag, monat, jahr] = input.split(".");
    d = new Date(`${jahr}-${monat}-${tag}T00:00:00`);
    // `31.02.2026` biegt JavaScript still auf den 3. Maerz. Lieber eine leere
    // Zelle als ein erfundener Tag.
    if (!Number.isNaN(d.getTime()) && d.getDate() !== Number(tag)) return null;
  } else {
    d = new Date(input);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

type DateInput = string | number | Date | null | undefined;

/** dd.mm.yyyy — z.B. 15.07.2026 */
export function formatDate(input: DateInput): string {
  const d = toDate(input);
  return d ? _date.format(d) : "";
}

/** dd.mm.yy — z.B. 15.07.26 */
export function formatDateShort(input: DateInput): string {
  const d = toDate(input);
  return d ? _dateShort.format(d) : "";
}

/** dd.mm — z.B. 15.07. */
export function formatDayMonth(input: DateInput): string {
  const d = toDate(input);
  return d ? _dayMonth.format(d) : "";
}

/** dd.mm.yyyy, hh:mm — Datum + Uhrzeit ohne Sekunden. */
export function formatDateTime(input: DateInput): string {
  const d = toDate(input);
  return d ? _dateTime.format(d) : "";
}

/** dd.mm.yyyy, hh:mm:ss — mit Sekunden (Audit-Log). */
export function formatTimestamp(input: DateInput): string {
  const d = toDate(input);
  return d ? _timestamp.format(d) : "";
}

/** Wochentag (kurz), Tag, Monat (lang) — z.B. "Mi., 15. Juli" */
export function formatWeekdayDayMonth(input: DateInput): string {
  const d = toDate(input);
  return d ? _weekdayDayMonth.format(d) : "";
}

/** Wochentag (lang), Tag, Monat (lang), Jahr — z.B. "Mittwoch, 15. Juli 2026" */
export function formatWeekdayFull(input: DateInput): string {
  const d = toDate(input);
  return d ? _weekdayFull.format(d) : "";
}

/** Monat (lang) + Jahr — z.B. "Juli 2026" */
export function formatMonthLong(input: DateInput): string {
  const d = toDate(input);
  return d ? _monthLong.format(d) : "";
}

/** Monat (kurz) + Jahr (2-stellig) — z.B. "Jul. 26" */
export function formatMonthShort(input: DateInput): string {
  const d = toDate(input);
  return d ? _monthShort.format(d) : "";
}

/** Wochentag (kurz) — z.B. "Mi." */
export function formatWeekdayShort(input: DateInput): string {
  const d = toDate(input);
  return d ? _weekdayShort.format(d) : "";
}

/** Betrag in Euro, gerundet, mit nachgestelltem Zeichen — z.B. "1.500 €" */
export function formatEUR(n: number): string {
  return _int.format(n) + " €";
}

/**
 * Das heutige Datum als `YYYY-MM-DD` — nach ÖRTLICHER Zeit.
 *
 * ── Warum nicht `toISOString().slice(0, 10)` ──────────────────────────────
 *
 * Weil das die UTC-Zeit nimmt. In Österreich (UTC+1, im Sommer UTC+2) liefert
 * es zwischen Mitternacht und ein bzw. zwei Uhr früh noch das Datum des
 * VORTAGS. An sieben Stellen stand genau dieser Ausdruck; drei davon
 * bestimmten das vorausgefüllte Datum eines neuen Datensatzes — ein
 * Bautagebuch-Eintrag um 00:30 bekam den gestrigen Tag eingetragen. Bei einem
 * Dokument, das im Streitfall zählt, ist das kein Schönheitsfehler.
 *
 * Der Parameter dient der Prüfbarkeit: nur wer die örtlichen Anteile liest,
 * besteht `tests/web/datum-heute.test.ts`.
 */
export function heuteIso(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
