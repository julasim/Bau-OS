// ============================================================
// PATIO — Projekt-Module Routes (Phase 6e)
// ============================================================
//   GET   /api/project-modules         → globale Defaults
//   PATCH /api/project-modules         → Defaults setzen
//   GET   /api/projects/:name/modules  → effektive Sicht
//   PATCH /api/projects/:name/modules  → Per-Projekt-Override
//   DELETE /api/projects/:name/modules → Override loeschen
// ============================================================

import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import {
  getGlobalModules,
  updateGlobalModules,
  getProjectEffectiveModules,
  setProjectModulesOverride,
  type ProjectModuleFlags,
} from "../../data/db-project-modules.js";
import {
  listCustomModules,
  createCustomModule,
  updateCustomModule,
  deleteCustomModule,
} from "../../data/db-custom-modules.js";
import { adminMiddleware } from "../auth.js";
import { canSeeProjectByName, type UserCtx, type Rolle } from "../../data/access.js";

export const projectModulesRoutes = new Hono<AppEnv>();

// ── Wer darf hier was? ───────────────────────────────────────────────────────
//
// Die Datei bedient zwei Dinge, die verschiedenen Regeln folgen — bis hierher
// beide ohne jede Pruefung:
//
//   * `/project-modules(/custom)` sind die Voreinstellungen fuers ganze Buero.
//     Lesen muss jeder duerfen (die Oberflaeche baut sich daraus auf),
//     schreiben nur der Admin.
//   * `/projects/:name/modules` gehoert zum Projekt und folgt dessen
//     Sichtbarkeit. Ein Fremder konnte hier nicht nur mitlesen, sondern einem
//     Projekt Module abschalten, das er gar nicht sehen darf.
//
// Der Guard steht vor den Routen, weil Hono Middleware in
// Registrierungsreihenfolge anwendet.
projectModulesRoutes.on(["POST", "PATCH", "DELETE"], ["/project-modules", "/project-modules/*"], adminMiddleware);

/** Sichtbarkeit des Projekts aus dem Pfad. Liefert die fertige Antwort, wenn
 *  der Aufrufer es nicht sehen darf — sonst `null`. */
async function projektGesperrt(c: {
  var: { userId: string | null; userRole: Rolle };
  json: (o: unknown, s: 403) => Response;
  req: { param: (k: string) => string };
}): Promise<Response | null> {
  const ctx: UserCtx = { userId: c.var.userId, role: c.var.userRole };
  if (ctx.role === "admin") return null;
  const name = decodeURIComponent(c.req.param("name"));
  if (await canSeeProjectByName(ctx, name)) return null;
  return c.json({ error: "Kein Zugriff" }, 403);
}

// ── Custom Modules CRUD ──────────────────────────────────────────────────
// Muss VOR den generischen Routen stehen um Kollisionen zu vermeiden.
projectModulesRoutes.get("/project-modules/custom", async (c) => {
  const list = await listCustomModules();
  return c.json(list);
});

projectModulesRoutes.post("/project-modules/custom", async (c) => {
  let body: { key?: string; label?: string; description?: string | null; icon?: string; enabledByDefault?: boolean };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  if (!body.key?.trim()) return c.json({ error: "key ist Pflicht" }, 400);
  if (!body.label?.trim()) return c.json({ error: "label ist Pflicht" }, 400);
  const created = await createCustomModule({
    key: body.key.trim(),
    label: body.label.trim(),
    description: body.description ?? null,
    icon: body.icon,
    enabledByDefault: body.enabledByDefault,
  });
  return c.json(created, 201);
});

projectModulesRoutes.patch("/project-modules/custom/:id", async (c) => {
  const id = c.req.param("id");
  let body: {
    label?: string;
    description?: string | null;
    icon?: string;
    enabledByDefault?: boolean;
    sortOrder?: number;
  };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  const updated = await updateCustomModule(id, body);
  if (!updated) return c.json({ error: "Modul nicht gefunden" }, 404);
  return c.json(updated);
});

projectModulesRoutes.delete("/project-modules/custom/:id", async (c) => {
  const ok = await deleteCustomModule(c.req.param("id"));
  return c.json({ ok });
});

// ── Global Defaults ──────────────────────────────────────────────────────
projectModulesRoutes.get("/project-modules", async (c) => {
  const modules = await getGlobalModules();
  return c.json({ modules });
});

projectModulesRoutes.patch("/project-modules", async (c) => {
  let body: Partial<ProjectModuleFlags>;
  try {
    body = await c.req.json<Partial<ProjectModuleFlags>>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  const next = await updateGlobalModules(body);
  return c.json({ modules: next });
});

projectModulesRoutes.get("/projects/:name/modules", async (c) => {
  const gesperrt = await projektGesperrt(c);
  if (gesperrt) return gesperrt;
  const name = decodeURIComponent(c.req.param("name"));
  const result = await getProjectEffectiveModules(name);
  return c.json(result);
});

projectModulesRoutes.patch("/projects/:name/modules", async (c) => {
  const gesperrt = await projektGesperrt(c);
  if (gesperrt) return gesperrt;
  const name = decodeURIComponent(c.req.param("name"));
  let body: Partial<ProjectModuleFlags>;
  try {
    body = await c.req.json<Partial<ProjectModuleFlags>>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  await setProjectModulesOverride(name, body);
  const result = await getProjectEffectiveModules(name);
  return c.json(result);
});

projectModulesRoutes.delete("/projects/:name/modules", async (c) => {
  const gesperrt = await projektGesperrt(c);
  if (gesperrt) return gesperrt;
  const name = decodeURIComponent(c.req.param("name"));
  await setProjectModulesOverride(name, null);
  const result = await getProjectEffectiveModules(name);
  return c.json(result);
});
