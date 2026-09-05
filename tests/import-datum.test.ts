import { describe, it, expect } from "vitest";
import { validateDatum, alsIsoDatum } from "../src/data/termin-validation.js";

// Die Datumsprüfung der Datenübernahme — und warum sie ohne Datenbank auskommt.
//
// ── Der Fehler, den das verhindert ─────────────────────────────────────────
//
// `scripts/import-vault.ts` schrieb rohe Zeichenketten in `date`-Spalten.
// postgres.js serialisiert die über `new Date(x).toISOString()`, und `new
// Date()` liest einen punktgetrennten Wert in US-Notation. Am 01.09.2026 am
// Treiber gegen PostgreSQL 16 nachgemessen:
//
//   "05.10.2026"  (5. Oktober)  →  in der Spalte steht 2026-05-09
//   "31.12.2026"                →  RangeError: Invalid time value
//   ""                          →  RangeError: Invalid time value
//
// Der erste Fall ist der schlimmere: **fünf Monate falsch, ohne jede
// Meldung.** Eine übernommene Rechnung steht danach im falschen Quartal und
// in jeder Sortierung an der falschen Stelle — und niemand hat einen Anlass
// nachzusehen. Die beiden anderen reißen die gesamte Übernahme ab (sie läuft
// in einer Transaktion), mit `Invalid time value` als einziger Auskunft.
//
// ── Warum hier die Umwandlung geprüft wird und nicht das Skript ────────────
//
// Das Skript liest einen Vault von der Platte und schreibt in eine Datenbank;
// es dafür nachzubauen hieße, vor allem die Attrappen zu prüfen. Der
// eigentliche Schutz ist die Umwandlung: Was durch `validateDatum` kommt und
// durch `alsIsoDatum` geht, ist ISO — und ISO bindet der Treiber richtig.
describe("Datenübernahme: kein rohes Datum in eine date-Spalte", () => {
  /** Was der Import mit einem Wert macht, bevor er ihn bindet. */
  function alsSpaltenwert(roh: unknown): string | null {
    const wert = String(roh ?? "");
    return validateDatum(wert) ? null : alsIsoDatum(wert);
  }

  it("ein deutsches Datum wird nach ISO gedreht, nicht dem Treiber überlassen", () => {
    // Genau der Fall aus der Messung: 5. Oktober, nicht 9. Mai.
    expect(alsSpaltenwert("05.10.2026")).toBe("2026-10-05");
    expect(alsSpaltenwert("31.12.2026")).toBe("2026-12-31");
  });

  it("unbrauchbare Werte enden als null — der Aufrufer überspringt oder leert", () => {
    // Ohne diese Zeile ginge der Wert an den Treiber und würfe dort einen
    // `RangeError`, der die ganze Übernahme abbricht.
    for (const roh of ["", "morgen", "2026-13-01", "2026-04", null, undefined, "31.02.2026"]) {
      expect(alsSpaltenwert(roh), `Wert ${JSON.stringify(roh)}`).toBeNull();
    }
  });

  it("ISO geht unverändert durch", () => {
    expect(alsSpaltenwert("2026-10-05")).toBe("2026-10-05");
  });

  it("jede date-Spalte im Import geht durch einen der beiden Wächter", async () => {
    // ⚠ Wächter gegen die eigentliche Ursache: Beim ersten Anlauf war nur die
    // Terminspalte abgesichert, die vier Geschwister-Einfügungen im SELBEN
    // Skript nicht — und drei weitere optionale Felder auch nicht.
    //
    // Geprüft wird deshalb am Quelltext: In den INSERT-Anweisungen darf kein
    // rohes Datumsfeld mehr stehen.
    const { readFileSync } = await import("node:fs");
    const quelle = readFileSync("scripts/import-vault.ts", "utf8");

    const ROH = [
      /\$\{String\(d\.datum \?\? ""\)\}/,
      /\$\{String\(d\.date \?\? ""\)\}/,
      /\$\{\(d\.datum as string\) \?\? null\}/,
      /\$\{\(d\.startDate as string\) \?\? null\}/,
      /\$\{\(d\.endDate as string\) \?\? null\}/,
      /\$\{\(d\.sollStart as string\) \?\? null\}/,
      /\$\{\(d\.sollEnde as string\) \?\? null\}/,
      /\$\{\(d\.istStart as string\) \?\? null\}/,
      /\$\{\(d\.istEnde as string\) \?\? null\}/,
      /\$\{\(d\.nextMeetingDate as string\) \?\? null\}/,
    ];
    for (const muster of ROH) {
      expect(quelle, `rohes Datumsfeld gefunden: ${muster}`).not.toMatch(muster);
    }

    // Und die Wächter sind wirklich im Einsatz — nicht nur definiert.
    expect((quelle.match(/pruefeDatum\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((quelle.match(/datumOptional\(/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
});
