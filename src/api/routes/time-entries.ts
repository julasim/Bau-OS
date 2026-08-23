// ============================================================
// PATIO — Stundenerfassung Routes
// ============================================================
// Pattern angelehnt an meetings.ts:
//   GET    /projects/:projectName/time-entries           → Liste (Filter via ?from/?to)
//   POST   /projects/:projectName/time-entries           → Neu
//   GET    /projects/:projectName/time-entries/summary   → Aggregat (Member|Datum)
//   GET    /time-entries/:id                             → Einzeln
//   PATCH  /time-entries/:id                             → Aktualisieren
//   DELETE /time-entries/:id                             → Loeschen
//   GET    /team/:memberId/time-entries                  → Cross-Projekt pro Mitglied
//
// ACL: wer das Projekt sehen darf, darf auch Stunden lesen/schreiben.
// ============================================================

import { Hono } from "hono";
import { timeEntryRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, type UserCtx, type Rolle } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import type { TimeEntryInput } from "../../data/types.js";

export const timeEntriesRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: Rolle } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

// Guard: 503 wenn FS-Mode (kein time-entries-Repo).
const dbGuard = async (c: { json: (o: unknown, s?: number) => Response }, next: () => Promise<void>) => {
  await next();
};
timeEntriesRoutes.use("/projects/:projectName/time-entries", dbGuard);
timeEntriesRoutes.use("/projects/:projectName/time-entries/*", dbGuard);
timeEntriesRoutes.use("/time-entries/*", dbGuard);
timeEntriesRoutes.use("/team/:memberId/time-entries", dbGuard);

async function resolveProject(c: {
  req: { param: (k: string) => string };
  json: (obj: unknown, status?: number) => Response;
  var: { userId: string | null; userRole: Rolle };
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
timeEntriesRoutes.get("/projects/:projectName/time-entries", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500) : 100;
  const entries = await timeEntryRepo.list(proj.id, { from, to, limit });
  return c.json(entries);
});

// ── Aggregierte Summen ────────────────────────────────────────
timeEntriesRoutes.get("/projects/:projectName/time-entries/summary", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const from = c.req.query("from");
  const to = c.req.query("to");
  const groupBy = c.req.query("groupBy") === "date" ? "date" : "member";

  if (groupBy === "date") {
    const data = await timeEntryRepo.summaryByDate(proj.id, from, to);
    return c.json({ groupBy, data });
  }
  const data = await timeEntryRepo.summaryByMember(proj.id, from, to);
  return c.json({ groupBy, data });
});

// ── Neu anlegen ───────────────────────────────────────────────
timeEntriesRoutes.post("/projects/:projectName/time-entries", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  let body: TimeEntryInput;
  try {
    body = await c.req.json<TimeEntryInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await timeEntryRepo.create(proj.id, body, c.var.userId);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "time", action: "created", id: result.id, projectId: proj.id }, { actorId: c.var.userId });
  return c.json(result, 201);
});

// ── Einzeln ───────────────────────────────────────────────────
timeEntriesRoutes.get("/time-entries/:id", async (c) => {
  const id = c.req.param("id");
  const entry = await timeEntryRepo.get(id);
  if (!entry) return c.json({ error: "Eintrag nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    // Kein Skip bei fehlendem Projektnamen (z.B. verwaistes/geloeschtes Projekt):
    // Zugriff nur fuer den Ersteller ODER wer das Projekt per ACL sehen darf.
    const owns = !!entry.createdById && entry.createdById === ctx.userId;
    const canSee = !!entry.projectName && (await canSeeProjectByName(ctx, entry.projectName));
    if (!owns && !canSee) {
      return c.json({ error: "Kein Zugriff" }, 403);
    }
  }
  return c.json(entry);
});

// ── Aktualisieren ─────────────────────────────────────────────
timeEntriesRoutes.patch("/time-entries/:id", async (c) => {
  const id = c.req.param("id");
  const entry = await timeEntryRepo.get(id);
  if (!entry) return c.json({ error: "Eintrag nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    // Kein Skip bei fehlendem Projektnamen (z.B. verwaistes/geloeschtes Projekt):
    // Zugriff nur fuer den Ersteller ODER wer das Projekt per ACL sehen darf.
    const owns = !!entry.createdById && entry.createdById === ctx.userId;
    const canSee = !!entry.projectName && (await canSeeProjectByName(ctx, entry.projectName));
    if (!owns && !canSee) {
      return c.json({ error: "Kein Zugriff" }, 403);
    }
  }
  let body: Partial<TimeEntryInput>;
  try {
    body = await c.req.json<Partial<TimeEntryInput>>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await timeEntryRepo.update(id, body);
  if (typeof result === "string") return c.json({ error: result }, 400);
  if (!result) return c.json({ error: "Eintrag nicht gefunden" }, 404);
  emit({ type: "time", action: "updated", id, projectId: entry.projectId }, { actorId: c.var.userId });
  return c.json(result);
});

// ── Loeschen ──────────────────────────────────────────────────
timeEntriesRoutes.delete("/time-entries/:id", async (c) => {
  const id = c.req.param("id");
  const entry = await timeEntryRepo.get(id);
  if (!entry) return c.json({ ok: false }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    // Kein Skip bei fehlendem Projektnamen (z.B. verwaistes/geloeschtes Projekt):
    // Zugriff nur fuer den Ersteller ODER wer das Projekt per ACL sehen darf.
    const owns = !!entry.createdById && entry.createdById === ctx.userId;
    const canSee = !!entry.projectName && (await canSeeProjectByName(ctx, entry.projectName));
    if (!owns && !canSee) {
      return c.json({ error: "Kein Zugriff" }, 403);
    }
  }
  const ok = await timeEntryRepo.delete(id);
  if (ok) emit({ type: "time", action: "deleted", id, projectId: entry.projectId }, { actorId: c.var.userId });
  return c.json({ ok });
});

// ── Cross-Projekt pro Mitglied ────────────────────────────────
// Admin sieht alles, Non-Admin: nur sich selbst (memberId muss zu ihrem
// verlinkten team_member gehoeren — Pruefung via DB).
timeEntriesRoutes.get("/team/:memberId/time-entries", async (c) => {
  const memberId = c.req.param("memberId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500) : 100;
  // Non-Admin: pruefen ob memberId der ihre ist (team_members.user_id = currentUserId)
  if (c.var.userRole !== "admin") {
    const { teamRepo } = await import("../../data/index.js");
    const member = await teamRepo.get(memberId);
    if (!member || member.userId !== c.var.userId) {
      return c.json({ error: "Kein Zugriff auf andere Mitglieder" }, 403);
    }
  }
  const entries = await timeEntryRepo.listForMember(memberId, { from, to, limit });
  return c.json(entries);
});
