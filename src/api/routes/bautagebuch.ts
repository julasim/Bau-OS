// ============================================================
// PATIO — Bautagebuch-Routes
// ============================================================
// Alle Routes laufen unter /projects/:projectName/bautagebuch[/...] —
// das matcht das URL-Pattern von Tasks/Termine im Projekt-Kontext und
// ermoeglicht ein einheitliches Schreibrecht: wer das Projekt sehen
// darf, darf auch Bautagebuch lesen/schreiben.
//
// Daten-Eingang:
//   - Datum als YYYY-MM-DD-String (Frontend liefert das Format aus
//     <input type="date">). Validierung im Repo via Regex.
//   - personnel als Array von { memberId?, name, hours?, role? }.
//
// Sichtbarkeit:
//   - Admin: alles.
//   - User: nur fuer Projekte aus user_projects-Junction.
//   - Im FS-Mode: 503, weil Bautagebuch nur im DB-Mode existiert.
// ============================================================

import { Hono } from "hono";
import { bautagebuchRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import type { BautagebuchUpsertInput } from "../../data/types.js";

export const bautagebuchRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

// Hilfsfunktion: Projekt-ID aus dem Pfad-Param (Name) aufloesen + ACL.
// Liefert null+Response, wenn kein Zugriff oder Projekt nicht existiert.
async function resolveProject(c: {
  req: { param: (k: string) => string };
  json: (obj: unknown, status?: number) => Response;
  var: { userId: string | null; userRole: "admin" | "user" };
}): Promise<{ id: string; name: string } | { error: Response }> {
  const projectName = decodeURIComponent(c.req.param("projectName") ?? "");
  if (!projectName) {
    return { error: c.json({ error: "Projektname fehlt" }, 400) };
  }
  if (!(await canSeeProjectByName(userCtx(c), projectName))) {
    return { error: c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403) };
  }
  const info = await projectRepo.getInfo(projectName);
  if (!info?.id) return { error: c.json({ error: "Projekt nicht gefunden" }, 404) };
  return { id: info.id, name: info.name };
}

// Guard: blockt alles wenn kein DB-Mode (bautagebuchRepo === null).
bautagebuchRoutes.use("/projects/:projectName/bautagebuch", async (c, next) => {
  if (!bautagebuchRepo) return c.json({ error: "Bautagebuch erfordert DB-Modus" }, 503);
  await next();
});
bautagebuchRoutes.use("/projects/:projectName/bautagebuch/*", async (c, next) => {
  if (!bautagebuchRepo) return c.json({ error: "Bautagebuch erfordert DB-Modus" }, 503);
  await next();
});
bautagebuchRoutes.use("/bautagebuch/*", async (c, next) => {
  if (!bautagebuchRepo) return c.json({ error: "Bautagebuch erfordert DB-Modus" }, 503);
  await next();
});

// ── Liste pro Projekt ─────────────────────────────────────────
bautagebuchRoutes.get("/projects/:projectName/bautagebuch", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 30, 1), 365) : 30;
  const entries = await bautagebuchRepo!.list(proj.id, limit);
  return c.json(entries);
});

// ── Einzeleintrag (Datum) ─────────────────────────────────────
bautagebuchRoutes.get("/projects/:projectName/bautagebuch/:date", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const date = c.req.param("date");
  const entry = await bautagebuchRepo!.get(proj.id, date);
  if (!entry) return c.json({ error: "Kein Eintrag fuer dieses Datum" }, 404);
  return c.json(entry);
});

// ── Upsert (PUT mit Datum im Pfad) ────────────────────────────
bautagebuchRoutes.put("/projects/:projectName/bautagebuch/:date", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const date = c.req.param("date");
  let body: BautagebuchUpsertInput;
  try {
    body = await c.req.json<BautagebuchUpsertInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await bautagebuchRepo!.upsert(proj.id, date, body, c.var.userId);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "bautagebuch", action: "saved", id: result.id, project: proj.name, data: { date } });
  return c.json(result);
});

// ── Delete ────────────────────────────────────────────────────
bautagebuchRoutes.delete("/projects/:projectName/bautagebuch/:date", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const date = c.req.param("date");
  const ok = await bautagebuchRepo!.delete(proj.id, date);
  if (ok) emit({ type: "bautagebuch", action: "deleted", project: proj.name, data: { date } });
  return c.json({ ok });
});

// ── Cross-Projekt: letzte Eintraege (Dashboard) ───────────────
bautagebuchRoutes.get("/bautagebuch/recent", async (c) => {
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 100) : 20;
  const visible = await getVisibleProjectIds(userCtx(c));
  const entries = await bautagebuchRepo!.listRecent(visible, limit);
  return c.json(entries);
});
