// ============================================================
// PATIO — „Heute" auf dem Server
// ============================================================
//
// ── Warum das nicht `new Date()` ist ───────────────────────────────────────
//
// Weil „heute" eine Frage der ZEITZONE DES BUEROS ist, nicht der des
// Prozesses. Ein Container laeuft ueblicherweise auf UTC; um 01:00 Uhr
// oesterreichischer Zeit ist dort noch der Vortag. Ein Board, das um kurz
// nach Mitternacht schon den naechsten Tag zeigt — oder umgekehrt um 01:00
// noch den vorigen —, ist falsch, und zwar auf eine Art, die niemandem
// auffaellt: es sieht aus wie ein ruhiger Tag.
//
// Genau diese Klasse Fehler wurde am 24.08.2026 an sieben Stellen im Frontend
// gefunden. Serverseitig stand die richtige Antwort nur an einer Stelle,
// privat in `routes/board.ts` — und `routes/dashboard.ts` beantwortete
// dieselbe Frage daneben anders (`toLocaleDateString` auf der Prozesszeit).
//
// ── Warum die Datenbank gefragt wird und nicht `Intl` ──────────────────────
//
// Weil sie es ohnehin tut. Alle Vergleiche laufen gegen `date`- und
// `timestamptz`-Spalten in derselben Datenbank; „heute" aus einer anderen
// Quelle zu holen hiesse, zwei Uhren gegeneinander laufen zu lassen. Der
// Wartungslauf (`src/maintenance.ts`) rechnet aus demselben Grund
// `now() AT TIME ZONE ${TIMEZONE}`.
// ============================================================

import { getDb } from "../db/client.js";
import { TIMEZONE } from "../config.js";

/** Der heutige Tag in der Zeitzone des Bueros, als `YYYY-MM-DD`. */
export async function heuteIso(): Promise<string> {
  const [z] = await getDb()`SELECT to_char(now() AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS t`;
  return String(z.t);
}
