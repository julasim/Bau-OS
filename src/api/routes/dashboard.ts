import { Hono } from "hono";
import { noteRepo, taskRepo, terminRepo, projectRepo } from "../../data/index.js";
import { getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { gehoertMirPruefer, type PersoenlicherDatensatz } from "../persoenlich.js";

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

  // ── Warum das hier asynchron ist ─────────────────────────────────────────
  //
  // Hier stand ein Direktvergleich: `t.assigneeId === me`. Der trifft NIE.
  // `assignee_id` zeigt auf team_members.id, `ctx.userId` ist eine users.id —
  // zwei disjunkte UUID-Raeume (Migrationen 007/013). Die Startseite zeigte
  // deshalb „0 offene Aufgaben", waehrend die Aufgabenliste welche
  // auflistete: kein Fehler, keine Meldung, nur eine Zahl, die immer null war.
  //
  // Und der Ersteller fehlte ganz: wer sich selbst eine Aufgabe ohne Projekt
  // anlegt, sah sie in keiner Zahl der Startseite.
  //
  // Der Pruefer aus `../persoenlich.js` beantwortet beides und merkt sich, was
  // er schon aufgeloest hat — sonst waere jede Zeile ein Datenbankzugriff.
  const gehoertMir = gehoertMirPruefer(ctx);

  const filterByAccess = async <T extends { project: string | null }>(items: T[]): Promise<T[]> => {
    if (ctx.role === "admin" || visibleNames === null) return items;
    const raus: T[] = [];
    for (const i of items) {
      if (i.project) {
        if (visibleNames.has(i.project)) raus.push(i);
      } else if (await gehoertMir(i as PersoenlicherDatensatz)) {
        raus.push(i);
      }
    }
    return raus;
  };

  const visibleTasks = await filterByAccess(tasks);
  const visibleTermine = await filterByAccess(termine);
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
