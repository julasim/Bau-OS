import { describe, it, expect } from "vitest";
import { heuteIso } from "../../web/src/utils/format";

// „Heute" als `YYYY-MM-DD` — nach örtlicher Zeit, nicht nach UTC.
//
// ── Der Fehler, den das verhindert ─────────────────────────────────────────
//
// `new Date().toISOString().slice(0, 10)` liest die UTC-Zeit. In Österreich
// (UTC+1, im Sommer UTC+2) steht dort zwischen Mitternacht und ein bzw. zwei
// Uhr früh noch der VORTAG. An sieben Stellen im Frontend stand genau dieser
// Ausdruck, drei davon füllten das Datum eines neuen Datensatzes vor: ein
// Bautagebuch-Eintrag um 00:30 bekam den gestrigen Tag.
//
// ── Warum mit einem gestellten Datum geprüft wird ──────────────────────────
//
// Ein Test mit dem echten `new Date()` würde auf einem UTC-Rechner (die CI ist
// einer) nichts beweisen: dort stimmen örtliche Zeit und UTC überein. Das
// gestellte Objekt trennt beides hart — es meldet örtlich den 24., in UTC den
// 23. Wer wieder `toISOString()` einsetzt, bekommt „2026-08-23" und damit Rot.
describe("heuteIso", () => {
  const gestellt = {
    getFullYear: () => 2026,
    getMonth: () => 7, // August (nullbasiert)
    getDate: () => 24,
    toISOString: () => "2026-08-23T22:30:00.000Z",
  } as unknown as Date;

  it("nimmt die örtlichen Anteile, nicht UTC", () => {
    expect(heuteIso(gestellt)).toBe("2026-08-24");
  });

  it("füllt Monat und Tag auf zwei Stellen auf", () => {
    const januar = {
      getFullYear: () => 2026,
      getMonth: () => 0,
      getDate: () => 5,
      toISOString: () => "2026-01-05T00:00:00.000Z",
    } as unknown as Date;
    expect(heuteIso(januar)).toBe("2026-01-05");
  });

  it("ohne Parameter kommt ein plausibles Datum von heute", () => {
    expect(heuteIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
