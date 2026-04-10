import { Hono } from "hono";
import { listAgents } from "../../vault/index.js";
import { noteRepo, taskRepo, terminRepo, projectRepo } from "../../data/index.js";
import { DB_ENABLED } from "../../config.js";

export const dashboardRoutes = new Hono();

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
    const { checkDbHealth, checkPgVector, migrationStatus } = await import("../../db/index.js");
    const healthy = await checkDbHealth();
    const hasVector = healthy ? await checkPgVector() : false;
    const migrations = healthy ? await migrationStatus() : [];

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
