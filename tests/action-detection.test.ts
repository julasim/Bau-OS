import { describe, it, expect } from "vitest";
import { isActionRequest, ACTION_HINT, TOOL_SKIP_CORRECTION, MAX_TOOL_SKIP_RETRIES } from "../src/llm/actions.js";

describe("isActionRequest — True-Positives", () => {
  it.each([
    ["Leg eine neue Notiz an"],
    ["Erstell mir einen Termin für morgen"],
    ["Speicher das bitte"],
    ["Lösch die alte Notiz"],
    ["Loesch bitte den Termin"],
    // Hinweis: \b vor ä/ö/ü greift nicht (kein \w-Zeichen) — nur ASCII-Fallback aender/loesch matcht
    ["Aendere die Beschreibung"],
    ["aendere den Projektnamen"],
    ["Entfern das Teammitglied"],
    ["Aktualisier den Status"],
    ["Trag den Termin ein"],
    ["Plan den Meeting ein"],
    ["Notier das für mich"],
    ["Merk dir das"],
    ["Benenn das Projekt um"],
    ["Verschieb den Termin"],
    ["Füg das hinzu"],
    ["füg das hinzu"], // Pattern: füg.*hinzu (mit Umlaut, kein ASCII-Fallback)

    ["Buch den Raum"],
    ["Setz den Status auf erledigt"],
    ["Schreib das auf"],
    ["Erfass die Stunden"],
    ["Protokollier das Meeting"],
    ["Hinzufügen bitte"],
  ])('"%s" wird als Aktion erkannt', (msg) => {
    expect(isActionRequest(msg)).toBe(true);
  });
});

describe("isActionRequest — False-Negatives", () => {
  it.each([
    ["Was sind meine Aufgaben?"],
    ["Zeig mir alle Notizen"],
    ["Wie ist der Status des Projekts?"],
    ["Wann ist der nächste Termin?"],
    ["Liste alle Projekte auf"],
    ["Was habe ich heute?"],
    ["Suche nach Baugenehmigung"],
    ["Lies die Notiz"],
    ["Gib mir eine Zusammenfassung"],
    ["Wie viele Aufgaben sind offen?"],
  ])('"%s" wird NICHT als Aktion erkannt', (msg) => {
    expect(isActionRequest(msg)).toBe(false);
  });
});

describe("isActionRequest — Groß/Kleinschreibung", () => {
  it('"ERSTELL einen Termin" → true', () => {
    expect(isActionRequest("ERSTELL einen Termin")).toBe(true);
  });

  it('"lösch bitte" → true', () => {
    expect(isActionRequest("lösch bitte")).toBe(true);
  });

  it('"ZEIG mir die Notizen" → false', () => {
    expect(isActionRequest("ZEIG mir die Notizen")).toBe(false);
  });
});

describe("ACTION_HINT und TOOL_SKIP_CORRECTION — Existenz", () => {
  it("ACTION_HINT ist ein nicht-leerer String", () => {
    expect(typeof ACTION_HINT).toBe("string");
    expect(ACTION_HINT.length).toBeGreaterThan(0);
  });

  it("TOOL_SKIP_CORRECTION ist ein nicht-leerer String", () => {
    expect(typeof TOOL_SKIP_CORRECTION).toBe("string");
    expect(TOOL_SKIP_CORRECTION.length).toBeGreaterThan(0);
  });

  it("MAX_TOOL_SKIP_RETRIES ist eine positive Zahl", () => {
    expect(typeof MAX_TOOL_SKIP_RETRIES).toBe("number");
    expect(MAX_TOOL_SKIP_RETRIES).toBeGreaterThan(0);
  });
});
