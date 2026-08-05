import { Hono } from "hono";
import { searchRepo } from "../../data/index.js";
import { getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";

export const searchRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

// GET /search?q=…&project=…  — Volltextsuche ueber Notizen, Aufgaben,
// Projekte und Dateien. Die frueheren Betriebsarten (`mode=semantic|text|
// hybrid`) sind mit der Embedding-Suche entfallen; es gibt nur noch einen Weg.
searchRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Suchbegriff erforderlich (?q=...)" }, 400);

  const project = c.req.query("project") ?? null;
  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
  const visible = await getVisibleProjectIds(userCtx(c));

  const results = await searchRepo.search(q, visible, project, limit);
  return c.json({ query: q, results });
});
