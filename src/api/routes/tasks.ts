import { Hono } from "hono";
import { taskRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import { notifyTaskAssigned, resolveUserIdFromMember } from "../../notifications.js";

export const tasksRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

// Tasks-Liste: filtert nach sichtbaren Projekten. Tasks ohne project sind
// "persoenlich" — User sieht die nur wenn er Ersteller oder Assignee ist.
tasksRoutes.get("/tasks", async (c) => {
  const project = c.req.query("project");
  const all = await taskRepo.list(project);
  const ctx = userCtx(c);
  if (ctx.role === "admin") return c.json(all);

  const visible = await getVisibleProjectIds(ctx);
  if (visible === "all") return c.json(all);
  const visibleNames = new Set(await projectRepo.list(visible));
  const me = ctx.userId;

  const filtered = all.filter((t) => {
    if (t.project) return visibleNames.has(t.project);
    // ohne Projekt: nur wenn me Assignee oder Ersteller. createdBy haben wir
    // im Task-DTO nicht — daher fuer Phase 4 nur Assignee-Match. Personal-
    // Tasks ohne FK (persoenliche Notizen-Tasks) bleiben fuer Non-Admins
    // unsichtbar bis das Feld exposed wird.
    return !!me && t.assigneeId === me;
  });
  return c.json(filtered);
});

tasksRoutes.get("/tasks/:id", async (c) => {
  const task = await taskRepo.get(c.req.param("id"));
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = task.project
      ? await canSeeProjectByName(ctx, task.project)
      : !!ctx.userId && task.assigneeId === ctx.userId;
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  return c.json(task);
});

tasksRoutes.post("/tasks", async (c) => {
  const body = await c.req.json<{
    text: string;
    project?: string;
    assignee?: string;
    assigneeId?: string;
    date?: string;
    location?: string;
    phaseId?: string | null;
  }>();
  if (!body.text) return c.json({ error: "Text erforderlich" }, 400);
  // Wenn Projekt gesetzt: User muss Zugriff darauf haben.
  if (body.project && !(await canSeeProjectByName(userCtx(c), body.project))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const task = await taskRepo.save(body.text, body.project);
  // Apply optional fields inkl. assigneeId (Migration 007) und phaseId (035).
  if (body.assignee || body.assigneeId || body.date || body.location || body.phaseId) {
    const updated = await taskRepo.update(
      task.id,
      {
        assignee: body.assignee ?? null,
        assigneeId: body.assigneeId ?? null,
        date: body.date ?? null,
        location: body.location ?? null,
        phaseId: body.phaseId ?? null,
      },
      body.project,
    );
    emit({ type: "task", action: "created", id: task.id, project: body.project });
    // Notification: assigneeId ist team_members.id → wir resolven zuerst
    // den verlinkten User und schicken nur, wenn es nicht ich selbst bin.
    if (body.assigneeId) {
      void (async () => {
        const targetUserId = await resolveUserIdFromMember(body.assigneeId!);
        if (targetUserId && targetUserId !== c.var.userId) {
          const actor = c.var.dbUser?.displayName ?? c.var.dbUser?.username ?? null;
          await notifyTaskAssigned(
            targetUserId,
            { text: body.text, project: body.project ?? null, date: body.date ?? null },
            actor,
          );
        }
      })();
    }
    return c.json(updated, 201);
  }
  emit({ type: "task", action: "created", id: task.id, project: body.project });
  return c.json(task, 201);
});

tasksRoutes.put("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<
    Partial<{
      text: string;
      status: "open" | "in_progress" | "done";
      assignee: string | null;
      assigneeId: string | null;
      date: string | null;
      location: string | null;
      phaseId: string | null;
    }>
  >();
  // Vorherigen Stand laden, damit wir nur bei echter Assignee-Aenderung
  // benachrichtigen (kein Spam wenn nur Datum aktualisiert wird).
  const prev = await taskRepo.get(id);
  const task = await taskRepo.update(id, body);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  emit({ type: "task", action: "updated", id });
  if ("assigneeId" in body && body.assigneeId && body.assigneeId !== prev?.assigneeId) {
    void (async () => {
      const targetUserId = await resolveUserIdFromMember(body.assigneeId!);
      if (targetUserId && targetUserId !== c.var.userId) {
        const actor = c.var.dbUser?.displayName ?? c.var.dbUser?.username ?? null;
        await notifyTaskAssigned(
          targetUserId,
          { text: task.text, project: task.project, date: task.dueDate ?? task.date },
          actor,
        );
      }
    })();
  }
  return c.json(task);
});

tasksRoutes.patch("/tasks/:id/complete", async (c) => {
  const id = c.req.param("id");
  const ok = await taskRepo.complete(id);
  if (ok) emit({ type: "task", action: "completed", id });
  return c.json({ ok });
});

// Legacy compat
tasksRoutes.patch("/tasks/complete", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Text erforderlich" }, 400);
  const ok = await taskRepo.complete(text, project);
  if (ok) emit({ type: "task", action: "completed", project });
  return c.json({ success: ok });
});

tasksRoutes.delete("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await taskRepo.delete(id);
  if (ok) emit({ type: "task", action: "deleted", id });
  return c.json({ ok });
});
