// ============================================================
// PATIO — Serveradresse merken
// ============================================================
// Das Gegenstueck zum `vault-store` aus PATIO Desktop. Dort merkte sich die
// Huelle einen ORDNER, hier merkt sie sich eine ADRESSE — sonst ist es
// dieselbe Sache: eine JSON-Datei im userData-Verzeichnis, ein zuletzt
// genutzter Eintrag plus eine kurze Liste, alles „best effort" ohne Absturz
// bei kaputter Datei.
//
// Aufloesungsreihenfolge beim Start:
//   1. gemerkte Adresse (diese Datei)
//   2. `PATIO_SERVER` aus der Umgebung
//   3. Einrichtungsseite
//
// Die Reihenfolge ist mit Absicht so und nicht andersherum: wer die Adresse
// einmal im Programm eingetragen hat, soll sie nicht durch eine vergessene
// Umgebungsvariable ueberschrieben bekommen. Dieselbe Falle ist in PATIO
// Desktop schon einmal aufgetreten — dort band ein zweiter Start trotz
// abweichendem `VAULT_PATH` weiter den gemerkten Vault, und die Pruefung
// „bewies" eine Trennung, die es nicht gab.
// ============================================================

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// Die reine Adress-Logik liegt getrennt, damit sie ohne Electron pruefbar ist.
export { normalisiereAdresse } from "./adresse.js";

export interface ServerConfig {
  lastServer: string | null;
  recent: string[];
}

const RECENT_MAX = 8;

function configFile(): string {
  return path.join(app.getPath("userData"), "patio-server.json");
}

export function loadConfig(): ServerConfig {
  try {
    const raw = fs.readFileSync(configFile(), "utf-8");
    const c = JSON.parse(raw) as Partial<ServerConfig>;
    return {
      lastServer: typeof c.lastServer === "string" ? c.lastServer : null,
      recent: Array.isArray(c.recent) ? c.recent.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    // Keine Datei / kaputt → leere Konfiguration.
    return { lastServer: null, recent: [] };
  }
}

function saveConfig(c: ServerConfig): void {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(c, null, 2), "utf-8");
  } catch (err) {
    console.error("[Server-Store] Konfiguration konnte nicht gespeichert werden:", err);
  }
}

/** Merkt eine Adresse als zuletzt genutzt und schiebt sie an die Spitze der
 *  Liste (Duplikate raus, auf RECENT_MAX begrenzt). */
export function rememberServer(url: string): void {
  const c = loadConfig();
  const recent = [url, ...c.recent.filter((x) => x !== url)].slice(0, RECENT_MAX);
  saveConfig({ lastServer: url, recent });
}

export function getRecent(): string[] {
  return loadConfig().recent;
}
