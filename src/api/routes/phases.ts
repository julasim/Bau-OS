// ============================================================
// PATIO — Leistungsphasen-Routes (Migration 035)
// ============================================================
// Projekt-scoped Liste/Anlage unter /projects/:projectName/phases,
// id-scoped Update/Delete unter /phases/:id (mit ACL ueber die Projekt-
// Zugehoerigkeit der Phase). DB-only — 503 im FS-Modus.
// ============================================================

import { Hono } from "hono";
import { phaseRepo } from "../../data/index.js";
import { canSeeProjectByName, type UserCtx } from "../../data/access.js";
import { projectRepo } from "../../data/index.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import type { ProjectPhaseUpsert } from "../../data/types.js";

export const phasesRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

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

// ACL ueber die Phase: Phase laden → projectName → canSee.
async function resolvePhaseAcl(c: {
  req: { param: (k: string) => string };
  json: (obj: unknown, status?: number) => Response;
  var: { userId: string | null; userRole: "admin" | "user" };
}): Promise<{ phaseId: string; projectName: string } | { error: Response }> {
  const phaseId = c.req.param("id");
  const phase = await phaseRepo!.get(phaseId);
  if (!phase) return { error: c.json({ error: "Phase nicht gefunden" }, 404) };
  const projectName = phase.projectName ?? "";
  if (!(await canSeeProjectByName(userCtx(c), projectName))) {
    return { error: c.json({ error: "Kein Zugriff" }, 403) };
  }
  return { phaseId, projectName };
}

// DB-Guard.
const guard = async (c: { json: (o: unknown, s?: number) => Response }, next: () => Promise<void>) => {
  if (!phaseRepo) return c.json({ error: "Leistungsphasen erfordern DB-Modus" }, 503);
  await next();
};
phasesRoutes.use("/projects/:projectName/phases", guard);
phasesRoutes.use("/projects/:projectName/phases/*", guard);
phasesRoutes.use("/phases/*", guard);

// ── Liste je Projekt ──────────────────────────────────────────
phasesRoutes.get("/projects/:projectName/phases", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const phases = await phaseRepo!.list(proj.id);
  const progress = await phaseRepo!.projectProgress(proj.id);
  return c.json({ phases, progress });
});

// ── Anlegen ───────────────────────────────────────────────────
phasesRoutes.post("/projects/:projectName/phases", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  let body: ProjectPhaseUpsert;
  try {
    body = await c.req.json<ProjectPhaseUpsert>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await phaseRepo!.create(proj.id, body);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "phase", action: "created", id: result.id, project: proj.name });
  return c.json(result);
});

// ── Reorder ───────────────────────────────────────────────────
phasesRoutes.post("/projects/:projectName/phases/reorder", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  let body: { orderedIds?: string[] };
  try {
    body = await c.req.json<{ orderedIds?: string[] }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!Array.isArray(body.orderedIds)) return c.json({ error: "orderedIds fehlt" }, 400);
  const ok = await phaseRepo!.reorder(proj.id, body.orderedIds);
  if (ok) emit({ type: "phase", action: "updated", project: proj.name });
  return c.json({ ok });
});

// ── Update ────────────────────────────────────────────────────
phasesRoutes.put("/phases/:id", async (c) => {
  const acl = await resolvePhaseAcl(c);
  if ("error" in acl) return acl.error;
  let body: ProjectPhaseUpsert;
  try {
    body = await c.req.json<ProjectPhaseUpsert>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await phaseRepo!.update(acl.phaseId, body);
  if (result === null) return c.json({ error: "Phase nicht gefunden" }, 404);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "phase", action: "updated", id: acl.phaseId, project: acl.projectName });
  return c.json(result);
});

// ── Delete ────────────────────────────────────────────────────
phasesRoutes.delete("/phases/:id", async (c) => {
  const acl = await resolvePhaseAcl(c);
  if ("error" in acl) return acl.error;
  const ok = await phaseRepo!.delete(acl.phaseId);
  if (ok) emit({ type: "phase", action: "deleted", id: acl.phaseId, project: acl.projectName });
  return c.json({ ok });
});
