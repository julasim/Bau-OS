import { describe, it, expect } from "vitest";
import { formatDate, formatDateShort, formatWeekdayShort } from "../../web/src/utils/format";

// Datumsanzeige im Frontend — beide Formate, an EINER Stelle.
//
// ── Die Regression, die das verhindert ─────────────────────────────────────
//
// `DashboardView.vue` und `ProjectDetailView.vue` hatten je eine eigene
// Formatierung mit einer Abfangzeile für deutsche Werte
// (`if (d.includes(".")) return d;`). Beim Zusammenlegen auf die gemeinsame
// `formatDate` aus `utils/format.ts` sind sie entfallen — und die gemeinsame
// Fassung kannte den Fall nicht:
//
//   new Date("05.09.2026")  →  Sat May 09 2026   (Tag und Monat vertauscht)
//   new Date("15.09.2026")  →  Invalid Date      →  formatDate gibt ""
//
// (am 02.09.2026 in Node gemessen). Aus einer sichtbar falschen Anzeige wurde
// damit eine **plausibel falsche** — der 5. September erschien als 9. Mai.
//
// Solche Werte sind möglich, weil `tasks.date` weiterhin eine TEXT-Spalte ist;
// Migration 060 hat nur `termine.datum` angefasst.
describe("formatDate versteht beide Datumsformate", () => {
  it("ISO wird korrekt angezeigt", () => {
    expect(formatDate("2026-09-05")).toBe("05.09.2026");
    expect(formatDate("2026-12-31")).toBe("31.12.2026");
  });

  it("ein deutsches Datum wird NICHT verdreht", () => {
    // ⚠ Der eigentliche Punkt: 5. September, nicht 9. Mai.
    expect(formatDate("05.09.2026")).toBe("05.09.2026");
    // Und ein Tag über 12 ergibt keine leere Zelle mehr.
    expect(formatDate("15.09.2026")).toBe("15.09.2026");
    expect(formatDate("31.12.2026")).toBe("31.12.2026");
  });

  it("ein Tag, den es nicht gibt, ergibt eine leere Zelle statt eines erfundenen", () => {
    // JavaScript biegt `2026-02-31` still auf den 3. März. Ein erfundener Tag
    // in einer Fälligkeitsspalte ist schlechter als gar keiner.
    expect(formatDate("31.02.2026")).toBe("");
    expect(formatDate("30.02.2028")).toBe("");
    // Der 29. Februar im Schaltjahr existiert sehr wohl.
    expect(formatDate("29.02.2028")).toBe("29.02.2028");
  });

  it("leere und unbrauchbare Werte ergeben eine leere Zeichenkette", () => {
    for (const wert of [null, undefined, "", "morgen", "2026-13-01"]) {
      expect(formatDate(wert), `Wert ${JSON.stringify(wert)}`).toBe("");
    }
  });

  it("ISO-Zeitstempel laufen unverändert durch", () => {
    // Der neue Zweig darf den häufigsten Fall nicht anfassen: `updatedAt` und
    // `createdAt` kommen als voller Zeitstempel.
    expect(formatDate("2026-09-05T14:30:00.000Z")).toBe("05.09.2026");
    expect(formatDate(new Date("2026-09-05T12:00:00Z"))).toBe("05.09.2026");
  });

  it("die übrigen Formatierungen erben den Zweig", () => {
    // `toDate()` bedient zehn exportierte Funktionen — der Zweig gehört
    // deshalb dorthin und nicht in `formatDate`.
    expect(formatDateShort("05.09.2026")).toContain("05.09");
    expect(formatWeekdayShort("05.09.2026")).toBeTruthy();
  });
});
