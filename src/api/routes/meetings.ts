// ============================================================
// PATIO — Meeting-Routes
// ============================================================
// Meetings haengen am Projekt — Routing analog zum Bautagebuch:
//   GET    /projects/:projectName/meetings           → Liste
//   POST   /projects/:projectName/meetings           → Neu anlegen
//   GET    /meetings/:id                             → Einzeln
//   PATCH  /meetings/:id                             → Aktualisieren
//   DELETE /meetings/:id                             → Loeschen
//   GET    /meetings/recent                          → Cross-Projekt
//
// Lese-/Schreibrecht koppeln wir an die Projekt-ACL: wer das Projekt
// sehen darf, darf auch Meetings dazu lesen und anlegen. Fuer Detail-
// /Update-/Delete-Routes (die nur die Meeting-ID kennen) loesen wir das
// Projekt aus der Meeting-Row und pruefen dann.
// ============================================================

import { Hono } from "hono";
import { meetingRepo, projectRepo } from "../../data/index.js";
import { canSeeProject, canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import type { MeetingInput } from "../../data/types.js";

export const meetingsRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

// Hilfsfunktion: Projekt-ID aus dem Pfad-Param + ACL.
async function resolveProject(c: {
  req: { param: (k: string) => string };
  json: (obj: unknown, status?: number) => Response;
  var: { userId: string | null; userRole: "admin" | "user" };
}): Promise<{ id: string; name: string } | { error: Response }> {
  const projectName = decodeURIComponent(c.req.param("projectName") ?? "");
  if (!projectName) return { error: c.json({ error: "Projektname fehlt" }, 400) };
  if (!(await canSeeProjectByName(userCtx(c), projectName))) {
    return { error: c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403) };
  }
  const info = await projectRepo.getInfo(projectName);
  if (!info?.id) return { error: c.json({ error: "Projekt nicht gefunden" }, 404) };
  return { id: info.id, name: info.name };
}

// ── Liste pro Projekt ─────────────────────────────────────────
meetingsRoutes.get("/projects/:projectName/meetings", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200) : 50;
  // `?vor=YYYY-MM-DD` blaettert nach hinten — siehe bautagebuch.ts.
  const meetings = await meetingRepo.list(proj.id, limit, c.req.query("vor"));
  return c.json(meetings);
});

// ── Neu anlegen ──────────────────────────────────────────────
meetingsRoutes.post("/projects/:projectName/meetings", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  let body: MeetingInput;
  try {
    body = await c.req.json<MeetingInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await meetingRepo.create(proj.id, body, c.var.userId);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "meeting", action: "created", id: result.id, projectId: proj.id }, { actorId: c.var.userId });
  return c.json(result, 201);
});

// ── Einzeln ───────────────────────────────────────────────────
// ── Cross-Projekt ────────────────────────────────────────────
//
// ⚠ MUSS VOR `/meetings/:id` STEHEN. Hono trifft in Registrierungsreihenfolge:
// stand diese Route weiter unten, landete `/meetings/recent` bei `:id`, das
// Repository suchte eine Besprechung mit der ID „recent" und die Antwort war
// 404. Die Route war damit seit ihrem Bau unerreichbar.
//
// Dieselbe Falle steht in `projects.ts:207` ausdruecklich kommentiert — und
// wurde hier trotzdem gemacht. Beim naechsten `/…/recent` daran denken.
meetingsRoutes.get("/meetings/recent", async (c) => {
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 100) : 20;
  const visible = await getVisibleProjectIds(userCtx(c));
  const meetings = await meetingRepo.listRecent(visible, limit);
  return c.json(meetings);
});

meetingsRoutes.get("/meetings/:id", async (c) => {
  const id = c.req.param("id");
  const meeting = await meetingRepo.get(id);
  if (!meeting) return c.json({ error: "Meeting nicht gefunden" }, 404);
  // ── Warum ueber die ID und nicht ueber den Projektnamen ─────────────────
  //
  // Hier stand `if (ctx.role !== "admin" && meeting.projectName)`. Das ist ein
  // Skip-Muster: fehlt der Projektname, faellt die GANZE Pruefung aus, und der
  // Datensatz wird ausgeliefert. Heute ist der Fall nicht ausloesbar
  // (`project_id` ist NOT NULL, der Name kommt aus dem Join) — aber es ist
  // eine gestellte Falle: ein LEFT JOIN, ein umbenanntes Feld, ein Projekt im
  // Papierkorb, und die Rechtepruefung schaltet sich still ab.
  //
  // Ueber die UUID gibt es den Fall gar nicht erst. Nebenbei spart es die
  // Namensaufloesung, die `canSeeProjectByName` sonst zusaetzlich macht.
  const ctx = userCtx(c);
  if (!(await canSeeProject(ctx, meeting.projectId))) {
    return c.json({ error: "Kein Zugriff" }, 403);
  }
  return c.json(meeting);
});

// ── Aktualisieren ────────────────────────────────────────────
meetingsRoutes.patch("/meetings/:id", async (c) => {
  const id = c.req.param("id");
  const meeting = await meetingRepo.get(id);
  if (!meeting) return c.json({ error: "Meeting nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (!(await canSeeProject(ctx, meeting.projectId))) {
    return c.json({ error: "Kein Zugriff" }, 403);
  }

  let body: Partial<MeetingInput>;
  try {
    body = await c.req.json<Partial<MeetingInput>>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await meetingRepo.update(id, body);
  if (typeof result === "string") return c.json({ error: result }, 400);
  if (!result) return c.json({ error: "Meeting nicht gefunden" }, 404);
  emit({ type: "meeting", action: "updated", id, projectId: meeting.projectId }, { actorId: c.var.userId });
  return c.json(result);
});

// ── Loeschen ─────────────────────────────────────────────────
meetingsRoutes.delete("/meetings/:id", async (c) => {
  const id = c.req.param("id");
  const meeting = await meetingRepo.get(id);
  if (!meeting) return c.json({ ok: false }, 404);
  const ctx = userCtx(c);
  if (!(await canSeeProject(ctx, meeting.projectId))) {
    return c.json({ error: "Kein Zugriff" }, 403);
  }
  const ok = await meetingRepo.delete(id);
  if (ok) emit({ type: "meeting", action: "deleted", id, projectId: meeting.projectId }, { actorId: c.var.userId });
  return c.json({ ok });
});
