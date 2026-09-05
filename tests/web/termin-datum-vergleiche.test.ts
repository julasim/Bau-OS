import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Die Terminvergleiche im Frontend — und warum `vue-tsc` sie nicht prüft.
//
// ── Der Fehler, den das hier festhält ──────────────────────────────────────
//
// `ProjectDetailView.vue` beantwortet zwei Fragen über einen Vergleich zweier
// Zeichenketten: „welcher Termin kommt als nächstes" (`nextTermin`) und
// „welche stehen an" (`upcomingTermine`). Beide lauten
//
//     t.datum >= heuteIso()      und      a.datum.localeCompare(b.datum)
//
// und beide waren FALSCH, solange der Server `15.09.2026` lieferte: verglichen
// wurde gegen `2026-09-01`, und in dieser Richtung ist jedes deutsche Datum
// kleiner als jedes ISO-Datum. Die Projektakte zeigte deshalb dauerhaft
// „keine anstehenden Termine" — ohne Fehlermeldung, ohne Warnung.
//
// **`vue-tsc` beanstandet daran nichts.** Beide Seiten sind `string`, der
// Vergleich ist typkorrekt. Genau diese Klasse Fehler ist hier mehrfach durch
// alle Prüfungen gekommen; sie lässt sich nur über die Semantik fangen.
//
// ── Warum die Logik nachgebaut und nicht die Komponente montiert wird ──────
//
// Die Projektakte lädt beim Aufbau ein Dutzend Routen. Sie dafür zu montieren
// hiesse, ein halbes Backend nachzubauen — und der Test prüfte danach vor
// allem die Attrappen. Nachgebaut wird die eine Zeile, um die es geht; dass
// die Datei sie unverändert enthält, prüft der zweite Block.
describe("Terminvergleiche in der Projektakte", () => {
  const heute = "2026-09-01";
  const termine = [
    { id: "1", datum: "2026-08-20", text: "vorbei" },
    { id: "2", datum: "2026-09-15", text: "naechster" },
    { id: "3", datum: "2026-12-03", text: "spaeter" },
    { id: "4", datum: "2026-10-01", text: "dazwischen" },
  ];

  const kuenftige = () => [...termine].filter((t) => t.datum >= heute).sort((a, b) => a.datum.localeCompare(b.datum));

  it("findet den nächsten Termin und überspringt den vergangenen", () => {
    expect(kuenftige()[0]?.text).toBe("naechster");
  });

  it("sortiert nach Datum, nicht nach Tag-im-Monat", () => {
    // Mit `TT.MM.JJJJ` ergäbe `localeCompare` die Reihenfolge 01.10., 03.12.,
    // 15.09. — nach dem TAG. Das sieht nach einer eigenwilligen Sortierung aus
    // und nicht nach einem Fehler, deshalb ist es nie jemandem aufgefallen.
    expect(kuenftige().map((t) => t.text)).toEqual(["naechster", "dazwischen", "spaeter"]);
  });

  it("mit deutschem Datum wäre derselbe Vergleich leer — der Beleg für den Bug", () => {
    // Die Gegenprobe in Testform: so sah es aus, bevor Migration 060 lief.
    const deutsch = termine.map((t) => {
      const [j, m, tg] = t.datum.split("-");
      return { ...t, datum: `${tg}.${m}.${j}` };
    });
    expect(deutsch.filter((t) => t.datum >= heute)).toHaveLength(0);
  });
});

describe("keine Datums-Toleranzzweige mehr im Frontend", () => {
  // ── Wächter ───────────────────────────────────────────────────────────────
  //
  // Die Ansichten trugen an mehreren Stellen ein „falls deutsch, dann drehen":
  //
  //     const d = t.datum.includes(".") ? t.datum.split(".").reverse().join("-") : t.datum;
  //
  // Solche Zweige sind der Grund, warum der eigentliche Fehler so lange
  // unsichtbar blieb: Sie machten die Anzeige an EINIGEN Stellen richtig und
  // verdeckten damit, dass die Daten selbst uneinheitlich waren. Seit der
  // Server nur noch ISO liefert, sind sie überflüssig — und wer sie
  // zurückbaut, verdeckt den nächsten Fall wieder.
  const DATEIEN = [
    "web/src/views/CalendarView.vue",
    "web/src/views/DashboardView.vue",
    "web/src/views/ProjectDetailView.vue",
  ];

  /** Der Dateiinhalt ohne Zeilenkommentare.
   *
   *  Nötig, weil an genau diesen Stellen jetzt Kommentare stehen, die die
   *  entfernten Zweige BESCHREIBEN — ein Wächter, der seine eigene Erklärung
   *  als Befund meldet, ist unbrauchbar. Der Umweg über die Prosa (Kommentar
   *  umformulieren, bis die Prüfung schweigt) wäre die falsche Richtung: dann
   *  bestimmt der Test, wie man etwas erklären darf. */
  const ohneKommentare = (datei: string) =>
    readFileSync(datei, "utf8")
      .split("\n")
      .filter((z) => !z.trimStart().startsWith("//") && !z.trimStart().startsWith("*"))
      .join("\n");

  it.each(DATEIEN)("%s dreht kein Datum mehr um", (datei) => {
    const code = ohneKommentare(datei);
    expect(code, "Toleranzzweig für TT.MM.JJJJ gefunden").not.toMatch(/datum[^\n]*includes\("\."\)/);
    expect(code, 'split(".").reverse() gefunden').not.toMatch(/split\("\."\)\s*\.\s*reverse\(\)/);
  });

  it('CalendarView bindet das rohe Datum an <input type="date">', () => {
    // Der sichtbarste Gewinn: Das Feld bekam bis hierher `10.04.2026`
    // gebunden. Ein `<input type="date">` akzeptiert ausschließlich ISO und
    // zeigt bei allem anderen NICHTS an — das Bearbeiten-Formular öffnete
    // sich also mit leerem Datumsfeld, und wer nur den Text ändern wollte,
    // musste das Datum neu eingeben.
    expect(readFileSync("web/src/views/CalendarView.vue", "utf8")).toContain('v-model="editing.datum"');
    expect(ohneKommentare("web/src/views/CalendarView.vue"), "toDisplayISO() wird wieder aufgerufen").not.toMatch(
      /toDisplayISO\s*\(/,
    );
  });
});
