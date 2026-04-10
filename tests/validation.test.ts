import { describe, it, expect } from "vitest";
import { validateDatum, validateUhrzeit } from "../src/vault/termine.js";

describe("validateDatum", () => {
  it("akzeptiert gueltiges Datum TT.MM.JJJJ", () => {
    expect(validateDatum("15.04.2026")).toBeNull();
    expect(validateDatum("01.01.2024")).toBeNull();
    expect(validateDatum("31.12.2099")).toBeNull();
  });

  it("lehnt falsches Format ab", () => {
    expect(validateDatum("2026-04-15")).toContain("Ungueltiges Datumsformat");
    expect(validateDatum("15/04/2026")).toContain("Ungueltiges Datumsformat");
    expect(validateDatum("15.4.2026")).toContain("Ungueltiges Datumsformat");
    expect(validateDatum("morgen")).toContain("Ungueltiges Datumsformat");
    expect(validateDatum("")).toContain("Ungueltiges Datumsformat");
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
