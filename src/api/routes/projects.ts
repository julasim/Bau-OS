import { Hono } from "hono";
import {
  listProjects,
  getProjectInfo,
  listProjectNotes,
  readProjectNote,
  listTasks,
  saveTask,
  completeTask,
  listTermine,
  saveTermin,
  deleteTermin,
} from "../../vault/index.js";

export const projectsRoutes = new Hono();

// Alle Projekte
projectsRoutes.get("/projects", (c) => {
  const names = listProjects();
  const projects = names.map((name) => getProjectInfo(name)).filter(Boolean);
  return c.json(projects);
});

// Projekt-Detail
projectsRoutes.get("/projects/:name", (c) => {
  const name = c.req.param("name");
  const info = getProjectInfo(name);
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
  return c.json(info);
});

// Projekt-Notizen
projectsRoutes.get("/projects/:name/notes", (c) => {
  const name = c.req.param("name");
  return c.json(listProjectNotes(name));
});

projectsRoutes.get("/projects/:name/notes/:note", (c) => {
  const name = c.req.param("name");
  const note = c.req.param("note");
  const content = readProjectNote(name, note);
  if (!content) return c.json({ error: "Notiz nicht gefunden" }, 404);
  return c.json({ name: note, content });
});

// Projekt-Aufgaben
projectsRoutes.get("/projects/:name/tasks", (c) => {
  const name = c.req.param("name");
  return c.json(listTasks(name));
});

projectsRoutes.post("/projects/:name/tasks", async (c) => {
  const name = c.req.param("name");
  const { text } = await c.req.json<{ text: string }>();
  saveTask(text, name);
  return c.json({ ok: true });
});

projectsRoutes.patch("/projects/:name/tasks", async (c) => {
  const name = c.req.param("name");
  const { text } = await c.req.json<{ text: string }>();
  const ok = completeTask(text, name);
  return c.json({ ok });
});

// Projekt-Termine
projectsRoutes.get("/projects/:name/termine", (c) => {
  const name = c.req.param("name");
  return c.json(listTermine(name));
});

projectsRoutes.post("/projects/:name/termine", async (c) => {
  const name = c.req.param("name");
  const { datum, text, uhrzeit } = await c.req.json<{ datum: string; text: string; uhrzeit?: string }>();
  saveTermin(datum, text, uhrzeit, name);
  return c.json({ ok: true });
});

projectsRoutes.delete("/projects/:name/termine", async (c) => {
  const name = c.req.param("name");
  const { text } = await c.req.json<{ text: string }>();
  const ok = deleteTermin(text, name);
  return c.json({ ok });
});
