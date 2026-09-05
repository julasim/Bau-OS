import { describe, it, expect } from "vitest";
import { validateDatum, validateUhrzeit, alsIsoDatum } from "../src/data/termin-validation.js";

describe("validateDatum", () => {
  it("akzeptiert gueltiges Datum TT.MM.JJJJ", () => {
    expect(validateDatum("15.04.2026")).toBeNull();
    expect(validateDatum("01.01.2024")).toBeNull();
    expect(validateDatum("31.12.2099")).toBeNull();
  });

  it("akzeptiert ISO-Datum YYYY-MM-DD (HTML date-Input)", () => {
    expect(validateDatum("2026-04-15")).toBeNull();
    expect(validateDatum("2024-01-01")).toBeNull();
  });

  it("lehnt falsches Format ab", () => {
    expect(validateDatum("15/04/2026")).toContain("Ungueltiges Datumsformat");
    expect(validateDatum("15.4.2026")).toContain("Ungueltiges Datumsformat");
    expect(validateDatum("morgen")).toContain("Ungueltiges Datumsformat");
    expect(validateDatum("")).toContain("Ungueltiges Datumsformat");
  });

  it("alsIsoDatum konvertiert TT.MM.JJJJ → ISO, laesst ISO durch", () => {
    // Die Richtung hat sich mit Migration 060 umgedreht: kanonisch ist jetzt
    // ISO. Die Funktion hiess vorher `normalizeDatum` und tat das Gegenteil —
    // umbenannt statt nur umgedreht, weil eine Funktion, die unter altem
    // Namen das Gegenteil tut, genau die Falle ist, die den Board-Fehler ein
    // Jahr lang getragen hat.
    expect(alsIsoDatum("15.04.2026")).toBe("2026-04-15");
    expect(alsIsoDatum("2026-04-15")).toBe("2026-04-15");
  });

  it("lehnt Tage ab, die es nicht gibt", () => {
    // ⚠ Diese Pruefungen waren vor dem 01.09.2026 ROT: `validateDatum`
    // pruefte nur Bereiche (Tag 1–31, Monat 1–12) und liess `31.02.2026`
    // durch. Solange `termine.datum` TEXT war, landete das unbeanstandet in
    // der Datenbank; seit die Spalte `date` ist, waere es ein 500er aus
    // Postgres statt einer Absage mit Begruendung.
    expect(validateDatum("31.02.2026")).toContain("gibt es nicht");
    expect(validateDatum("30.02.2028")).toContain("gibt es nicht");
    expect(validateDatum("2026-02-30")).toContain("gibt es nicht");
    expect(validateDatum("31.04.2026")).toContain("gibt es nicht");
    // Der 29. Februar existiert im Schaltjahr sehr wohl — eine Pruefung, die
    // ihn mitnimmt, waere zu scharf.
    expect(validateDatum("29.02.2028")).toBeNull();
    expect(validateDatum("29.02.2027")).toContain("gibt es nicht");
  });

  it("lehnt ungueltigen Monat ab", () => {
    expect(validateDatum("15.00.2026")).toContain("Ungueltiger Monat");
    expect(validateDatum("15.13.2026")).toContain("Ungueltiger Monat");
  });

  it("lehnt ungueltigen Tag ab", () => {
    expect(validateDatum("00.04.2026")).toContain("Ungueltiger Tag");
    expect(validateDatum("32.04.2026")).toContain("Ungueltiger Tag");
  });

  it("lehnt ungueltiges Jahr ab", () => {
    expect(validateDatum("15.04.2019")).toContain("Ungueltiges Jahr");
    expect(validateDatum("15.04.2100")).toContain("Ungueltiges Jahr");
  });
});

describe("validateUhrzeit", () => {
  it("akzeptiert gueltige Uhrzeiten HH:MM", () => {
    expect(validateUhrzeit("08:30")).toBeNull();
    expect(validateUhrzeit("00:00")).toBeNull();
    expect(validateUhrzeit("23:59")).toBeNull();
    expect(validateUhrzeit("12:00")).toBeNull();
  });

  it("lehnt falsches Format ab", () => {
    expect(validateUhrzeit("8:30")).toContain("Ungueltiges Uhrzeitformat");
    expect(validateUhrzeit("08:3")).toContain("Ungueltiges Uhrzeitformat");
    expect(validateUhrzeit("0830")).toContain("Ungueltiges Uhrzeitformat");
    expect(validateUhrzeit("08.30")).toContain("Ungueltiges Uhrzeitformat");
  });

  it("lehnt ungueltige Stunde ab", () => {
    expect(validateUhrzeit("24:00")).toContain("Ungueltige Stunde");
    expect(validateUhrzeit("25:30")).toContain("Ungueltige Stunde");
  });

  it("lehnt ungueltige Minute ab", () => {
    expect(validateUhrzeit("08:60")).toContain("Ungueltige Minute");
    expect(validateUhrzeit("12:99")).toContain("Ungueltige Minute");
  });
});
