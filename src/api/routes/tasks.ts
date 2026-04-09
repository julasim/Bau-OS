import { Hono } from "hono";
import { saveTask, listTasks, getTask, updateTask, completeTask, deleteTask } from "../../vault/index.js";

export const tasksRoutes = new Hono();

tasksRoutes.get("/tasks", (c) => {
  const project = c.req.query("project");
  return c.json(listTasks(project));
});

tasksRoutes.get("/tasks/:id", (c) => {
  const task = getTask(c.req.param("id"));
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  return c.json(task);
});

tasksRoutes.post("/tasks", async (c) => {
  const body = await c.req.json<{ text: string; project?: string; assignee?: string; date?: string; location?: string }>();
  if (!body.text) return c.json({ error: "Text erforderlich" }, 400);
  const task = saveTask(body.text, body.project);
  // Apply optional fields
  if (body.assignee || body.date || body.location) {
    const updated = updateTask(task.id, {
      assignee: body.assignee || null,
      date: body.date || null,
      location: body.location || null,
    }, body.project);
    return c.json(updated, 201);
  }
  return c.json(task, 201);
});

tasksRoutes.put("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{ text: string; status: "open" | "in_progress" | "done"; assignee: string | null; date: string | null; location: string | null }>>();
  const task = updateTask(id, body);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  return c.json(task);
});

tasksRoutes.patch("/tasks/:id/complete", (c) => {
  const ok = completeTask(c.req.param("id"));
  return c.json({ ok });
});

// Legacy compat
tasksRoutes.patch("/tasks/complete", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Text erforderlich" }, 400);
  const ok = completeTask(text, project);
  return c.json({ success: ok });
});

tasksRoutes.delete("/tasks/:id", (c) => {
  const ok = deleteTask(c.req.param("id"));
  return c.json({ ok });
});
