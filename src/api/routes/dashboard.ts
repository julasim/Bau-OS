import { Hono } from "hono";
import { listAgents } from "../../workspace/index.js";
import { noteRepo, taskRepo, terminRepo, projectRepo } from "../../data/index.js";
import { DB_ENABLED } from "../../config.js";
import type { AppEnv } from "../server.js";

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/dashboard", async (c) => {
  const [notes, tasks, termine, projects, agents] = await Promise.all([
    noteRepo.list(),
    taskRepo.list(),
    terminRepo.list(),
    projectRepo.list(),
    Promise.resolve(listAgents()),
  ]);

  const today = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const todayTermine = termine.filter((t) => t.datum === today || t.datum.includes(today));

  const openTasks = tasks.filter((t) => t.status !== "done");

  return c.json({
    notes: notes.length,
    openTasks: openTasks.length,
    totalTasks: tasks.length,
    todayTermine: todayTermine.map((t) => (t.uhrzeit ? `${t.uhrzeit} – ${t.text}` : t.text)),
    termine: termine.length,
    projects: projects.length,
    agents,
  });
});

// ── DB-Status Endpoint ──────────────────────────────────────────────────────
dashboardRoutes.get("/dashboard/db-status", async (c) => {
  if (!DB_ENABLED) {
    return c.json({ enabled: false, mode: "filesystem" });
  }
  try {
    const [{ checkDbHealth, checkPgVector, migrationStatus }, { getPoolStats }, embeddingsMod, { SUPABASE_ENABLED }] =
      await Promise.all([
        import("../../db/index.js"),
        import("../../db/client.js"),
        import("../../db/embeddings.js"),
        import("../../config.js"),
      ]);
    const healthy = await checkDbHealth();
    const hasVector = healthy ? await checkPgVector() : false;
    const migrations = healthy ? await migrationStatus() : [];

    // Parallele Health-Checks fuer optionale Subsysteme
    const [embeddingHealth, schemaDims, poolStats, coverage] = await Promise.all([
      healthy ? embeddingsMod.checkEmbeddingHealth() : Promise.resolve({ ok: false, model: "", dimensions: 0 }),
      healthy
        ? embeddingsMod.checkEmbeddingSchemaDims()
        : Promise.resolve({ ok: false, configured: 0, schema: { notes: null, files: null } }),
      Promise.resolve(getPoolStats()),
      // Coverage: wieviele Notizen/Dateien haben ueberhaupt ein Embedding?
      // Wenn < 100 %, findet semantisch_suchen sie nicht — Banner soll warnen
      // und der User kann /api/search/reindex triggern.
      healthy
        ? embeddingsMod.embeddingStats()
        : Promise.resolve({ notes: { total: 0, embedded: 0 }, files: { total: 0, embedded: 0 } }),
    ]);

    // Supabase Realtime-Bridge-Status (nur wenn SUPABASE konfiguriert)
    let bridge: unknown = { enabled: false };
    if (SUPABASE_ENABLED) {
      try {
        const { getRealtimeBridgeStatus } = await import("../realtime-bridge.js");
        bridge = { enabled: true, ...getRealtimeBridgeStatus() };
      } catch {
        bridge = { enabled: true, active: false, startedAt: null, tables: 0, lastError: "Bridge-Status n/a" };
      }
    }

    return c.json({
      enabled: true,
      mode: "database",
      healthy,
      pgvector: hasVector,
      migrations: migrations.map((m) => ({
        name: m.name,
        applied: m.applied,
        appliedAt: m.appliedAt,
      })),
      embedding: embeddingHealth,
      embeddingSchema: schemaDims,
      embeddingCoverage: {
        notes: coverage.notes,
        files: coverage.files,
        ok:
          (coverage.notes.total === 0 || coverage.notes.embedded === coverage.notes.total) &&
          (coverage.files.total === 0 || coverage.files.embedded === coverage.files.total),
      },
      pool: poolStats,
      realtime: bridge,
    });
  } catch (err) {
    return c.json({
      enabled: true,
      mode: "database",
      healthy: false,
      error: err instanceof Error ? err.message : "Unbekannter Fehler",
    });
  }
});
