import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Die Betriebsskripte werden von keiner Prüfung angefasst — bis hierher.
//
// ── Der Fehler, der diese Datei ausgelöst hat ──────────────────────────────
//
// `scripts/backup.sh` endete mit
//
//     [ "$UNBRAUCHBAR" -gt 0 ] && log "HINWEIS: …"
//
// Ist die Zahl 0 — also im NORMALFALL —, hat diese Zeile den Status 1. Weil es
// die letzte Zeile war, war das der Exit-Code des ganzen Skripts. Die Sicherung
// lief sauber durch und meldete trotzdem Fehlschlag.
//
// Die Folgen trafen nicht den Ausnahme-, sondern den Regelfall: der
// `OnFailure=`-Dienst der systemd-Einheit feuerte nach JEDER erfolgreichen
// Nacht, und `update-offline.sh` bricht ab, wenn die Sicherung fehlschlägt —
// der Server wäre damit nicht mehr aktualisierbar gewesen.
//
// Gemessen am 30.08.2026 auf Ubuntu 24.04 (bash 5.2.21): Exit 1 bei
// erfolgreichem Lauf, Exit 0 nach dem Fix.
//
// ── Warum ein Test und nicht nur ein Fix ──────────────────────────────────
//
// Die Konstruktion ist bequem und wird beim nächsten Skript wieder
// hingeschrieben. Sie ist auch nicht falsch — nur als LETZTE Zeile eines
// Skripts ist sie es. Genau das prüft der erste Test.

const SCRIPTS = "scripts";

/** Alle Server-Skripte (.sh) — die, die auf dem Firmenserver laufen. */
function serverSkripte(): string[] {
  return readdirSync(SCRIPTS)
    .filter((n) => n.endsWith(".sh"))
    .map((n) => join(SCRIPTS, n));
}

/** Letzte Zeile mit Inhalt, ohne Kommentare und Leerzeilen. */
function letzteAnweisung(inhalt: string): string {
  const zeilen = inhalt
    .split("\n")
    .map((z) => z.trim())
    .filter((z) => z !== "" && !z.startsWith("#"));
  return zeilen[zeilen.length - 1] ?? "";
}

describe("Betriebsskripte", () => {
  it("kein Skript endet mit einer nackten AND-Liste (Exit-Code-Falle)", () => {
    const befunde: string[] = [];
    for (const datei of serverSkripte()) {
      const letzte = letzteAnweisung(readFileSync(datei, "utf8"));
      // `[ … ] && cmd` als letzte Anweisung: schlägt der Test fehl, ist der
      // Exit-Code des Skripts 1 — obwohl nichts schiefgelaufen ist.
      if (/^\[.*\]\s*&&/.test(letzte) || /^\[\[.*\]\]\s*&&/.test(letzte)) {
        befunde.push(`${datei}: ${letzte}`);
      }
    }
    expect(befunde).toEqual([]);
  });

  it("die Skripte, die einen Status melden, enden mit einem ausdrücklichen exit", () => {
    // `backup.sh` wird von `update-offline.sh` und vom systemd-Timer über
    // seinen Exit-Code bewertet. Bei einem Skript, dessen Status jemand
    // AUSWERTET, darf der Code nicht davon abhängen, was zufällig zuletzt
    // ausgeführt wurde.
    const inhalt = readFileSync(join(SCRIPTS, "backup.sh"), "utf8");
    expect(letzteAnweisung(inhalt)).toBe("exit 0");
  });

  it("alle Server-Skripte sind syntaktisch gültig (bash -n)", () => {
    // Fängt die Klasse Fehler, die sonst erst um drei Uhr nachts auffällt.
    for (const datei of serverSkripte()) {
      expect(() => execFileSync("bash", ["-n", datei], { stdio: "pipe" })).not.toThrow();
    }
  });

  it("backup.sh setzt genau EINEN EXIT-trap", () => {
    // Zwei `trap … EXIT` ersetzen einander stillschweigend. Vor dem Fix gab es
    // einen für den Prüf-Container; ein zweiter für den abgebrochenen
    // Sicherungsstand hätte ihn verdrängt — und dann bliebe bei jedem Abbruch
    // während der Selbstprüfung ein postgres:16-Container stehen.
    const inhalt = readFileSync(join(SCRIPTS, "backup.sh"), "utf8");
    const traps = inhalt.split("\n").filter((z) => /^\s*trap\s+[^-]/.test(z));
    expect(traps).toHaveLength(1);
  });
});
