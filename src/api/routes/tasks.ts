import { Hono } from "hono";
import { taskRepo, projectRepo, teamRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emitForProjectName } from "../events.js";

export const tasksRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Ist diese Aufgabe dem angemeldeten Nutzer zugewiesen?
 *
 *  Warum das kein Direktvergleich sein darf: `tasks.assignee_id` ist ein FK auf
 *  `team_members(id)` (Migration 007), `ctx.userId` dagegen eine `users.id`.
 *  Die beiden UUID-Raeume sind disjunkt — `assigneeId === userId` trifft NIE zu
 *  und sperrt Nicht-Admins aus ihren eigenen projektlosen Aufgaben aus. Die
 *  Bruecke ist `team_members.user_id` (Migration 013); gleiches Vorgehen wie in
 *  time-entries.ts.
 *
 *  Ohne assigneeId faellt gar keine Abfrage an — das ist der Regelfall. */
async function isAssignedToMe(ctx: UserCtx, assigneeId: string | null | undefined): Promise<boolean> {
  if (!assigneeId || !ctx.userId) return false;
  const member = await teamRepo.get(assigneeId);
  return !!member?.userId && member.userId === ctx.userId;
}

/** Darf `ctx` diese projektlose Aufgabe sehen und aendern?
 *
 *  Zwei Wege fuehren dahin: die Aufgabe gehoert mir (created_by = meine
 *  users.id) oder sie ist mir zugewiesen (assignee_id -> team_members.user_id
 *  = meine users.id). Der Ersteller-Vergleich steht zuerst, weil er ohne
 *  Datenbankzugriff auskommt.
 *
 *  Ohne den Ersteller-Zweig war der haeufigste Fall ueberhaupt kaputt: wer
 *  sich selbst eine Aufgabe ohne Projekt und ohne Zuweisung anlegt, konnte
 *  sie anschliessend weder aendern noch abhaken noch loeschen (403). */
async function ownsPersonalTask(
  ctx: UserCtx,
  task: { createdById?: string | null; assigneeId?: string | null },
): Promise<boolean> {
  if (!ctx.userId) return false;
  if (task.createdById && task.createdById === ctx.userId) return true;
  return isAssignedToMe(ctx, task.assigneeId);
}

/** Memoisierte Variante fuer die Listen-Route: dort wird derselbe Test ueber
 *  viele Zeilen gefahren, ein ungepufferter Aufruf waere ein DB-Roundtrip je
 *  Aufgabe. Zusaetzlich greift `uq_team_members_user_id` (Migration 013) —
 *  je Nutzer gibt es hoechstens EIN Team-Mitglied. Sobald das eigene gefunden
 *  ist, kann jede andere assignee_id nur noch fremd sein, und es braucht gar
 *  keine weitere Abfrage. */
function assignedToMeChecker(ctx: UserCtx): (assigneeId: string | null | undefined) => Promise<boolean> {
  const seen = new Map<string, boolean>();
  let ownMemberId: string | null = null;
  return async (assigneeId) => {
    if (!assigneeId || !ctx.userId) return false;
    if (ownMemberId) return assigneeId === ownMemberId;
    const cached = seen.get(assigneeId);
    if (cached !== undefined) return cached;
    const mine = await isAssignedToMe(ctx, assigneeId);
    seen.set(assigneeId, mine);
    if (mine) ownMemberId = assigneeId;
    return mine;
  };
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
  const assignedToMe = assignedToMeChecker(ctx);

  const filtered: typeof all = [];
  for (const t of all) {
    if (t.project) {
      if (visibleNames.has(t.project)) filtered.push(t);
      continue;
    }
    // Ohne Projekt ist die Aufgabe persoenlich: sichtbar fuer den Ersteller
    // und fuer die zugewiesene Person.
    if (t.createdById && t.createdById === ctx.userId) {
      filtered.push(t);
      continue;
    }
    if (await assignedToMe(t.assigneeId)) filtered.push(t);
  }
  return c.json(filtered);
});

tasksRoutes.get("/tasks/:id", async (c) => {
  const task = await taskRepo.get(c.req.param("id"));
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = task.project ? await canSeeProjectByName(ctx, task.project) : await ownsPersonalTask(ctx, task);
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
  const task = await taskRepo.save(body.text, body.project, c.var.userId);
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
    emitForProjectName({ type: "task", action: "created", id: task.id }, body.project, { actorId: c.var.userId });
    return c.json(updated, 201);
  }
  emitForProjectName({ type: "task", action: "created", id: task.id }, body.project, { actorId: c.var.userId });
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
  if (!prev) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = prev.project ? await canSeeProjectByName(ctx, prev.project) : await ownsPersonalTask(ctx, prev);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  const task = await taskRepo.update(id, body);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  // prev.project (Stand VOR dem Update) ist hier die einzige verfuegbare
  // Projektangabe — taskRepo.update() aendert das Projekt nicht.
  emitForProjectName({ type: "task", action: "updated", id }, prev.project, { actorId: c.var.userId });
  return c.json(task);
});

tasksRoutes.patch("/tasks/:id/complete", async (c) => {
  const id = c.req.param("id");
  const task = await taskRepo.get(id);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = task.project ? await canSeeProjectByName(ctx, task.project) : await ownsPersonalTask(ctx, task);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  const ok = await taskRepo.complete(id);
  if (ok) emitForProjectName({ type: "task", action: "completed", id }, task.project, { actorId: c.var.userId });
  return c.json({ ok });
});

// PATCH /tasks/complete (Legacy-Kompatibilitaet, per Freitext statt ID) ist
// ersatzlos entfallen. Sie hatte keinerlei Rechtepruefung und hakte damit
// Aufgaben in Projekten ab, die der Aufrufer nicht einmal sehen darf. Ein
// nachtraeglicher ACL-Check ist dort nicht sauber moeglich, weil die Route die
// Aufgabe erst in taskRepo.complete() per Textvergleich aufloest und der
// Route selbst kein Datensatz vorliegt, gegen den sie pruefen koennte.
// Ihr einziger Aufrufer war die Tool-Fläche des Telegram-Bots, die mit AP0
// entfernt wurde — weder web/ noch src/ noch tests/ rufen sie noch auf.
// Der korrekte Weg ist PATCH /tasks/:id/complete (mit ACL, siehe oben).

tasksRoutes.delete("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const task = await taskRepo.get(id);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = task.project ? await canSeeProjectByName(ctx, task.project) : await ownsPersonalTask(ctx, task);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  const ok = await taskRepo.delete(id);
  if (ok) emitForProjectName({ type: "task", action: "deleted", id }, task.project, { actorId: c.var.userId });
  return c.json({ ok });
});
