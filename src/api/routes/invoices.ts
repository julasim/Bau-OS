// ============================================================
// PATIO — Teilrechnungen-Routes (Migration 035)
// ============================================================
// /projects/:projectName/invoices (Liste/Anlage), /invoices/:id (Update/
// Delete). ACL ueber die Projekt-Zugehoerigkeit. DB-only.
// ============================================================

import { Hono } from "hono";
import { invoiceRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import type { ProjectInvoiceInput } from "../../data/types.js";
import { darfGeldSehen } from "../geld.js";

export const invoicesRoutes = new Hono<AppEnv>();

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

const guard = async (c: { json: (o: unknown, s?: number) => Response }, next: () => Promise<void>) => {
  await next();
};
invoicesRoutes.use("/projects/:projectName/invoices", guard);
invoicesRoutes.use("/projects/:projectName/invoices/*", guard);
invoicesRoutes.use("/invoices/*", guard);

invoicesRoutes.get("/projects/:projectName/invoices", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  return c.json(await invoiceRepo.list(proj.id));
});

// Rechnungen anlegen, aendern und loeschen ist Geldarbeit. Lesen faellt
// ohnehin durch den Antwort-Filter (die Betraege fehlen dann), aber Schreiben
// muss ausdruecklich verwehrt werden — sonst koennte jemand Betraege setzen,
// die er selbst nicht sieht.
invoicesRoutes.on(["POST", "PUT", "DELETE"], ["/projects/:projectName/invoices", "/invoices/:id"], async (c, next) => {
  if (!darfGeldSehen(c)) return c.json({ error: "Kein Zugriff auf Betraege" }, 403);
  await next();
});

invoicesRoutes.post("/projects/:projectName/invoices", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  let body: ProjectInvoiceInput;
  try {
    body = await c.req.json<ProjectInvoiceInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await invoiceRepo.create(proj.id, body);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "invoice", action: "created", id: result.id, projectId: proj.id }, { actorId: c.var.userId });
  return c.json(result);
});

invoicesRoutes.put("/invoices/:id", async (c) => {
  const id = c.req.param("id");
  let body: ProjectInvoiceInput;
  try {
    body = await c.req.json<ProjectInvoiceInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  // ACL VOR der Mutation: Rechnung laden, Projekt-Zugriff pruefen, erst dann
  // schreiben. Verhindert IDOR (fremde Rechnungen aendern).
  const existing = await invoiceRepo.get(id);
  if (!existing) return c.json({ error: "Teilrechnung nicht gefunden" }, 404);
  if (!(await canSeeProjectById(userCtx(c), existing.projectId))) {
    return c.json({ error: "Kein Zugriff" }, 403);
  }
  const result = await invoiceRepo.update(id, body);
  if (result === null) return c.json({ error: "Teilrechnung nicht gefunden" }, 404);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "invoice", action: "updated", id, projectId: existing.projectId }, { actorId: c.var.userId });
  return c.json(result);
});

invoicesRoutes.delete("/invoices/:id", async (c) => {
  const id = c.req.param("id");
  // ACL VOR dem Loeschen: ohne Pruefung koennte jeder User jede Rechnung per
  // ID loeschen (IDOR).
  const existing = await invoiceRepo.get(id);
  if (!existing) return c.json({ error: "Teilrechnung nicht gefunden" }, 404);
  if (!(await canSeeProjectById(userCtx(c), existing.projectId))) {
    return c.json({ error: "Kein Zugriff" }, 403);
  }
  const ok = await invoiceRepo.delete(id);
  // Frueher stand die UUID im Feld `project` (Name) — das Feld gibt es nicht
  // mehr, die ID gehoert nach `projectId`.
  if (ok) emit({ type: "invoice", action: "deleted", id, projectId: existing.projectId }, { actorId: c.var.userId });
  return c.json({ ok });
});

// Helper: ACL ueber Projekt-ID (analog access.ts canSeeProjectByName).
async function canSeeProjectById(ctx: UserCtx, projectId: string): Promise<boolean> {
  if (ctx.role === "admin") return true;
  const visible = await getVisibleProjectIds(ctx);
  if (visible === "all") return true;
  return visible.includes(projectId);
}
