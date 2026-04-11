import { Hono } from "hono";
import { searchWorkspace } from "../../workspace/index.js";
import { DB_ENABLED } from "../../config.js";

export const searchRoutes = new Hono();

searchRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Suchbegriff erforderlich (?q=...)" }, 400);

  const project = c.req.query("project");
  const mode = c.req.query("mode"); // "semantic", "text", "hybrid" (default)

  // Semantische Suche wenn DB aktiv und gewuenscht
  if (DB_ENABLED && mode !== "text") {
    try {
      const { semanticSearch } = await import("../../db/index.js");
      const results = await semanticSearch(q, { limit: 10, type: "all" });
      if (results.length > 0 || mode === "semantic") {
        return c.json({ mode: "semantic", results });
      }
    } catch {
      // Fallback auf Vault-Suche
    }
  }

  // Vault-Textsuche (Fallback oder explizit)
  const results = searchWorkspace(q, project);
  return c.json({ mode: "text", results });
});

// Dedizierter Semantic-Search Endpoint
searchRoutes.get("/search/semantic", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Suchbegriff erforderlich (?q=...)" }, 400);

  if (!DB_ENABLED) {
    return c.json({ error: "Semantische Suche erfordert Datenbank (DATABASE_URL)" }, 503);
  }

  const type = (c.req.query("type") as "note" | "file" | "all") || "all";
  const limit = Math.min(Number(c.req.query("limit")) || 10, 50);

  const { semanticSearch } = await import("../../db/index.js");
  const results = await semanticSearch(q, { limit, type });
  return c.json({ mode: "semantic", query: q, results });
});

// Embedding-Statistik
searchRoutes.get("/search/stats", async (c) => {
  if (!DB_ENABLED) {
    return c.json({ enabled: false });
  }
  const { embeddingStats } = await import("../../db/index.js");
  const stats = await embeddingStats();
  return c.json({ enabled: true, ...stats });
});
