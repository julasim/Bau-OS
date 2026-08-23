import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HAS_DB } from "./helpers/acl-fixture.js";
import { PLATZHALTER_PRAEFIX } from "../src/data/projektnummer.js";

// Drei Wächter, die ohne Datenbank laufen und Dinge festhalten, die keine
// andere Prüfung sehen kann.
//
// Sie stehen bewusst in EINER Datei: es sind keine Fachtests, sondern
// Zusicherungen über das Projekt als Ganzes.

// ── 1. Läuft die Suite überhaupt vollständig? ───────────────────────────────
describe("Wächter: die Prüfung selbst", () => {
  it("in der CI muss eine Datenbank stehen", () => {
    // ── Das Problem, gegen das dieser Test steht ─────────────────────────────
    //
    // 45 von 61 Testdateien beginnen mit `describe.skipIf(!HAS_DB)`. Ohne
    // `DATABASE_URL` überspringen sie sich **still**: gemessen laufen dann 155
    // von 599 Prüfungen, kein einziger Fehlschlag, Exit 0. Ein halber Lauf
    // sieht aus wie ein voller.
    //
    // Genau so ist die CI monatelang grün gewesen, während siebzehn Routen
    // ohne Rechteprüfung im Baum standen — die Tests, die das gefangen hätten,
    // liefen dort nicht mit.
    //
    // Der Wächter greift NUR in der CI. Lokal ohne Datenbank zu arbeiten
    // bleibt erlaubt (schnelle Runde über die reinen Logiktests); dort ist die
    // Zahl der übersprungenen Dateien im Bericht sichtbar, und wer sie liest,
    // weiss, woran er ist. In der CI liest niemand — dort zählt nur die Farbe.
    if (!process.env.CI) {
      expect(true).toBe(true);
      return;
    }
    expect(
      HAS_DB,
      "DATABASE_URL fehlt in der CI. Ohne Datenbank überspringen sich die ACL-, Auth- und " +
        "Datenbanktests still, und der Lauf meldet trotzdem grün. Siehe den services-Block " +
        "in .github/workflows/build.yml.",
    ).toBe(true);
  });
});

// ── 2. Zwei Kopien derselben Konstante ──────────────────────────────────────
describe("Wächter: Platzhalter-Präfix auf beiden Seiten", () => {
  it("Server und Oberfläche kennen dasselbe Präfix", async () => {
    // Der Platzhalter für Projekte ohne Nummer (`OHNE-NUMMER-…`) steht zweimal
    // im Baum: einmal im Server, einmal im Frontend. Das ist Absicht — die
    // Frontend-tsconfig schliesst `src/**` nicht ein, ein Import ist also gar
    // nicht möglich. Der Kommentar an beiden Stellen fordert Gleichheit, aber
    // niemand hat sie erzwungen.
    //
    // Laufen sie auseinander, zeigt die Oberfläche einen Platzhalter als
    // Aktennummer an — genau der Fehler, den die Platzhalter-Logik verhindern
    // soll, nur an der letzten Stelle vor dem Auge des Nutzers.
    const quelle = fs.readFileSync(path.join(process.cwd(), "web/src/utils/projektnummer.ts"), "utf8");
    const treffer = quelle.match(/PLATZHALTER_PRAEFIX\s*=\s*"([^"]+)"/);
    expect(treffer, "PLATZHALTER_PRAEFIX nicht in web/src/utils/projektnummer.ts gefunden").toBeTruthy();
    expect(treffer![1]).toBe(PLATZHALTER_PRAEFIX);
  });
});

// ── 3. Kein Außenkontakt ────────────────────────────────────────────────────
describe("Wächter: der Server bleibt offline", () => {
  // ── Ausgeschlossen wird namentlich, nicht nach Muster ────────────────────
  //
  // Der erste Bau übersprang pauschal jedes Verzeichnis, das mit einem Punkt
  // beginnt. Damit fiel `docs/.vitepress/` heraus — ausgerechnet der Ordner,
  // in dem der Google-Fonts-Import monatelang stand. Die Gegenprobe (Import
  // wieder einbauen, Test muss rot werden) blieb grün und hat den Fehler
  // sofort gezeigt.
  //
  // Deshalb: eine benannte Liste. Wer hier einen Ordner ergänzt, tut es
  // bewusst.
  const AUS = new Set([
    "node_modules",
    ".git",
    ".husky",
    ".claude",
    "dist",
    "dist-electron",
    "release",
    "logs",
    "coverage",
    "cache",
    "_archive",
    ".vite",
    ".vitepress-cache",
  ]);

  /** Endungen, die überhaupt Verweise enthalten können. */
  const REL = /\.(ts|tsx|js|mjs|cjs|vue|css|html|md|json|yml|yaml)$/i;

  function dateien(wurzel: string): string[] {
    const raus: string[] = [];
    const lauf = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (AUS.has(e.name)) continue;
        // Der Build-Cache von VitePress enthält Kopien fremder Pakete.
        if (dir.endsWith(path.join("docs", ".vitepress")) && e.name === "cache") continue;
        const voll = path.join(dir, e.name);
        if (e.isDirectory()) lauf(voll);
        else if (REL.test(e.name)) raus.push(voll);
      }
    };
    lauf(wurzel);
    return raus;
  }

  // Hosts, die im Betrieb Daten oder Code nachladen würden. Die
  // Google-Fonts-Zeile in der Dokumentation hat die gesamte AP0-Runde
  // überlebt und fiel erst beim Bau des Arbeitsplatz-Programms auf — ein
  // Wächter nur über `src/` hätte sie nicht gefunden. Deshalb läuft dieser
  // über den ganzen Baum, `docs/` eingeschlossen.
  const VERBOTEN = [
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "ajax.googleapis.com",
    "cdn.jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "code.jquery.com",
    "www.google.com/maps",
    "maps.google.com",
    "wa.me/",
    "api.whatsapp.com",
    "api.telegram.org",
    "graph.microsoft.com",
    "api.openai.com",
    "api.anthropic.com",
  ];

  it("kein Verweis auf einen fremden Host, der im Betrieb geladen würde", () => {
    const funde: string[] = [];
    for (const f of dateien(process.cwd())) {
      // Diese Datei selbst führt die Liste — sie darf sich nicht selbst melden.
      if (f.endsWith(path.join("tests", "waechter.test.ts"))) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const host of VERBOTEN) {
        if (!text.includes(host)) continue;
        // Eine Zeile, die den Host nur ERWÄHNT (Kommentar, Doku-Prosa), ist
        // kein Außenkontakt. Gemeint ist der Verweis: in einer URL mit
        // Schema, in einem Import oder in einem href/src-Attribut.
        for (const zeile of text.split("\n")) {
          if (!zeile.includes(host)) continue;
          if (/(https?:)?\/\/[^\s"'`)]*/.test(zeile) && /["'`(=]\s*(https?:)?\/\//.test(zeile)) {
            funde.push(`${path.relative(process.cwd(), f)}: ${zeile.trim().slice(0, 120)}`);
          }
        }
      }
    }
    expect(funde, `Außenkontakt gefunden:\n${funde.join("\n")}`).toEqual([]);
  });

  it("keine Schrift und kein Stylesheet von einem fremden Host", () => {
    const funde: string[] = [];
    for (const f of dateien(process.cwd())) {
      if (f.endsWith(path.join("tests", "waechter.test.ts"))) continue;
      const text = fs.readFileSync(f, "utf8");
      // @import url(http…) und <link href="http…">
      for (const m of text.matchAll(/@import\s+url\(\s*["']?(https?:)?\/\//gi)) {
        funde.push(`${path.relative(process.cwd(), f)}: @import ${m[0]}`);
      }
      for (const m of text.matchAll(/<link[^>]+href\s*=\s*["'](https?:)?\/\/[^"']+/gi)) {
        funde.push(`${path.relative(process.cwd(), f)}: ${m[0].slice(0, 120)}`);
      }
    }
    expect(funde, `Externe Schrift/Stylesheet gefunden:\n${funde.join("\n")}`).toEqual([]);
  });
});
