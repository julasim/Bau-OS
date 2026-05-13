import { Hono } from "hono";
import { searchWorkspace } from "../../workspace/index.js";
import { DB_ENABLED } from "../../config.js";
import { adminMiddleware } from "../auth.js";
import type { AppEnv } from "../server.js";

export const searchRoutes = new Hono<AppEnv>();

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

// Reindex: generiert Embeddings fuer alle Notizen/Dateien die noch keins haben.
// Nutzen: nach Migration, nach Embedding-Modell-Wechsel, oder wenn der
// Embedding-Provider zwischendurch down war (neue Notizen ohne Embedding).
// Laeuft synchron — kann bei vielen Items laenger dauern. Bei einer mittleren
// Vault-Groesse (100 Notizen) sind das ~30 s; fuer Horror-Szenarien spaeter
// in einen Background-Job auslagern.
searchRoutes.post("/search/reindex", adminMiddleware, async (c) => {
  if (!DB_ENABLED) {
    return c.json({ error: "Datenbank nicht aktiv" }, 503);
  }
  try {
    const { embedAllNotes, embedAllFiles, embeddingStats } = await import("../../db/index.js");
    const before = await embeddingStats();
    const [notesEmbedded, filesEmbedded] = await Promise.all([embedAllNotes(), embedAllFiles()]);
    const after = await embeddingStats();
    return c.json({
      ok: true,
      embedded: { notes: notesEmbedded, files: filesEmbedded },
      before,
      after,
    });
  } catch (err) {
    return c.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
