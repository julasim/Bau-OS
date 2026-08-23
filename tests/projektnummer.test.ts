import { describe, it, expect } from "vitest";
import {
  alsDateinamensteil,
  mitProjektnummer,
  pruefeProjektnummer,
  vergleichbar,
  istPlatzhalter,
  istNummerVergeben,
  PROJEKTNUMMER_MAX,
  PROJEKTNUMMER_BEISPIEL,
} from "../src/data/projektnummer.js";

// Die Regeln der Projektnummer (Migration 052). Sie ist die Kennung, unter der
// ein Projekt im Haus geführt wird — von Hand vergeben, in der Form
// `SAZTG-2026-000`.
//
// Diese Datei braucht KEINE Datenbank. Das ist Absicht: die Regeln müssen auch
// dann geprüft sein, wenn jemand die Suite ohne DATABASE_URL laufen lässt —
// und das passiert in dieser Umgebung regelmäßig.
describe("Projektnummer — die Regeln", () => {
  // Steuerzeichen werden über ihren Codepunkt gebaut und nie als Zeichen
  // geschrieben. Ein unsichtbares Zeichen im Quelltext eines Tests, der
  // unsichtbare Zeichen prüft, wäre die schlechteste Stelle dafür.
  const NUL = String.fromCharCode(0);
  const TAB = String.fromCharCode(9);
  const DEL = String.fromCharCode(127);

  describe("annehmen", () => {
    it("nimmt die Form des Büros", () => {
      const r = pruefeProjektnummer("SAZTG-2026-014");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.nummer).toBe("SAZTG-2026-014");
    });

    it("nimmt auch abweichende Formen — die Aktenordnung gehört dem Büro", () => {
      // Bauteile, Unterprojekte, übernommene Altprojekte: jedes erzwungene
      // Muster steht irgendwann einem echten Vorgang im Weg.
      for (const n of ["A-14/2", "2026-014-Bauteil-B", "Altbestand 1998/7", "SAZTG-2026-014a"]) {
        expect(pruefeProjektnummer(n).ok, n).toBe(true);
      }
    });

    it("schneidet Leerraum am Rand ab", () => {
      const r = pruefeProjektnummer("  SAZTG-2026-014  ");
      expect(r.ok && r.nummer).toBe("SAZTG-2026-014");
    });

    it("zieht mehrfachen Leerraum in der Mitte zusammen", () => {
      // Kommt beim Einfügen aus Word mit. Zwei Nummern, die sich nur durch
      // die Zahl der Leerzeichen unterscheiden, wären zwei Akten.
      const r = pruefeProjektnummer("Altbestand   1998/7");
      expect(r.ok && r.nummer).toBe("Altbestand 1998/7");
    });

    it("lässt die Groß-/Kleinschreibung stehen", () => {
      // Nur der VERGLEICH ist unempfindlich, die Anzeige nicht.
      const r = pruefeProjektnummer("saztg-2026-014");
      expect(r.ok && r.nummer).toBe("saztg-2026-014");
    });

    it("nimmt genau die Höchstlänge", () => {
      const r = pruefeProjektnummer("A".repeat(PROJEKTNUMMER_MAX));
      expect(r.ok).toBe(true);
    });
  });

  describe("ablehnen", () => {
    it("lehnt eine fehlende Nummer ab und nennt das Beispiel", () => {
      const r = pruefeProjektnummer(undefined);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.grund).toBe("fehlt");
        // Eine Fehlermeldung, die nicht sagt, wie es richtig aussieht, ist
        // eine halbe Fehlermeldung.
        expect(r.text).toContain(PROJEKTNUMMER_BEISPIEL);
      }
    });

    it("lehnt reinen Leerraum ab", () => {
      // Ohne diese Prüfung wäre `'   '` eine gültige Nummer — die
      // CHECK-Bedingung aus 052 würde erst in der Datenbank greifen, und der
      // Nutzer sähe einen Datenbankfehler statt eines Hinweises.
      for (const n of ["", "   ", TAB]) {
        const r = pruefeProjektnummer(n);
        expect(r.ok, JSON.stringify(n)).toBe(false);
      }
    });

    it("lehnt zu lange Eingaben ab", () => {
      const r = pruefeProjektnummer("A".repeat(PROJEKTNUMMER_MAX + 1));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.grund).toBe("zu-lang");
    });

    it("lehnt Steuerzeichen ab", () => {
      // Sie kommen beim Einfügen aus anderen Programmen mit und machen aus
      // zwei gleich AUSSEHENDEN Nummern zwei verschiedene — der eindeutige
      // Index aus 052 greift dann nicht mehr.
      for (const n of ["SAZTG-2026-014" + NUL, "SAZTG" + DEL + "2026"]) {
        const r = pruefeProjektnummer(n);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.grund).toBe("steuerzeichen");
      }
    });

    it("lehnt alles ab, was keine Zeichenkette ist", () => {
      for (const n of [null, 42, {}, [], true]) {
        expect(pruefeProjektnummer(n).ok).toBe(false);
      }
    });
  });

  describe("vergleichen", () => {
    it("vergleicht ohne Rücksicht auf Groß-/Kleinschreibung", () => {
      // Muss zum Index aus 052 passen (`lower(projektnummer)`). Läuft das
      // auseinander, meldet die Anwendung „frei" und die Datenbank lehnt
      // anschließend ab — ein 500 statt eines Hinweises.
      expect(vergleichbar("SAZTG-2026-014")).toBe(vergleichbar("saztg-2026-014"));
      expect(vergleichbar("SAZTG-2026-014")).not.toBe(vergleichbar("SAZTG-2026-015"));
    });
  });

  describe("Platzhalter aus der Migration", () => {
    it("erkennt den Platzhalter", () => {
      expect(istPlatzhalter("OHNE-NUMMER-49911aa9")).toBe(true);
    });

    it("hält eine echte Nummer nicht für einen Platzhalter", () => {
      expect(istPlatzhalter("SAZTG-2026-014")).toBe(false);
      expect(istPlatzhalter(null)).toBe(false);
      expect(istPlatzhalter(undefined)).toBe(false);
    });
  });

  describe("Als Bestandteil eines Dateinamens", () => {
    it("nimmt eine gewöhnliche Nummer unverändert", () => {
      expect(alsDateinamensteil("SAZTG-2026-014")).toBe("SAZTG-2026-014");
    });

    it("ersetzt den Schrägstrich", () => {
      // `A-14/2` ist in Österreich eine übliche Aktenschreibweise. Unter
      // Windows ist der Schrägstrich im Dateinamen aber kein Zeichen, sondern
      // eine Pfadtrennung — der Download hieße dann `2` und läge angeblich in
      // einem Ordner `A-14`.
      expect(alsDateinamensteil("A-14/2")).toBe("A-14-2");
    });

    it("ersetzt alle Zeichen, die Windows in Dateinamen verbietet", () => {
      const verboten = ["\\", "/", ":", "*", "?", '"', "<", ">", "|"];
      for (const z of verboten) {
        const gebaut = alsDateinamensteil(`A${z}B`);
        expect(gebaut, z).toBe("A-B");
      }
    });

    it("schneidet Punkte am Ende ab", () => {
      // Windows entfernt sie stillschweigend — dann hieße die Datei anders,
      // als hier steht.
      expect(alsDateinamensteil("SAZTG-2026-014..")).toBe("SAZTG-2026-014");
    });

    it("liefert für den Platzhalter nichts", () => {
      expect(alsDateinamensteil("OHNE-NUMMER-49911aa9")).toBe("");
      expect(alsDateinamensteil(null)).toBe("");
    });

    it("stellt die Nummer voran", () => {
      expect(mitProjektnummer("SAZTG-2026-014", "Besprechungsprotokoll 2026-08-23.docx")).toBe(
        "SAZTG-2026-014 Besprechungsprotokoll 2026-08-23.docx",
      );
    });

    it("lässt den Namen unverändert, wenn keine Nummer da ist", () => {
      // Ein Dateiname, der mit einem Trennzeichen anfängt, weil die Nummer
      // fehlte, wäre schlechter als gar keine Nummer.
      for (const nr of [null, undefined, "OHNE-NUMMER-abc12345"]) {
        expect(mitProjektnummer(nr, "Bautagebuch 2026-08-23.docx")).toBe("Bautagebuch 2026-08-23.docx");
      }
    });
  });

  describe("Rückfall bei gleichzeitigem Speichern", () => {
    it("erkennt die Verletzung des Eindeutigkeits-Index", () => {
      expect(istNummerVergeben({ code: "23505", constraint_name: "idx_projects_projektnummer_eindeutig" })).toBe(true);
    });

    it("verwechselt sie nicht mit dem eindeutigen Projektnamen", () => {
      // `projects_name_unique` (Migration 006) hat denselben Fehlercode. Ohne
      // die Prüfung auf den Namen der Bedingung meldete PATIO „Projektnummer
      // schon vergeben", während in Wahrheit der NAME doppelt ist.
      expect(istNummerVergeben({ code: "23505", constraint_name: "projects_name_unique" })).toBe(false);
    });

    it("hält andere Fehler nicht dafür", () => {
      expect(istNummerVergeben({ code: "23503" })).toBe(false);
      expect(istNummerVergeben(new Error("irgendwas"))).toBe(false);
      expect(istNummerVergeben(null)).toBe(false);
      expect(istNummerVergeben("text")).toBe(false);
    });
  });
});
