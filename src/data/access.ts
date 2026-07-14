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

export interface UserCtx {
  /** UUID des Users. null bei Legacy-JSON-Konten ohne UUID. */
  userId: string | null;
  /** Rolle bestimmt den Scope. Bei "admin" wird kein Filter angewendet. */
  role: "admin" | "user";
}

/** Sentinel-Wert fuer Admins — bedeutet "kein Filter, alle sichtbar". Repos
 *  unterscheiden Array (filtered) vs "all" (no filter). */
export type VisibleScope = string[] | "all";

/** Liefert die UUID-Liste sichtbarer Projekte fuer den User. Admins kriegen
 *  "all".
 *
 *  Wichtig: wenn das Repo gar keine ACL-Methode hat (FS-Mode), bekommt der
 *  User AUCH "all". Begruendung: FS-Mode unterstuetzt keine Multi-User-
 *  Trennung; Legacy-Verhalten = "alles sichtbar fuer alle authentifizierten".
 *  Nur im DB-Mode mit aktiviertem Multi-User filtert getVisibleProjectIds
 *  tatsaechlich.
 *
 *  User mit DB-Mode aber ohne UUID (defekte JWTs) kriegen []. */
export async function getVisibleProjectIds(ctx: UserCtx): Promise<VisibleScope> {
  if (ctx.role === "admin") return "all";
  if (!projectRepo.listVisibleProjectIds) return "all"; // FS-Mode → keine ACL
  if (!ctx.userId) return [];
  return projectRepo.listVisibleProjectIds(ctx.userId);
}

/** Convenience: darf der User dieses spezifische Projekt sehen? */
export async function canSeeProject(ctx: UserCtx, projectId: string): Promise<boolean> {
  if (ctx.role === "admin") return true;
  // FS-Mode hat keine ACL → jeder authentifizierte User darf alles sehen.
  if (!projectRepo.listVisibleProjectIds) return true;
  if (!ctx.userId) return false;
  const ids = await projectRepo.listVisibleProjectIds(ctx.userId);
  return ids.includes(projectId);
}

/** Convenience-Variante: nimmt den Projekt-NAMEN statt UUID — kommt in
 *  vielen Routes als Path-Param vor. */
export async function canSeeProjectByName(ctx: UserCtx, name: string): Promise<boolean> {
  if (ctx.role === "admin") return true;
  const info = await projectRepo.getInfo(name);
  if (!info?.id) return false;
  return canSeeProject(ctx, info.id);
}
