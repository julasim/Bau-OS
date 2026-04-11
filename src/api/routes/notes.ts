import { Hono } from "hono";
import { noteRepo } from "../../data/index.js";
import { emit } from "../events.js";

export const notesRoutes = new Hono();

notesRoutes.get("/notes", async (c) => {
  const detailed = c.req.query("detailed");
  if (detailed === "1" && noteRepo.listDetailed) {
    const notes = await noteRepo.listDetailed(50);
    return c.json(notes);
  }
  const notes = await noteRepo.list();
  return c.json(notes);
});

notesRoutes.get("/notes/:name", async (c) => {
  const name = c.req.param("name");
  const content = await noteRepo.read(name);
  if (content === null) return c.json({ error: "Notiz nicht gefunden" }, 404);
  return c.json({ name, content });
});

notesRoutes.post("/notes", async (c) => {
  const { content, project } = await c.req.json<{ content: string; project?: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  const path = await noteRepo.save(content, project);
  emit({ type: "note", action: "created", project });
  return c.json({ path }, 201);
});

notesRoutes.put("/notes/:name", async (c) => {
  const name = c.req.param("name");
  const existing = await noteRepo.read(name);
  if (existing === null) return c.json({ error: "Notiz nicht gefunden" }, 404);

  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);

  const success = await noteRepo.update(name, content);
  if (success) emit({ type: "note", action: "updated", id: name });
  return c.json({ success });
});

notesRoutes.patch("/notes/:name/append", async (c) => {
  const name = c.req.param("name");
  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  const success = await noteRepo.append(name, content);
  if (success) emit({ type: "note", action: "updated", id: name });
  return c.json({ success });
});

notesRoutes.delete("/notes/:name", async (c) => {
  const name = c.req.param("name");
  const deleted = await noteRepo.delete(name);
  if (!deleted) return c.json({ error: "Notiz nicht gefunden" }, 404);
  emit({ type: "note", action: "deleted", id: name });
  return c.json({ deleted: name });
});
