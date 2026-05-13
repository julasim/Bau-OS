import { Hono } from "hono";
import { noteRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";

export const notesRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

notesRoutes.get("/notes", async (c) => {
  const detailed = c.req.query("detailed");
  const ctx = userCtx(c);

  // Detailed-Mode: liefert Project-Info pro Notiz, also filtern wir hier.
  if (detailed === "1" && noteRepo.listDetailed) {
    const notes = await noteRepo.listDetailed(50);
    if (ctx.role === "admin") return c.json(notes);
    const visible = await getVisibleProjectIds(ctx);
    if (visible === "all") return c.json(notes);
    const visibleNames = new Set(await projectRepo.list(visible));
    // Notizen ohne Projekt: nur Admin sieht sie. Nicht-Admin-User sehen
    // sie aktuell nicht, weil createdBy noch nicht im DTO ist (TODO Phase 5+).
    const filtered = notes.filter((n) => n.project && visibleNames.has(n.project));
    return c.json(filtered);
  }

  // Simple-Mode (nur Titel): wir muessen auch hier den User-Scope respektieren.
  // Loesung: fuer Non-Admins via listDetailed laufen, dann auf Titles mappen.
  if (ctx.role !== "admin" && noteRepo.listDetailed) {
    const visible = await getVisibleProjectIds(ctx);
    if (visible !== "all") {
      const visibleNames = new Set(await projectRepo.list(visible));
      const detailed = await noteRepo.listDetailed(500);
      return c.json(detailed.filter((n) => n.project && visibleNames.has(n.project)).map((n) => n.title));
    }
  }
  const notes = await noteRepo.list();
  return c.json(notes);
});

// Loest das Projekt einer Notiz auf (per Titel-Match ueber listDetailed).
// Rueckgabe: { found: true, project }, wenn die Notiz existiert, sonst null.
// project=null heisst: Notiz hat kein verknuepftes Projekt (persoenlich/legacy).
async function resolveNoteProject(name: string): Promise<{ project: string | null } | null> {
  if (!noteRepo.listDetailed) return { project: null };
  const all = await noteRepo.listDetailed(500);
  const match = all.find((n) => n.title === name) ?? all.find((n) => n.title.startsWith(name));
  if (!match) return null;
  return { project: match.project };
}

// Zentraler ACL-Check fuer Single-Note-Routes. Admin sieht alles. Andere
// muessen Zugriff auf das verknuepfte Projekt haben; Notizen ohne Projekt
// sind fuer Non-Admins nicht zugaenglich (analog zur GET /notes Liste).
async function ensureNoteAccess(
  ctxArg: UserCtx,
  name: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const ctx = ctxArg;
  // Existenz / Projektzugehoerigkeit aufloesen.
  const meta = await resolveNoteProject(name);
  if (!meta) return { ok: false, status: 404, error: "Notiz nicht gefunden" };
  if (ctx.role === "admin") return { ok: true };
  if (!meta.project) return { ok: false, status: 403, error: "Kein Zugriff" };
  const allowed = await canSeeProjectByName(ctx, meta.project);
  if (!allowed) return { ok: false, status: 403, error: "Kein Zugriff" };
  return { ok: true };
}

notesRoutes.get("/notes/:name", async (c) => {
  const name = c.req.param("name");
  const guard = await ensureNoteAccess(userCtx(c), name);
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);
  const content = await noteRepo.read(name);
  if (content === null) return c.json({ error: "Notiz nicht gefunden" }, 404);
  return c.json({ name, content });
});

notesRoutes.post("/notes", async (c) => {
  const { content, project } = await c.req.json<{ content: string; project?: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  if (project && !(await canSeeProjectByName(userCtx(c), project))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const path = await noteRepo.save(content, project);
  emit({ type: "note", action: "created", project });
  return c.json({ path }, 201);
});

notesRoutes.put("/notes/:name", async (c) => {
  const name = c.req.param("name");
  const guard = await ensureNoteAccess(userCtx(c), name);
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);
  const existing = await noteRepo.read(name);
  if (existing === null) return c.json({ error: "Notiz nicht gefunden" }, 404);

  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);

  const success = await noteRepo.update(name, content);
  if (success) emit({ type: "note", action: "updated", id: name });
  return c.json({ success });
});

notesRoutes.patch("/notes/:name/append", async (c) => {
  const name = c.req.param("name");
  const guard = await ensureNoteAccess(userCtx(c), name);
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);
  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  const success = await noteRepo.append(name, content);
  if (success) emit({ type: "note", action: "updated", id: name });
  return c.json({ success });
});

notesRoutes.delete("/notes/:name", async (c) => {
  const name = c.req.param("name");
  const guard = await ensureNoteAccess(userCtx(c), name);
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);
  const deleted = await noteRepo.delete(name);
  if (!deleted) return c.json({ error: "Notiz nicht gefunden" }, 404);
  emit({ type: "note", action: "deleted", id: name });
  return c.json({ deleted: name });
});
