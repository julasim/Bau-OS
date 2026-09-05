import { describe, it, expect } from "vitest";
import { alsKontaktverlauf } from "../src/data/db-team.js";

// Die drei Formen, in denen ein Kontaktverlauf in der Datenbank stehen kann.
//
// ── Warum es drei sind ─────────────────────────────────────────────────────
//
// `appendLog()` schrieb bis zum 02.09.2026 mit `${JSON.stringify(...)}::jsonb`.
// postgres.js serialisiert die übergebene Zeichenkette dabei ein zweites Mal;
// in der Spalte landet ein JSON-String statt eines Arrays. Am System
// nachgemessen: **223 von 223 Zeilen** standen auf `"[]"` — es hat also nie
// ein Vermerk überlebt.
//
// ⚠ Die zweite Altbestand-Form ist die tückische. Der Anhänge-Operator `||`
// auf zwei jsonb-ZEICHENKETTEN ergibt ein Array aus zwei Zeichenketten:
//
//   '"[]"'::jsonb || '"[{…}]"'::jsonb   ->   ["[]", "[{…}]"]
//
// (am 02.09.2026 gegen PostgreSQL 16 gemessen). Ein Leser, der nur „ist es
// eine Zeichenkette?" prüft, läuft daran vorbei: `Array.isArray` ist wahr,
// und `.map` auf einer Zeichenkette ergibt lauter `undefined`. Diese Form
// lässt sich nach dem Fix nirgends mehr erzeugen — deshalb steht sie hier.
describe("Kontaktverlauf: alle drei Formen sind lesbar", () => {
  const eintrag = { ts: "2026-09-02T10:00:00.000Z", text: "Rückruf vereinbart", author: "Julius" };

  it("die richtige Form — ein echtes Array von Objekten", () => {
    expect(alsKontaktverlauf([eintrag])).toEqual([eintrag]);
  });

  it("Altbestand ohne Anhängen — die ganze Spalte ist eine Zeichenkette", () => {
    expect(alsKontaktverlauf(JSON.stringify([eintrag]))).toEqual([eintrag]);
    expect(alsKontaktverlauf("[]")).toEqual([]);
  });

  it("Altbestand MIT Anhängen — ein Array aus Zeichenketten", () => {
    // Genau das, was `'"[]"'::jsonb || '"[{…}]"'::jsonb` erzeugt.
    const gemischt = [JSON.stringify([]), JSON.stringify([eintrag])];
    expect(alsKontaktverlauf(gemischt)).toEqual([eintrag]);
  });

  it("zwei angehängte Vermerke bleiben in ihrer Reihenfolge", () => {
    const zweiter = { ts: "2026-09-03T08:00:00.000Z", text: "Unterlagen geschickt", author: undefined };
    const gemischt = [JSON.stringify([eintrag]), JSON.stringify([zweiter])];
    expect(alsKontaktverlauf(gemischt).map((e) => e.text)).toEqual([eintrag.text, zweiter.text]);
  });

  it("Unbrauchbares ergibt eine leere Liste, keinen Absturz", () => {
    // Ein unlesbarer Vermerk darf die Team-Seite nicht abschießen.
    for (const roh of [null, undefined, "", "kein json", 42, {}, ["{kaputt"]]) {
      expect(alsKontaktverlauf(roh), `Wert ${JSON.stringify(roh)}`).toEqual([]);
    }
  });

  it("fehlende Felder werden aufgefüllt, statt undefined durchzureichen", () => {
    expect(alsKontaktverlauf([{ text: "ohne Zeitstempel" }])).toEqual([
      { ts: "", text: "ohne Zeitstempel", author: undefined },
    ]);
  });
});
