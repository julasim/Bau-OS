// ============================================================
// Bau-OS — Access-Layer fuer Multi-User-Scoping (Phase 4)
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
 *  "all". User ohne UUID (Legacy) oder ohne user_projects-Eintrag sehen
 *  einen leeren Scope — d.h. sie sehen NUR ihre persoenlichen Daten. */
export async function getVisibleProjectIds(ctx: UserCtx): Promise<VisibleScope> {
  if (ctx.role === "admin") return "all";
  if (!ctx.userId) return [];
  if (!projectRepo.listVisibleProjectIds) return [];
  return projectRepo.listVisibleProjectIds(ctx.userId);
}

/** Convenience: darf der User dieses spezifische Projekt sehen? */
export async function canSeeProject(ctx: UserCtx, projectId: string): Promise<boolean> {
  if (ctx.role === "admin") return true;
  if (!ctx.userId) return false;
  if (!projectRepo.listVisibleProjectIds) return false;
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
