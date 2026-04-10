import { Hono } from "hono";
import { taskRepo } from "../../data/index.js";
import { emit } from "../events.js";

export const tasksRoutes = new Hono();

tasksRoutes.get("/tasks", async (c) => {
  const project = c.req.query("project");
  return c.json(await taskRepo.list(project));
});

tasksRoutes.get("/tasks/:id", async (c) => {
  const task = await taskRepo.get(c.req.param("id"));
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  return c.json(task);
});

tasksRoutes.post("/tasks", async (c) => {
  const body = await c.req.json<{
    text: string;
    project?: string;
    assignee?: string;
    date?: string;
    location?: string;
  }>();
  if (!body.text) return c.json({ error: "Text erforderlich" }, 400);
  const task = await taskRepo.save(body.text, body.project);
  // Apply optional fields
  if (body.assignee || body.date || body.location) {
    const updated = await taskRepo.update(
      task.id,
      {
        assignee: body.assignee || null,
        date: body.date || null,
        location: body.location || null,
      },
      body.project,
    );
    emit({ type: "task", action: "created", id: task.id, project: body.project });
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
      date: string | null;
      location: string | null;
    }>
  >();
  const task = await taskRepo.update(id, body);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  emit({ type: "task", action: "updated", id });
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
