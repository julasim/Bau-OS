// ============================================================
// PATIO — Die Projektnummer
// ============================================================
// Ein Ort fuer die Regeln der Projektnummer. Sie ist ab Migration 052 die
// Kennung, unter der ein Projekt im Haus gefuehrt wird — vergeben von Hand,
// im Buero in der Form `SAZTG-2026-000`.
//
// ── Warum das Format NICHT erzwungen wird ───────────────────────────────────
//
// Weil eine Aktenordnung Ausnahmen hat. Bauteile, Unterprojekte, uebernommene
// Altprojekte, ein Jahreswechsel mitten im Auftrag — jedes Muster, das man
// hier festschreibt, steht irgendwann einem echten Vorgang im Weg, und dann
// wird es umgangen statt gepflegt. Geprueft wird deshalb nur, was ohne jede
// Kenntnis der Aktenordnung falsch ist: leer, zu lang, mit Steuerzeichen.
//
// Die Form `SAZTG-2026-000` steht als Beispiel in der Oberflaeche. Das ist
// die richtige Stelle dafuer — ein Vorschlag wirkt, ein Verbot aergert.
//
// ── Warum der Vergleich klein geschrieben wird ──────────────────────────────
//
// `SAZTG-2026-001` und `saztg-2026-001` sind fuer die Datenbank zwei
// verschiedene Zeichenketten, fuer jeden Menschen dieselbe Akte. Der
// eindeutige Index in 052 liegt darum auf `lower(projektnummer)`, und jeder
// Vergleich hier muss dazu passen — sonst meldet die Anwendung „frei" und die
// Datenbank lehnt anschliessend ab.
// ============================================================

/** Obergrenze. Kein fachlicher Wert, sondern ein Riegel gegen Unfug:
 *  eine Aktennummer, die laenger ist als eine Zeile, ist keine. */
export const PROJEKTNUMMER_MAX = 60;

/** Das Beispiel, das in der Oberflaeche steht. Hier, damit Server und
 *  Oberflaeche dasselbe zeigen. */
export const PROJEKTNUMMER_BEISPIEL = "SAZTG-2026-000";

/** Praefix der Platzhalter, die Migration 052 fuer Projekte ohne Nummer
 *  gesetzt hat. Die Oberflaeche erkennt sie daran und verlangt eine echte
 *  Nummer, statt den Platzhalter wie eine Aktennummer anzuzeigen. */
export const PLATZHALTER_PRAEFIX = "OHNE-NUMMER-";

/** Ist das nur der Platzhalter aus der Migration und keine echte Nummer? */
export function istPlatzhalter(nummer: string | null | undefined): boolean {
  return !!nummer && nummer.startsWith(PLATZHALTER_PRAEFIX);
}

/** Warum eine Eingabe nicht als Projektnummer taugt. */
export type NummerFehler = "fehlt" | "zu-lang" | "steuerzeichen" | "ohne-inhalt";

/** Ergebnis der Pruefung: entweder die bereinigte Nummer oder ein Grund. */
export type NummerErgebnis = { ok: true; nummer: string } | { ok: false; grund: NummerFehler; text: string };

/**
 * Prueft und bereinigt eine eingegebene Projektnummer.
 *
 * Bereinigt wird nur, was niemand absichtlich eingibt: Leerraum am Rand und
 * mehrfacher Leerraum in der Mitte. Die Gross-/Kleinschreibung bleibt, wie
 * sie eingegeben wurde — sie gehoert dem Buero. Nur der VERGLEICH ist
 * unempfindlich dagegen (siehe `vergleichbar`).
 */
export function pruefeProjektnummer(roh: unknown): NummerErgebnis {
  if (typeof roh !== "string") {
    return { ok: false, grund: "fehlt", text: `Projektnummer erforderlich (z. B. ${PROJEKTNUMMER_BEISPIEL})` };
  }

  // Unicode-Normalform C, BEVOR irgendetwas verglichen wird.
  //
  // `Ä` gibt es als ein Zeichen (U+00C4) und als `A` plus kombinierendem
  // Akzent (U+0041 U+0308). Beide sehen gleich aus, und ohne diesen Schritt
  // sind sie fuer den eindeutigen Index aus Migration 052 zwei verschiedene
  // Nummern — gemessen: `vergleichbar()` sagt ungleich, nach NFC gleich.
  //
  // Postgres kann dasselbe (`normalize(text, NFC)`); Migration 054 tut es in
  // `patio_nummer_normal()`, und ein Test haelt beide Seiten gegeneinander.
  const nummer = roh.normalize("NFC").trim().replace(/\s+/g, " ");

  if (nummer === "") {
    return { ok: false, grund: "fehlt", text: `Projektnummer erforderlich (z. B. ${PROJEKTNUMMER_BEISPIEL})` };
  }
  if (nummer.length > PROJEKTNUMMER_MAX) {
    return {
      ok: false,
      grund: "zu-lang",
      text: `Projektnummer darf höchstens ${PROJEKTNUMMER_MAX} Zeichen haben`,
    };
  }

  // Steuer- UND Formatzeichen.
  //
  // Steuerzeichen (C0, DEL) sind der offensichtliche Fall. Die
  // Formatzeichen der Kategorie Cf sind der gefaehrlichere: Zero-Width-Space
  // (U+200B), Wortverbinder (U+2060), Rechts-nach-links-Marke (U+202E) und
  // das weiche Trennzeichen (U+00AD, Kategorie Cf ist es nicht, es kommt
  // deshalb einzeln dazu) sind vollstaendig unsichtbar.
  //
  // Gemessen, bevor diese Zeile stand: alle fuenf kamen durch, und eine
  // „Nummer" aus zwei Zero-Width-Spaces wurde angenommen — sie haette NOT
  // NULL und die CHECK-Bedingung aus 052 passiert und waere in Dateinamen
  // und Rechnungsvorschlag gewandert.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u00ad]|\p{Cf}/u.test(nummer)) {
    return { ok: false, grund: "steuerzeichen", text: "Projektnummer enthält unerlaubte Zeichen" };
  }

  // Mindestens ein Buchstabe oder eine Ziffer. Eine „Nummer" aus lauter
  // Bindestrichen ist keine, und sie waere im Dateinamen und in der
  // Rechnungsnummer nicht von einem Formatierungsfehler zu unterscheiden.
  if (!/[\p{L}\p{N}]/u.test(nummer)) {
    return {
      ok: false,
      grund: "ohne-inhalt",
      text: "Projektnummer braucht mindestens einen Buchstaben oder eine Ziffer",
    };
  }

  return { ok: true, nummer };
}

/**
 * Die Form, in der zwei Nummern IM SPEICHER verglichen werden.
 *
 * ── Ausdruecklich NICHT fuer Datenbankabfragen ──────────────────────────────
 *
 * Der eindeutige Index aus Migration 052 liegt auf Postgres' `lower()`. Das
 * ist NICHT dasselbe wie JavaScripts `toLowerCase()`: gemessen ueber alle 1181
 * Zeichen der Basis-Ebene, die sich ueberhaupt kleinschreiben lassen, weichen
 * 9 voneinander ab — praxisnah davon das tuerkische İ (U+0130), das in
 * JavaScript zu `i` plus kombinierendem Punkt wird und in Postgres nicht.
 *
 * Wo eine Nummer gegen die Datenbank geprueft wird, steht deshalb `lower()`
 * auf BEIDEN Seiten der Abfrage — dann koennen die zwei Kleinschreibungen per
 * Bauart nicht auseinandergehen. Frueher stand hier `vergleichbar()`, und die
 * Folge waere gewesen: die Anwendung meldet „frei", die Datenbank lehnt ab.
 *
 * Fuer reine Listenvergleiche im Speicher (etwa die Nummern-Historie) ist
 * diese Funktion weiterhin richtig: dort waere eine Abweichung hoechstens ein
 * ueberfluessiger Eintrag.
 */
export function vergleichbar(nummer: string): string {
  return nummer.toLowerCase();
}

/**
 * Ist dieser Fehler die Verletzung des Eindeutigkeits-Index auf der
 * Projektnummer?
 *
 * Gebraucht als RÜCKFALL, nicht als Regelweg: die Repos fragen vorher ab, ob
 * die Nummer frei ist. Zwischen dieser Abfrage und dem Schreiben liegt aber
 * ein Moment, und auf einem Server mit acht Arbeitsplaetzen reicht der. Ohne
 * diesen Rueckfall waere das Ergebnis ein 500 statt eines Hinweises, dass
 * jemand schneller war.
 */
export function istNummerVergeben(fehler: unknown): boolean {
  if (!fehler || typeof fehler !== "object") return false;
  const f = fehler as { code?: unknown; constraint_name?: unknown; message?: unknown };
  if (f.code !== "23505") return false;
  const name = typeof f.constraint_name === "string" ? f.constraint_name : String(f.message ?? "");
  return name.includes("projektnummer");
}

/**
 * Die Projektnummer, wie sie in einem DOKUMENT stehen darf.
 *
 * Leer, wenn keine echte Nummer vorliegt. Das Gegenstueck zu `anzeigeNummer()`
 * in `web/src/utils/projektnummer.ts`, nur fuer die Server-Seite.
 *
 * ── Warum das noetig ist ────────────────────────────────────────────────────
 *
 * Migration 052 hat Bestandsprojekten `OHNE-NUMMER-<id>` eingetragen, damit die
 * Spalte Pflicht werden konnte. Ungefiltert landet dieser Platzhalter in jedem
 * Dokument, das eine Projektnummer ausweist — Word-Vorlagen
 * (`{Projekt.Projektnummer}`), Projektbericht, Markdown-Dossier. Also genau in
 * dem, was das Haus verlaesst, und in einer Form, die wie eine Aktennummer
 * aussieht. Jemand tippt sie dann ab.
 *
 * Ein leeres Feld ist die ehrlichere Auskunft: das Projekt hat (noch) keine
 * Nummer.
 */
export function alsDokumentwert(nummer: string | null | undefined): string {
  return !nummer || istPlatzhalter(nummer) ? "" : nummer;
}

/**
 * Die Projektnummer als Bestandteil eines DATEINAMENS.
 *
 * Die Nummer ist Freitext — eine Aktenordnung kennt `A-14/2` und
 * `Altbestand 1998/7`. Ein Schraegstrich im Dateinamen ist unter Windows kein
 * Zeichen, sondern eine Pfadtrennung; der Download hiesse dann `2` und laege
 * angeblich in einem Ordner `A-14`. Ersetzt werden deshalb alle Zeichen, die
 * Windows in Dateinamen verbietet:
 *
 *     \  /  :  *  ?  "  <  >  |
 *
 * Dazu Punkte am Ende (Windows schneidet sie stillschweigend ab) und
 * Steuerzeichen — letztere kommen ueber `pruefeProjektnummer` ohnehin nicht
 * durch, die Zeile hier ist der Guertel zum Hosentraeger.
 */
export function alsDateinamensteil(nummer: string | null | undefined): string {
  if (!nummer || istPlatzhalter(nummer)) return "";
  return (
    nummer
      // eslint-disable-next-line no-control-regex -- siehe pruefeProjektnummer
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
      .replace(/\.+$/, "")
      .trim()
  );
}

/**
 * Baut einen Dateinamen mit vorangestellter Projektnummer.
 *
 * `SAZTG-2026-014 Besprechungsprotokoll 2026-08-23.docx`
 *
 * Ohne Nummer (oder mit blossem Platzhalter) bleibt der Name unveraendert —
 * ein Dateiname, der mit einem Bindestrich anfaengt, weil die Nummer fehlte,
 * waere schlechter als gar keine Nummer.
 */
export function mitProjektnummer(nummer: string | null | undefined, rest: string): string {
  const teil = alsDateinamensteil(nummer);
  return teil ? `${teil} ${rest}` : rest;
}
