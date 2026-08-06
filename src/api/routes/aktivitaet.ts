// ============================================================
// PATIO — Aktivität (abgeleitet, kein eigener Speicher)
// ============================================================
//   GET /api/aktivitaet?limit=50   → zuletzt geänderte Datensätze
//
// Siehe src/data/db-aktivitaet.ts für die Begründung, warum der Feed
// abgeleitet und nicht protokolliert wird.
// ============================================================

import { Hono } from "hono";
import { aktivitaetRepo } from "../../data/index.js";
import { getVisibleProjectIds } from "../../data/access.js";
import type { AppEnv } from "../server.js";

export const aktivitaetRoutes = new Hono<AppEnv>();

aktivitaetRoutes.get("/aktivitaet", async (c) => {
  const limitRoh = c.req.query("limit");
  const limit = limitRoh ? Math.min(Math.max(parseInt(limitRoh, 10) || 50, 1), 200) : 50;
  const sichtbar = await getVisibleProjectIds({ userId: c.var.userId, role: c.var.userRole });
  return c.json(await aktivitaetRepo.list(sichtbar, limit));
});
