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
// Vorrang hat `projectId`: wer beides schickt, meint die stabile Kennung.
// ============================================================

import { projectRepo } from "../data/index.js";

/** Wo der Projektbezug herkommen kann. Beide Formen sind optional — fehlt
 *  beides, ist die Anfrage projektuebergreifend gemeint. */
export interface ProjektAngabe {
  project?: string | null;
  projectId?: string | null;
}

/** Ergebnis der Aufloesung.
 *
 *  `unbekannt` unterscheidet den Fall „ID zeigt ins Leere" von „kein
 *  Projektbezug angegeben". Ohne diese Unterscheidung liefe eine veraltete ID
 *  auf eine projektuebergreifende Abfrage hinaus — der Aufrufer bekaeme MEHR
 *  zu sehen, nicht weniger, und das ist bei Rechten die falsche Richtung. */
export type ProjektBezug = { name: string | null; unbekannt: false } | { name: null; unbekannt: true };

/** Loest `project` (Name) oder `projectId` (UUID) auf den Projektnamen auf. */
export async function projektBezug(angabe: ProjektAngabe): Promise<ProjektBezug> {
  if (angabe.projectId) {
    if (!projectRepo.nameById) return { name: null, unbekannt: true };
    const name = await projectRepo.nameById(String(angabe.projectId));
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
  return projektBezug({ project: c.req.query("project"), projectId: c.req.query("projectId") });
}
