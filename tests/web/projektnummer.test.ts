import { describe, it, expect } from "vitest";
import { anzeigeNummer, projektZeile, istPlatzhalter, PLATZHALTER_PRAEFIX } from "../../web/src/utils/projektnummer";

// Die erste Frontend-Testdatei überhaupt.
//
// ── Warum das nachgeholt gehört ────────────────────────────────────────────
//
// `web/` hatte NULL Testdateien. Geprüft wurde dort ausschliesslich über
// `vue-tsc` (Typen) und im Browser von Hand. Beides fängt keine Logik: der
// Platzhalter für Projekte ohne Nummer darf nirgends wie eine Aktennummer
// aussehen, und genau diese Regel steht im Frontend ein zweites Mal — die
// Frontend-tsconfig kann `src/` nicht importieren.
describe("Projektnummer in der Oberfläche", () => {
  it("eine echte Nummer wird angezeigt", () => {
    expect(anzeigeNummer("SAZTG-2026-014")).toBe("SAZTG-2026-014");
  });

  it("der Platzhalter wird NICHT angezeigt", () => {
    // Stünde er ungefiltert in Kopfzeile, Portfolio, Ausdruck und Export,
    // hätte das Büro plötzlich Aktennummern, die niemand vergeben hat.
    expect(anzeigeNummer(`${PLATZHALTER_PRAEFIX}49911aa9`)).toBeNull();
    expect(istPlatzhalter(`${PLATZHALTER_PRAEFIX}49911aa9`)).toBe(true);
  });

  it("leer und null ergeben null, nicht den Rohwert", () => {
    expect(anzeigeNummer(null)).toBeNull();
    expect(anzeigeNummer(undefined)).toBeNull();
    expect(anzeigeNummer("")).toBeNull();
  });

  it("die Zeile setzt Nummer vor Namen — und lässt kein Trennzeichen stehen", () => {
    expect(projektZeile("Villa Müller", "SAZTG-2026-014")).toBe("SAZTG-2026-014 · Villa Müller");
    // Ohne Nummer bleibt es beim Namen. Ein führendes „· " wäre schlechter als
    // gar keine Nummer.
    expect(projektZeile("Villa Müller", null)).toBe("Villa Müller");
    expect(projektZeile("Villa Müller", `${PLATZHALTER_PRAEFIX}abc`)).toBe("Villa Müller");
  });

  it("ohne Namen bleibt die Nummer allein stehen", () => {
    expect(projektZeile(null, "SAZTG-2026-014")).toBe("SAZTG-2026-014");
    expect(projektZeile(null, null)).toBe("");
  });
});
