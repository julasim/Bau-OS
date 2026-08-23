import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Jeder in einer Ansicht benutzte Icon-Name muss in `BIcon.vue` eine Glyphe
// haben.
//
// ── Warum das keine andere Prüfung findet ──────────────────────────────────
//
// `BIcon` rendert ein `<svg>` mit einer Kette von `v-else-if`. Trifft keiner
// zu, kommt ein leeres `<svg>` heraus: kein Fehler, keine Warnung, kein
// Eintrag in der Konsole — nur ein unsichtbarer Knopf.
//
// Gemessen am 23.08.2026 waren acht Namen unbekannt, an neun Stellen: der
// Zurück-Pfeil der Navigationsleiste, die Brotkrumen-Trenner der Topbar, der
// Aufklapp-Pfeil im Phasen-Reiter, der Bearbeiten-Stift in der
// Notiz-Detailansicht und der Download-Knopf im Projekt. Ursache war durchweg
// dieselbe: die Glyphen heissen kebab-case, aufgerufen wurden sie camelCase.
//
// Läuft ohne Datenbank.
describe("Icons: jeder benutzte Name hat eine Glyphe", () => {
  const wurzel = path.join(process.cwd(), "web/src");

  /** Wie `BIcon` selbst normalisiert. */
  const kebab = (n: string) =>
    n
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .trim();

  function vueDateien(dir: string): string[] {
    const raus: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const voll = path.join(dir, e.name);
      if (e.isDirectory()) raus.push(...vueDateien(voll));
      else if (e.name.endsWith(".vue")) raus.push(voll);
    }
    return raus;
  }

  it("kein Aufruf zeigt auf eine Glyphe, die es nicht gibt", () => {
    const bicon = fs.readFileSync(path.join(wurzel, "components/BIcon.vue"), "utf8");
    const bekannt = new Set([...bicon.matchAll(/name === '([a-z0-9-]+)'/g)].map((m) => m[1]));
    expect(bekannt.size).toBeGreaterThan(30);

    const fehlend: string[] = [];
    const nurNachNormalisierung: string[] = [];

    for (const datei of vueDateien(wurzel)) {
      const text = fs.readFileSync(datei, "utf8");
      // Nur statische Namen. Gebundene (`:name`) lassen sich hier nicht
      // auflösen und werden bewusst nicht geprüft.
      for (const m of text.matchAll(/<BIcon[^>]*\sname="([^"{]+)"/g)) {
        const roh = m[1];
        if (!bekannt.has(kebab(roh))) {
          fehlend.push(path.relative(process.cwd(), datei) + ': name="' + roh + '"');
        } else if (!bekannt.has(roh)) {
          nurNachNormalisierung.push(roh);
        }
      }
    }

    expect(fehlend, "Unbekannte Icon-Namen:\n" + fehlend.join("\n")).toEqual([]);

    // ── Die Kopplung an BIcon selbst ──────────────────────────────────────
    //
    // Ohne diesen Teil prüft der Test nur seine EIGENE Normalisierung: nimmt
    // man sie in `BIcon.vue` heraus, bliebe er grün und neun Icons wären
    // wieder unsichtbar. Genau das hat die Gegenprobe beim Bau gezeigt.
    //
    // Also: sobald irgendein Aufruf erst nach der Umschrift passt, MUSS die
    // Komponente sie auch machen.
    if (nurNachNormalisierung.length > 0) {
      expect(
        bicon.includes("$1-$2"),
        'Aufrufe wie name="' +
          nurNachNormalisierung[0] +
          '" passen erst nach der Umschrift auf kebab-case — BIcon.vue muss den Namen also normalisieren.',
      ).toBe(true);
    }
  });
});
