// ============================================================
// PATIO — Projektbezug aus einer Anfrage
// ============================================================
// Die Routen adressieren Projekte ueber ihren NAMEN (`?project=Villa Mueller`
// bzw. `{ project: "…" }` im Body). Das ist gut lesbar und bleibt so — aber
// der Name ist aenderbar. Wer sich einen Aufruf merkt, ein Lesezeichen setzt
// oder spaeter ueber MCP abfragt, verliert den Bezug beim ersten Umbenennen,
// und zwar STILL: die Antwort ist dann eine leere Liste, kein Fehler.
//
// Deshalb versteht jede dieser Stellen zusaetzlich `projectId` — die
// unveraenderliche UUID. Aufgeloest wird sie hier an EINER Stelle auf den
// Namen, mit dem die Repos weiterarbeiten. Der umgekehrte Weg (alle Repos auf
// IDs umstellen) waere die sauberere Architektur, aber ein Umbau quer durch
// zwoelf Dateien fuer einen Gewinn, den diese Aufloesung genauso liefert.
//
// ── Die dritte Form: `projektnummer` (Migration 052) ────────────────────────
//
// Die UUID ist stabil, aber unlesbar. Kein Mensch merkt sich
// `9db792d3-8042-…`, und in einem Dokument, einer Mail oder einer Frage an die
// KI steht sie nie. Was dort steht, ist `SAZTG-2026-014`.
//
// Seit Migration 052 ist die Projektnummer Pflicht und eindeutig — damit ist
// sie genauso belastbar wie die UUID und obendrein aussprechbar. Sie loest die
// UUID nach aussen ab: was frueher `?projectId=<uuid>` war, ist jetzt
// `?projektnummer=SAZTG-2026-014`.
//
// **An der Rechtepruefung aendert das nichts.** Diese Datei liefert nur einen
// NAMEN; ob der Fragende das Projekt sehen darf, entscheidet danach wie bisher
// die Route (`canSeeProjectByName`, `getVisibleProjectIds`). Eine Nummer ist
// damit kein zweiter Weg an den Rechten vorbei, sondern ein zweiter Weg zum
// selben Tor.
//
// Vorrang: `projectId` > `projektnummer` > `project`. Wer eine unveraenderliche
// Kennung mitschickt, meint sie; der Name ist die schwaechste Angabe, weil er
// sich aendern kann.
// ============================================================

import { projectRepo } from "../data/index.js";

/** Wo der Projektbezug herkommen kann. Beide Formen sind optional — fehlt
 *  beides, ist die Anfrage projektuebergreifend gemeint. */
export interface ProjektAngabe {
  project?: string | null;
  projectId?: string | null;
  /** Die vom Buero vergebene Kennung, z. B. `SAZTG-2026-014` (Migration 052). */
  projektnummer?: string | null;
}

/** Ergebnis der Aufloesung.
 *
 *  `unbekannt` unterscheidet den Fall „ID zeigt ins Leere" von „kein
 *  Projektbezug angegeben". Ohne diese Unterscheidung liefe eine veraltete ID
 *  auf eine projektuebergreifende Abfrage hinaus — der Aufrufer bekaeme MEHR
 *  zu sehen, nicht weniger, und das ist bei Rechten die falsche Richtung. */
export type ProjektBezug = { name: string | null; unbekannt: false } | { name: null; unbekannt: true };

/** Loest `projectId` (UUID), `projektnummer` (Kennung) oder `project` (Name)
 *  auf den Projektnamen auf — in dieser Reihenfolge. */
export async function projektBezug(angabe: ProjektAngabe): Promise<ProjektBezug> {
  if (angabe.projectId) {
    if (!projectRepo.nameById) return { name: null, unbekannt: true };
    const name = await projectRepo.nameById(String(angabe.projectId));
    return name ? { name, unbekannt: false } : { name: null, unbekannt: true };
  }
  if (angabe.projektnummer) {
    if (!projectRepo.nameByNummer) return { name: null, unbekannt: true };
    const name = await projectRepo.nameByNummer(String(angabe.projektnummer));
    // `unbekannt` und nicht „kein Bezug": eine Nummer, die ins Leere zeigt,
    // darf nicht auf die projektuebergreifende Liste hinauslaufen. Der
    // Aufrufer bekaeme MEHR zu sehen, nicht weniger — bei Rechten die falsche
    // Richtung. Dieselbe Ueberlegung wie bei `projectId`.
    return name ? { name, unbekannt: false } : { name: null, unbekannt: true };
  }
  if (angabe.project) return { name: String(angabe.project), unbekannt: false };
  return { name: null, unbekannt: false };
}

/** Bequemlichkeit fuer Routen, die den Bezug aus der Abfragezeichenfolge
 *  ziehen. */
export async function projektBezugAusQuery(c: {
  req: { query: (k: string) => string | undefined };
}): Promise<ProjektBezug> {
  return projektBezug({
    project: c.req.query("project"),
    projectId: c.req.query("projectId"),
    projektnummer: c.req.query("projektnummer"),
  });
}
