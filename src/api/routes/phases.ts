// ============================================================
// PATIO — Leistungsphasen-Routes (Migration 035)
// ============================================================
// Projekt-scoped Liste/Anlage unter /projects/:projectName/phases,
// id-scoped Update/Delete unter /phases/:id (mit ACL ueber die Projekt-
// Zugehoerigkeit der Phase). DB-only — 503 im FS-Modus.
// ============================================================

import { Hono } from "hono";
import { phaseRepo, invoiceRepo, timeEntryRepo } from "../../data/index.js";
import { canSeeProjectByName, type UserCtx } from "../../data/access.js";
import { projectRepo } from "../../data/index.js";
import type { AppEnv } from "../server.js";
import { emit, emitForProjectName } from "../events.js";
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
  const phase = await phaseRepo.get(phaseId);
  if (!phase) return { error: c.json({ error: "Phase nicht gefunden" }, 404) };
  const projectName = phase.projectName ?? "";
  if (!(await canSeeProjectByName(userCtx(c), projectName))) {
    return { error: c.json({ error: "Kein Zugriff" }, 403) };
  }
  return { phaseId, projectName };
}

// DB-Guard.
const guard = async (c: { json: (o: unknown, s?: number) => Response }, next: () => Promise<void>) => {
  await next();
};
phasesRoutes.use("/projects/:projectName/phases", guard);
phasesRoutes.use("/projects/:projectName/phases/*", guard);
phasesRoutes.use("/projects/:projectName/finance", guard);
phasesRoutes.use("/phases/*", guard);

// ── Liste je Projekt ──────────────────────────────────────────
phasesRoutes.get("/projects/:projectName/phases", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const phases = await phaseRepo.list(proj.id);
  const progress = await phaseRepo.projectProgress(proj.id);
  return c.json({ phases, progress });
});

// ── Honorar-/Finanz-Aggregat je Projekt ───────────────────────
// Liefert Budget, fakturierte Summe und je Phase: Soll-Honorar
// (budget * fee_share), bereits fakturiert und offen. Grundlage fuer
// die Projekt-Detail-Finanzsicht und spaeter das Cockpit.
phasesRoutes.get("/projects/:projectName/finance", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const info = await projectRepo.getInfo(proj.name);
  const budget = info?.budget ?? null;
  const phases = await phaseRepo.list(proj.id);
  const invoices = invoiceRepo ? await invoiceRepo.list(proj.id) : [];
  // Ist-Kosten je Phase (Stunden * effektiver Satz).
  const costs = timeEntryRepo
    ? await timeEntryRepo.costsByPhase(proj.id)
    : { byPhase: {} as Record<string, number>, unassigned: 0, total: 0 };

  // Fakturiert = Status 'gestellt' oder 'bezahlt' (Entwuerfe zaehlen nicht).
  const invByPhase = new Map<string, number>();
  let invoicedTotal = 0;
  let unassignedInvoiced = 0;
  for (const inv of invoices) {
    if (inv.status !== "gestellt" && inv.status !== "bezahlt") continue;
    invoicedTotal += inv.betrag;
    if (inv.phaseId) invByPhase.set(inv.phaseId, (invByPhase.get(inv.phaseId) ?? 0) + inv.betrag);
    else unassignedInvoiced += inv.betrag;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const feeShareSum = phases.reduce((s, p) => s + p.feeShare, 0);
  const perPhase = phases.map((p) => {
    const sollHonorar = budget != null ? round2((budget * p.feeShare) / 100) : null;
    const invoiced = round2(invByPhase.get(p.id) ?? 0);
    const offen = sollHonorar != null ? round2(sollHonorar - invoiced) : null;
    const kostenIst = round2(costs.byPhase[p.id] ?? 0);
    // Deckungsbeitrag: Soll-Honorar minus Ist-Kosten (geplante Marge der Phase).
    const deckung = sollHonorar != null ? round2(sollHonorar - kostenIst) : null;
    return {
      phaseId: p.id,
      name: p.name,
      status: p.status,
      feeShare: p.feeShare,
      progress: p.progress,
      sollHonorar,
      invoiced,
      offen,
      kostenIst,
      deckung,
    };
  });
  return c.json({
    budget,
    invoicedTotal: round2(invoicedTotal),
    unassignedInvoiced: round2(unassignedInvoiced),
    kostenIstTotal: round2(costs.total),
    feeShareSum,
    perPhase,
  });
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
  const result = await phaseRepo.create(proj.id, body);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "phase", action: "created", id: result.id, projectId: proj.id }, { actorId: c.var.userId });
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
  const ok = await phaseRepo.reorder(proj.id, body.orderedIds);
  if (ok) emit({ type: "phase", action: "updated", projectId: proj.id }, { actorId: c.var.userId });
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
  const result = await phaseRepo.update(acl.phaseId, body);
  if (result === null) return c.json({ error: "Phase nicht gefunden" }, 404);
  if (typeof result === "string") return c.json({ error: result }, 400);
  // resolvePhaseAcl() liefert nur den Projektnamen — die UUID loest der
  // Event-Bus selbst auf.
  emitForProjectName({ type: "phase", action: "updated", id: acl.phaseId }, acl.projectName, {
    actorId: c.var.userId,
  });
  return c.json(result);
});

// ── Delete ────────────────────────────────────────────────────
phasesRoutes.delete("/phases/:id", async (c) => {
  const acl = await resolvePhaseAcl(c);
  if ("error" in acl) return acl.error;
  const ok = await phaseRepo.delete(acl.phaseId);
  if (ok)
    emitForProjectName({ type: "phase", action: "deleted", id: acl.phaseId }, acl.projectName, {
      actorId: c.var.userId,
    });
  return c.json({ ok });
});
