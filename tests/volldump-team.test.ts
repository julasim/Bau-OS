import { describe, it, expect } from "vitest";
import { teamMarkdown, datumFuerArchiv, type TeamZeile } from "../src/export/volldump.js";

// Die Team-Liste im Volldump — und der einzige Zweig des Hauses, der über HTTP
// nicht mehr erreichbar ist.
//
// ── Warum das ohne Datenbank geprüft wird ──────────────────────────────────
//
// `mitPersonendaten === false` gilt nur für die Präsentationsrolle, und die
// kommt seit dem 31.08.2026 gar nicht mehr an `/exports/*`. Über die API ist
// dieser Zweig damit nicht mehr auszulösen — geprüft werden kann er trotzdem,
// weil die Erzeugung eine reine Funktion ist. Ohne diese Datei wäre es ein
// Zweig ohne jede Prüfung, und er entscheidet, ob E-Mail und Telefonnummer
// aller Beteiligten in einem ZIP das Haus verlassen.
describe("Volldump — Team.md", () => {
  const team: TeamZeile[] = [
    {
      name: "Anna Berger",
      role: "Projektleitung",
      email: "anna@example.at",
      phone: "+43 316 111",
      company: "Muster ZT",
      member_type: "Intern",
    },
    { name: "Boris Cerny", role: null, email: null, phone: "+43 316 222", company: null, member_type: "Extern" },
  ];

  it("mit Recht: Kontaktdaten stehen drin", () => {
    const md = teamMarkdown(team, true);
    expect(md).toContain("anna@example.at");
    expect(md).toContain("+43 316 111");
    expect(md).toContain("+43 316 222");
    expect(md).toContain("| Name | Rolle | E-Mail | Telefon | Firma | Art |");
  });

  it("ohne Recht: kein Kontaktweg, aber die Namen bleiben", () => {
    const md = teamMarkdown(team, false);
    // Der Punkt der ganzen Übung.
    expect(md).not.toContain("anna@example.at");
    expect(md).not.toContain("+43 316 111");
    expect(md).not.toContain("+43 316 222");
    // Ein Archiv ohne Namen wäre wertlos — gefiltert wird der Kontaktweg,
    // nicht die Person (gleiche Abwägung wie in src/api/personendaten.ts).
    expect(md).toContain("Anna Berger");
    expect(md).toContain("Boris Cerny");
    expect(md).toContain("Muster ZT");
  });

  it("die Spaltenzahl passt zur Kopfzeile — sonst zerfällt die Tabelle", () => {
    // Ein Markdown-Kopf mit sechs Spalten und Zeilen mit vier ergibt keine
    // Fehlermeldung, sondern eine still verrutschte Tabelle: unter „E-Mail"
    // stünde dann die Firma.
    for (const mit of [true, false]) {
      const zeilen = teamMarkdown(team, mit).split("\n");
      const spalten = (z: string) => z.split("|").length;
      expect(spalten(zeilen[3]), `Trennzeile, mitPersonendaten=${mit}`).toBe(spalten(zeilen[2]));
      expect(spalten(zeilen[4]), `erste Datenzeile, mitPersonendaten=${mit}`).toBe(spalten(zeilen[2]));
      expect(spalten(zeilen[5]), `zweite Datenzeile, mitPersonendaten=${mit}`).toBe(spalten(zeilen[2]));
    }
  });

  it("ein Senkrechtstrich im Freitext zerlegt die Tabelle nicht", () => {
    const md = teamMarkdown([{ ...team[0], name: "Anna | Berger" }], false);
    expect(md).toContain("Anna \\| Berger");
  });
});

// Leere Datumsfelder im Archiv — Befund 20 aus dem Review vom 30.08.2026.
describe("Volldump — leere Datumsfelder", () => {
  it("ein leeres Datum wird zum Gedankenstrich, nicht zu „..null“", () => {
    // ⚠ Die Bremse hieß `if (!iso)` und griff nie: `alsIso(null)` liefert die
    // Zeichenkette "null", und die ist wahr. Betroffen war jedes ausgelieferte
    // Archiv — ein Projekt ohne Enddatum, eine Phase ohne Ist-Termine, eine
    // Rechnung ohne Datum.
    for (const leer of [null, undefined, ""]) {
      expect(datumFuerArchiv(leer), `Wert ${JSON.stringify(leer)}`).toBe("—");
    }
  });

  it("ein echtes Datum kommt weiterhin als TT.MM.JJJJ heraus", () => {
    expect(datumFuerArchiv(new Date("2026-10-05T00:00:00Z"))).toBe("05.10.2026");
    expect(datumFuerArchiv("2026-10-05")).toBe("05.10.2026");
  });

  it("eine unerwartete Form ergibt den Gedankenstrich statt zerschnittenen Unsinns", () => {
    // Vorher lieferte `undefined` die Zeichenfolge `d.in.unde` — sichtbar in
    // der Tabelle, ohne dass irgendwo etwas rot wurde.
    expect(datumFuerArchiv("morgen")).toBe("—");
    expect(datumFuerArchiv(42)).toBe("—");
  });
});
