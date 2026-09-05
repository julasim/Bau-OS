// ============================================================
// PATIO — Termin-Validierung
// ============================================================
// Reine Pruef- und Normalisierungsfunktionen ohne Speicherzugriff. Lagen
// frueher in workspace/termine.ts neben dem Vault-CRUD; das CRUD ist mit
// dem Umbau zum Firmenserver in die Datenbank gewandert (db-termine.ts),
// die Validierung bleibt und wird von dort aufgerufen.
//
// ── Datumsformat: seit dem 01.09.2026 ist ISO kanonisch ────────────────────
//
// `termine.datum` war bis dahin eine TEXT-Spalte, und darin standen DREI
// Schreibweisen nebeneinander: `TT.MM.JJJJ` aus dieser Datei, ISO aus dem
// Auto-Meilenstein der Phasen, und ungeprueft alles Uebrige aus der
// Datenuebernahme. Migration 060 hat die Spalte auf `date` gehoben.
//
// **Angenommen werden weiterhin beide Formate**, gespeichert und ausgeliefert
// wird ausschliesslich ISO. Der Grund ist nicht Bequemlichkeit: `POST
// /termine` und `POST /projects/:name/termine` sind alte, dokumentierte
// Routen mit Aufrufern ausserhalb der eigenen Oberflaeche. Die Entscheidungen
// (Migration 045) nehmen dagegen NUR ISO an — sie sind jung und werden
// ausschliesslich aus der eigenen Oberflaeche geschrieben. Zwei Regeln fuer
// zwei Datumsspalten ist keine schoene Loesung, aber die ehrliche.
// ============================================================

import { istIsoDatum } from "./zeitstempel.js";

/**
 * Prueft ein Datum in `TT.MM.JJJJ` oder `YYYY-MM-DD`.
 * Gibt eine Fehlermeldung zurueck — oder `null`, wenn alles stimmt.
 *
 * ── Warum die Bereichspruefung allein nicht genuegt ────────────────────────
 *
 * Hier standen nur drei Vergleiche: Tag 1–31, Monat 1–12, Jahr 2020–2099.
 * `31.02.2026` besteht die alle drei. Solange die Spalte TEXT war, landete
 * das unbeanstandet in der Datenbank und fiel niemandem auf; seit sie `date`
 * ist, waere es ein 500er aus Postgres statt einer Absage mit Begruendung.
 *
 * `istIsoDatum()` prueft ueber den Rueckweg — es faengt damit genau die
 * Faelle, die JavaScript still zurechtbiegt (`2026-02-30` wird sonst zum
 * 2. Maerz, ohne dass irgendwo etwas rot wird).
 */
export function validateDatum(datum: string): string | null {
  let tag: number, monat: number, jahr: number;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(datum)) {
    [tag, monat, jahr] = datum.split(".").map(Number);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    [jahr, monat, tag] = datum.split("-").map(Number);
  } else {
    return `Ungueltiges Datumsformat "${datum}" — erwartet: TT.MM.JJJJ (z.B. 15.04.2026) oder YYYY-MM-DD`;
  }
  // Die Bereiche zuerst: sie liefern die praezisere Meldung ("Ungueltiger
  // Monat 13") als der Existenz-Check, der nur "gibt es nicht" sagen kann.
  if (monat < 1 || monat > 12) return `Ungueltiger Monat ${monat} in "${datum}"`;
  if (tag < 1 || tag > 31) return `Ungueltiger Tag ${tag} in "${datum}"`;
  if (jahr < 2020 || jahr > 2099) return `Ungueltiges Jahr ${jahr} in "${datum}"`;

  const iso = `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
  if (!istIsoDatum(iso)) return `Den Tag gibt es nicht: "${datum}"`;
  return null;
}

/**
 * Ein geprueftes Datum als `YYYY-MM-DD`.
 *
 * ── Warum die Funktion umbenannt wurde und nicht nur ihr Inhalt ────────────
 *
 * Sie hiess `normalizeDatum` und wandelte in die andere Richtung — ISO nach
 * `TT.MM.JJJJ`. Nur ihren Rumpf umzudrehen haette eine Funktion ergeben, die
 * unter altem Namen das Gegenteil tut. Das ist genau die Bauform, die den
 * Board-Fehler ein Jahr lang getragen hat: etwas heisst, wie es einmal war.
 *
 * Prueft NICHT — das ist Aufgabe von `validateDatum()`, das in beiden
 * Aufrufern (`db-termine.ts`) unmittelbar davor steht.
 */
export function alsIsoDatum(datum: string): string {
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(datum)) {
    const [tag, monat, jahr] = datum.split(".");
    return `${jahr}-${monat}-${tag}`;
  }
  return datum;
}

/** Prueft Uhrzeit im Format HH:MM — gibt Fehlermeldung oder null bei Erfolg */
export function validateUhrzeit(uhrzeit: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(uhrzeit)) {
    return `Ungueltiges Uhrzeitformat "${uhrzeit}" — erwartet: HH:MM (z.B. 14:30)`;
  }
  const [h, m] = uhrzeit.split(":").map(Number);
  if (h < 0 || h > 23) return `Ungueltige Stunde ${h} in "${uhrzeit}"`;
  if (m < 0 || m > 59) return `Ungueltige Minute ${m} in "${uhrzeit}"`;
  return null;
}
