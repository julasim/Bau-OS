// ============================================================
// Bau-OS — Projekt-Module Routes (Phase 6e)
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

export const projectModulesRoutes = new Hono<AppEnv>();

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
  const name = decodeURIComponent(c.req.param("name"));
  const result = await getProjectEffectiveModules(name);
  return c.json(result);
});

projectModulesRoutes.patch("/projects/:name/modules", async (c) => {
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
  const name = decodeURIComponent(c.req.param("name"));
  await setProjectModulesOverride(name, null);
  const result = await getProjectEffectiveModules(name);
  return c.json(result);
});
