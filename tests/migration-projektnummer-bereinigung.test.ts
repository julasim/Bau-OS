import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB } from "./helpers/acl-fixture.js";
import { pruefeProjektnummer } from "../src/data/projektnummer.js";

// Die Bereinigung der Migrationen 052/054 gegen die Anwendung gehalten.
//
// ── Warum es diesen Test braucht ────────────────────────────────────────────
//
// Keine einzige Prüfung fuhr bis hierher das SQL der Migrationen gegen
// Bestandsdaten. Die Suite läuft gegen eine bereits migrierte Datenbank; der
// Schritt, der auf der echten Bürodatenbank genau einmal läuft, war damit
// ungeprüft.
//
// Und er war falsch. Migration 052 versprach im Kopfkommentar, „genauso zu
// normalisieren, wie es die Anwendung mit jeder Neueingabe tut" — gemessen
// entfernte sie Tabulator, CR, LF, geschütztes Leerzeichen und
// Byte-Reihenfolge-Marke NICHT, weil Postgres' einargumentiges `btrim()`
// ausschließlich U+0020 kennt und `\s` dort kein NBSP trifft.
//
// ── Was hier geprüft wird ───────────────────────────────────────────────────
//
// Nicht „läuft die Migration durch", sondern: **liefert die Datenbank für
// dieselbe Eingabe dasselbe Ergebnis wie `pruefeProjektnummer()`?** Genau die
// Divergenz war der Fehler, und nur ein Vergleich beider Seiten fängt sie.
describe.skipIf(!HAS_DB)("Migration: Bereinigung der Projektnummer", () => {
  let getDb: typeof import("../src/db/client.js").getDb;

  beforeAll(async () => {
    ({ getDb } = await import("../src/db/client.js"));
  });

  afterAll(async () => {
    // Nichts anzulegen — dieser Test schreibt nicht in `projects`.
  });

  /** Was die Datenbank aus einer Eingabe macht (Migration 054). */
  async function ausDerDatenbank(roh: string): Promise<string> {
    const [z] = await getDb()`SELECT patio_nummer_normal(${roh}) AS wert`;
    return String(z.wert);
  }

  /** Was die Anwendung daraus macht. */
  function ausDerAnwendung(roh: string): string {
    const r = pruefeProjektnummer(roh);
    return r.ok ? r.nummer : "";
  }

  // Zeichen über ihren Codepunkt gebaut, nie als Zeichen geschrieben — eine
  // Testdatei, die unsichtbare Zeichen prüft, ist die schlechteste Stelle für
  // unsichtbare Zeichen.
  const Z = (...codes: number[]) => codes.map((c) => String.fromCharCode(c)).join("");
  const TAB = Z(9);
  const LF = Z(10);
  const CR = Z(13);
  const NBSP = Z(0x00a0);
  const BOM = Z(0xfeff);
  const SCHMAL = Z(0x202f);
  const IDEO = Z(0x3000);
  const EN = Z(0x2002);

  const FAELLE: [string, string][] = [
    ["gewöhnlich", "SAZTG-2026-014"],
    ["Leerzeichen am Rand", "  SAZTG-2026-014  "],
    ["Tabulator", `${TAB}SAZTG-2026-014${TAB}`],
    ["Zeilenumbruch", `${CR}${LF}SAZTG-2026-014${CR}${LF}`],
    ["geschütztes Leerzeichen", `${NBSP}SAZTG-2026-014${NBSP}`],
    ["Byte-Reihenfolge-Marke", `${BOM}SAZTG-2026-014`],
    ["schmales geschütztes", `${SCHMAL}SAZTG-2026-014`],
    ["ideografisches", `${IDEO}SAZTG-2026-014`],
    ["En-Space", `${EN}SAZTG-2026-014`],
    ["doppelter Leerraum innen", "Altbestand   1998/7"],
    ["gemischter Leerraum innen", `Altbestand${TAB}${NBSP} 1998/7`],
    // Unicode-Normalform: `Ä` als ein Zeichen und als `A` plus kombinierendem
    // Akzent sehen gleich aus. Ohne NFC wären es für den eindeutigen Index
    // zwei verschiedene Nummern.
    ["Umlaut als ein Zeichen", `${Z(0x00c4)}-2026-014`],
    ["Umlaut als A + Akzent", `A${Z(0x0308)}-2026-014`],
  ];

  it.each(FAELLE)("Datenbank und Anwendung sind sich einig: %s", async (_name, roh) => {
    expect(await ausDerDatenbank(roh)).toBe(ausDerAnwendung(roh));
  });

  it("reiner Leerraum wird auf beiden Seiten zu nichts", async () => {
    // Der Fall, an dem 052 den CHECK still ausfallen ließ: aus einem
    // Tabulator wurde dort ein einzelnes Leerzeichen — weder NULL noch leer.
    for (const roh of [TAB, `${CR}${LF}`, NBSP, BOM, `${TAB} ${NBSP}`]) {
      expect(await ausDerDatenbank(roh), JSON.stringify(roh)).toBe("");
      expect(ausDerAnwendung(roh), JSON.stringify(roh)).toBe("");
    }
  });

  it("beide Seiten machen aus den zwei Umlaut-Schreibweisen dasselbe", async () => {
    // Der eigentliche Nachweis für NFC: nicht „jede Seite ist in sich
    // konsistent", sondern „beide Schreibweisen landen auf demselben Wert".
    const einer = `${Z(0x00c4)}-2026-014`;
    const zwei = `A${Z(0x0308)}-2026-014`;
    expect(await ausDerDatenbank(einer)).toBe(await ausDerDatenbank(zwei));
    expect(ausDerAnwendung(einer)).toBe(ausDerAnwendung(zwei));
    expect(await ausDerDatenbank(einer)).toBe(ausDerAnwendung(zwei));
  });

  it("die Bereinigung ist ein Fixpunkt", async () => {
    // 052 war keiner: 15 Zeichen nach dem ersten Durchgang, 14 nach dem
    // zweiten. Ein Wiederholungslauf hätte den inzwischen bestehenden
    // eindeutigen Index verletzt — mit der nackten Postgres-Meldung, weil der
    // Klartext-Wächter davor läuft.
    for (const [, roh] of FAELLE) {
      const einmal = await ausDerDatenbank(roh);
      expect(await ausDerDatenbank(einmal), JSON.stringify(roh)).toBe(einmal);
    }
  });

  it("die Nummernsuche vergleicht mit Postgres, nicht mit JavaScript", async () => {
    // Postgres' `lower()` und JavaScripts `toLowerCase()` sind NICHT dasselbe.
    // Gemessen über alle 1181 kleinschreibbaren Zeichen der Basis-Ebene:
    // 9 Abweichungen, praxisnah davon das türkische İ (U+0130) — JavaScript
    // macht daraus `i` plus kombinierenden Punkt, Postgres nicht.
    //
    // Solange die Anwendung selbst kleinschrieb und die Datenbank auf ihrem
    // `lower()`-Index verglich, hätte das geheißen: die Anwendung meldet die
    // Nummer als frei, die Datenbank lehnt sie ab. Jetzt steht `lower()` auf
    // beiden Seiten der Abfrage.
    const TUERKISCH_I = String.fromCharCode(0x0130);
    const nummer = `${TUERKISCH_I}ZMIR-2026-001`;

    const { projectRepo } = await import("../src/data/index.js");
    const name = `mig-tuerkisch-${Date.now()}`;
    const angelegt = await projectRepo.create(name, { projektnummer: nummer });
    expect(angelegt).toBe("ok");

    try {
      // Über die Nummer auflösbar — auch in anderer Schreibweise.
      expect(await projectRepo.nameByNummer?.(nummer)).toBe(name);
      // Und ein zweites Projekt mit derselben Nummer wird abgelehnt, nicht
      // mit einem Datenbankfehler quittiert.
      expect(await projectRepo.create(`${name}-zwei`, { projektnummer: nummer })).toBe("nummer-vergeben");
    } finally {
      await getDb()`DELETE FROM projects WHERE name LIKE ${"mig-tuerkisch-%"}`;
    }
  });

  it("die Funktion ist IMMUTABLE — sonst dürfte sie in keinem Index stehen", async () => {
    // Genau daran ist der erste Versuch von Migration 053 gescheitert
    // (`array_to_string` ist STABLE). Wer hier später etwas ändert, soll den
    // Test rot sehen, bevor er einen Ausdrucks-Index baut.
    const [z] = await getDb()`
      SELECT provolatile FROM pg_proc WHERE proname = 'patio_nummer_normal'`;
    expect(z.provolatile).toBe("i");
  });

  it("der Bestand ist nach den Migrationen normalisiert", async () => {
    // Der eigentliche Zweck von 054: keine Zeile darf sich durch eine erneute
    // Bereinigung noch ändern.
    const [z] = await getDb()`
      SELECT count(*)::int AS n FROM projects
       WHERE projektnummer IS DISTINCT FROM patio_nummer_normal(projektnummer)`;
    expect(z.n).toBe(0);
  });

  it("die Pflicht steht in der Datenbank, nicht nur in der Anwendung", async () => {
    // Ein Unique-Index lässt beliebig viele NULL zu — ohne NOT NULL wäre die
    // Lücke nicht einmal an doppelten Nummern zu erkennen.
    const [spalte] = await getDb()`
      SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'projects'::regclass AND attname = 'projektnummer'`;
    expect(spalte.attnotnull).toBe(true);

    const [bedingung] = await getDb()`
      SELECT count(*)::int AS n FROM pg_constraint
       WHERE conname = 'projects_projektnummer_nicht_leer' AND conrelid = 'projects'::regclass`;
    expect(bedingung.n).toBe(1);

    const [index] = await getDb()`
      SELECT count(*)::int AS n FROM pg_indexes
       WHERE tablename = 'projects' AND indexname = 'idx_projects_projektnummer_eindeutig'`;
    expect(index.n).toBe(1);
  });
});
