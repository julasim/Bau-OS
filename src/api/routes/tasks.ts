import { Hono } from "hono";
import { saveTask, listTasks, completeTask } from "../../vault/index.js";

export const tasksRoutes = new Hono();

tasksRoutes.get("/tasks", (c) => {
  const project = c.req.query("project");
  const tasks = listTasks(project);
  return c.json(tasks);
});

tasksRoutes.post("/tasks", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Aufgabe erforderlich" }, 400);
  saveTask(text, project);
  return c.json({ success: true }, 201);
});

tasksRoutes.patch("/tasks/complete", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Aufgabe erforderlich" }, 400);
  const success = completeTask(text, project);
  return c.json({ success });
});
