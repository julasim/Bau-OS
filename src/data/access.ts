// ============================================================
// PATIO — Access-Layer fuer Multi-User-Scoping (Phase 4)
// ============================================================
// Zentrale Stelle fuer "wer darf was sehen". Repos rufen die Helper auf
// und bauen ihre WHERE-Klauseln entsprechend, anstatt sich die Logik selbst
// aus user_projects zusammenzuzimmern.
//
// Sichtbarkeitsregeln (siehe Plan-Datei):
//   - Admin: sieht alles. getVisibleProjectIds() liefert "all".
//   - User:  sieht nur Projekte aus user_projects-Junction.
//   - Tasks/Termine ohne project_id sind persoenlich:
//       Tasks: created_by = me ODER assignee_id = me
//       Termine: created_by = me ODER me = ANY(assignee_ids)
//       Notizen: created_by = me
//   - Files ohne project_id: uploaded_by = me ODER file_shares-Match
// ============================================================

import { projectRepo } from "./index.js";

/**
 * Die drei Rollen.
 *
 * ── Warum „praesentation" eine echte Rolle ist und kein Schalter ──────────
 *
 * Weil sie an DREI Stellen etwas anderes bedeutet, und zwar serverseitig:
 *
 *   * Sichtbarkeit — sie sieht ALLE Projekte (im Besprechungsraum haengt das
 *     Portfolio an der Wand), aber nicht als Admin.
 *   * Schreiben — gar nicht. Ein Geraet, an dem niemand angemeldet ist und
 *     das den ganzen Tag laeuft, darf nichts aendern koennen.
 *   * Geld und Personendaten — nie. In dem Raum sitzen auch Bauherren.
 *
 * Als „Admin mit CSS-Maske" gebaut waere das keine Rolle, sondern eine
 * Verkleidung: die Daten gingen weiterhin ueber die Leitung, und ein Blick in
 * die Entwicklerwerkzeuge zeigte sie.
 */
export type Rolle = "admin" | "user" | "praesentation";

/** Ein unbekanntes Rollenwort wird zu `user` — der Rolle mit den WENIGSTEN
 *  Rechten, die noch anmelden darf. Die Umkehrung (unbekannt → admin) waere
 *  die klassische Rechteausweitung durch einen Tippfehler. */
export function alsRolle(wert: unknown): Rolle {
  return wert === "admin" || wert === "praesentation" ? wert : "user";
}

export interface UserCtx {
  /** UUID des Users. null bei Legacy-JSON-Konten ohne UUID. */
  userId: string | null;
  /** Rolle bestimmt den Scope. Bei "admin" wird kein Filter angewendet. */
  role: Rolle;
}

/** Sentinel-Wert fuer Admins — bedeutet "kein Filter, alle sichtbar". Repos
 *  unterscheiden Array (filtered) vs "all" (no filter). */
export type VisibleScope = string[] | "all";

/** Liefert die UUID-Liste sichtbarer Projekte fuer den User. Admins kriegen
 *  "all".
 *
 *  `listVisibleProjectIds` ist an der Repository-Schnittstelle noch als
 *  optional deklariert — ein Rest aus der Zeit, als es neben Postgres einen
 *  Dateisystem-Modus gab. Das Postgres-Repo bringt die Methode immer mit.
 *  Fehlt sie wider Erwarten, gilt "nichts sichtbar": frueher stand hier das
 *  Gegenteil ("alles sichtbar"), und ein Rueckfall, der im Zweifel MEHR
 *  freigibt, ist an dieser Stelle die falsche Richtung.
 *
 *  User ohne UUID (defekte JWTs) kriegen []. */
export async function getVisibleProjectIds(ctx: UserCtx): Promise<VisibleScope> {
  if (ctx.role === "admin") return "all";
  // Das Board zeigt das ganze Buero — es haengt im Besprechungsraum und
  // beantwortet die Frage „was ist heute los". Ein Board, das nur einen
  // Ausschnitt zeigt, waere irrefuehrend.
  //
  // Dass es dabei KEINE Betraege und KEINE Personendaten sieht, haengt nicht
  // an dieser Zeile, sondern an zwei eigenen Filtern (src/api/geld.ts,
  // src/api/personendaten.ts) — und dass es nichts schreiben kann, an einer
  // Middleware vor allen Routen.
  if (ctx.role === "praesentation") return "all";
  if (!projectRepo.listVisibleProjectIds) return [];
  if (!ctx.userId) return [];
  return projectRepo.listVisibleProjectIds(ctx.userId);
}

/** Convenience: darf der User dieses spezifische Projekt sehen?
 *
 *  ── Warum hier dieselbe Ausnahme steht wie oben ──────────────────────────
 *
 *  Weil sie sonst nur die halbe Wahrheit waere. `getVisibleProjectIds` gab dem
 *  Board „alle" — die Listen zeigten also jedes Projekt —, waehrend jede
 *  Detailroute mit 403 antwortete. Ein Board, dessen Kacheln sich nicht
 *  oeffnen lassen, sieht nach einem Defekt aus und ist einer.
 *
 *  Was das Board damit erreicht, steht nicht hier, sondern in
 *  `tests/api-board.test.ts` als Positivliste — eine Rolle, deren Reichweite
 *  nirgends festgehalten ist, waechst beim naechsten Umbau lautlos mit.
 *
 *  Nicht mit dieser Zeile geoeffnet werden Dateien: `canAccessFile`
 *  (src/api/routes/files.ts) fragt `listVisibleProjectIds(userId)` DIREKT,
 *  nicht ueber diese Funktion, und ein Anzeigekonto hat keine
 *  `user_projects`-Zeilen. Dass der Dateizugriff damit ueber einen anderen
 *  Weg geprueft wird als alles andere, ist eine Unstimmigkeit — sie zeigt
 *  aber in die sichere Richtung, und ein Board braucht keine Plaene. */
export async function canSeeProject(ctx: UserCtx, projectId: string): Promise<boolean> {
  if (ctx.role === "admin") return true;
  if (ctx.role === "praesentation") return true;
  // Gleiche Richtung wie oben: fehlt die ACL-Methode, wird nichts freigegeben.
  if (!projectRepo.listVisibleProjectIds) return false;
  if (!ctx.userId) return false;
  const ids = await projectRepo.listVisibleProjectIds(ctx.userId);
  return ids.includes(projectId);
}

/** Convenience-Variante: nimmt den Projekt-NAMEN statt UUID — kommt in
 *  vielen Routes als Path-Param vor.
 *
 *  Die Ausnahme fuer die Praesentationsrolle steht bewusst NICHT auch hier,
 *  sondern nur in `canSeeProject`, an das diese Funktion durchreicht: eine
 *  eigene Zeile vor dem `getInfo` wuerde fuer ein Projekt, das es gar nicht
 *  gibt, `true` liefern — die Route antwortete dann 404 statt 403, je
 *  nachdem, welche Pruefung zuerst kommt. Ein Rechtepfad, der bei
 *  Nichtexistenz freigibt, ist die falsche Bauform, auch wenn er hier
 *  folgenlos bliebe. */
export async function canSeeProjectByName(ctx: UserCtx, name: string): Promise<boolean> {
  if (ctx.role === "admin") return true;
  const info = await projectRepo.getInfo(name);
  if (!info?.id) return false;
  return canSeeProject(ctx, info.id);
}
