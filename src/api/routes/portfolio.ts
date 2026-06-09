// ============================================================
// PATIO — Portfolio-Cockpit-Route (Migration 035)
// ============================================================
// GET /portfolio — projektuebergreifende Aggregation, gefiltert auf die
// fuer den User sichtbaren Projekte. DB-only.
// ============================================================

import { Hono } from "hono";
import { portfolioRepo } from "../../data/index.js";
import { getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";

export const portfolioRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

portfolioRoutes.get("/portfolio", async (c) => {
  if (!portfolioRepo) return c.json({ error: "Portfolio erfordert DB-Modus" }, 503);
  const visible = await getVisibleProjectIds(userCtx(c));
  const entries = await portfolioRepo.list(visible);
  return c.json(entries);
});
