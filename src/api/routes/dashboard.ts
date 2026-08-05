import { Hono } from "hono";
import { noteRepo, taskRepo, terminRepo, projectRepo } from "../../data/index.js";
import { getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import { DB_ENABLED } from "../../config.js";
import type { AppEnv } from "../server.js";

export const dashboardRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

dashboardRoutes.get("/dashboard", async (c) => {
  const ctx = userCtx(c);
  const visible = await getVisibleProjectIds(ctx);

  const [notes, tasks, termine, projects] = await Promise.all([
    noteRepo.list(),
    taskRepo.list(),
    terminRepo.list(),
    projectRepo.list(visible),
  ]);

  // Phase-4-Filter fuer Aggregate. Admin: alles; User: nach sichtbaren
  // Projekten + persoenlichen Items.
  const visibleNames = visible === "all" ? null : new Set(await projectRepo.list(visible));
  const me = ctx.userId;

  const filterByAccess = <T extends { project: string | null }>(
    items: T[],
    isPersonalVisible: (item: T) => boolean,
  ): T[] => {
    if (ctx.role === "admin" || visibleNames === null) return items;
    return items.filter((i) => {
      if (i.project) return visibleNames.has(i.project);
      return isPersonalVisible(i);
    });
  };

  const visibleTasks = filterByAccess(tasks, (t) => !!me && t.assigneeId === me);
  const visibleTermine = filterByAccess(
    termine,
    (t) => !!me && Array.isArray(t.assigneeIds) && t.assigneeIds.includes(me),
  );
  // Notizen: simple Liste hat keine Projekt-Info, daher fuer Non-Admins
  // ueber listDetailed gehen und auf sichtbare Projekte filtern.
  let visibleNotesCount = notes.length;
  if (ctx.role !== "admin" && visibleNames !== null) {
    if (noteRepo.listDetailed) {
      const detailed = await noteRepo.listDetailed(500);
      visibleNotesCount = detailed.filter((n) => n.project && visibleNames.has(n.project)).length;
    } else {
      visibleNotesCount = 0;
    }
  }

  const today = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const todayTermine = visibleTermine.filter((t) => t.datum === today || t.datum.includes(today));
  const openTasks = visibleTasks.filter((t) => t.status !== "done");

  return c.json({
    notes: visibleNotesCount,
    openTasks: openTasks.length,
    totalTasks: visibleTasks.length,
    todayTermine: todayTermine.map((t) => (t.uhrzeit ? `${t.uhrzeit} – ${t.text}` : t.text)),
    termine: visibleTermine.length,
    projects: projects.length,
  });
});

// ── DB-Status Endpoint ──────────────────────────────────────────────────────
dashboardRoutes.get("/dashboard/db-status", async (c) => {
  if (!DB_ENABLED) {
    return c.json({ enabled: false, mode: "filesystem" });
  }
  try {
    const [{ checkDbHealth, migrationStatus }, { getPoolStats }] = await Promise.all([
      import("../../db/index.js"),
      import("../../db/client.js"),
    ]);
    const healthy = await checkDbHealth();
    const migrations = healthy ? await migrationStatus() : [];

    return c.json({
      enabled: true,
      mode: "database",
      healthy,
      migrations: migrations.map((m) => ({
        name: m.name,
        applied: m.applied,
        appliedAt: m.appliedAt,
      })),
      pool: getPoolStats(),
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
