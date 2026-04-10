import { Hono } from "hono";
import { projectRepo, taskRepo, terminRepo } from "../../data/index.js";
import { emit } from "../events.js";

export const projectsRoutes = new Hono();

// Alle Projekte
projectsRoutes.get("/projects", async (c) => {
  const names = await projectRepo.list();
  const projects = (await Promise.all(names.map((name) => projectRepo.getInfo(name)))).filter(Boolean);
  return c.json(projects);
});

// Projekt-Detail
projectsRoutes.get("/projects/:name", async (c) => {
  const name = c.req.param("name");
  const info = await projectRepo.getInfo(name);
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
  return c.json(info);
});

// Projekt-Notizen
projectsRoutes.get("/projects/:name/notes", async (c) => {
  const name = c.req.param("name");
  return c.json(await projectRepo.listNotes(name));
});

projectsRoutes.get("/projects/:name/notes/:note", async (c) => {
  const name = c.req.param("name");
  const note = c.req.param("note");
  const content = await projectRepo.readNote(name, note);
  if (!content) return c.json({ error: "Notiz nicht gefunden" }, 404);
  return c.json({ name: note, content });
});

// Projekt-Aufgaben
projectsRoutes.get("/projects/:name/tasks", async (c) => {
  const name = c.req.param("name");
  return c.json(await taskRepo.list(name));
});

projectsRoutes.post("/projects/:name/tasks", async (c) => {
  const name = c.req.param("name");
  const { text } = await c.req.json<{ text: string }>();
  await taskRepo.save(text, name);
  emit({ type: "task", action: "created", project: name });
  return c.json({ ok: true });
});

projectsRoutes.patch("/projects/:name/tasks", async (c) => {
  const name = c.req.param("name");
  const { text } = await c.req.json<{ text: string }>();
  const ok = await taskRepo.complete(text, name);
  if (ok) emit({ type: "task", action: "completed", project: name });
  return c.json({ ok });
});

// Projekt-Termine
projectsRoutes.get("/projects/:name/termine", async (c) => {
  const name = c.req.param("name");
  return c.json(await terminRepo.list(name));
});

projectsRoutes.post("/projects/:name/termine", async (c) => {
  const name = c.req.param("name");
  const { datum, text, uhrzeit } = await c.req.json<{ datum: string; text: string; uhrzeit?: string }>();
  await terminRepo.save(datum, text, uhrzeit, name);
  emit({ type: "termin", action: "created", project: name });
  return c.json({ ok: true });
});

projectsRoutes.delete("/projects/:name/termine", async (c) => {
  const name = c.req.param("name");
  const { text } = await c.req.json<{ text: string }>();
  const ok = await terminRepo.delete(text, name);
  if (ok) emit({ type: "termin", action: "deleted", project: name });
  return c.json({ ok });
});
