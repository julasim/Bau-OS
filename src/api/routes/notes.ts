import { Hono } from "hono";
import { saveNote, listNotes, readNote, appendToNote, deleteNote } from "../../vault/index.js";

export const notesRoutes = new Hono();

notesRoutes.get("/notes", (c) => {
  const notes = listNotes();
  return c.json(notes);
});

notesRoutes.get("/notes/:name", (c) => {
  const name = c.req.param("name");
  const content = readNote(name);
  if (content === null) return c.json({ error: "Notiz nicht gefunden" }, 404);
  return c.json({ name, content });
});

notesRoutes.post("/notes", async (c) => {
  const { content, project } = await c.req.json<{ content: string; project?: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  const path = saveNote(content, project);
  return c.json({ path }, 201);
});

notesRoutes.put("/notes/:name", async (c) => {
  const name = c.req.param("name");
  const existing = readNote(name);
  if (existing === null) return c.json({ error: "Notiz nicht gefunden" }, 404);

  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);

  // updateNote: überschreibt die Datei komplett
  const { updateNote } = await import("../../vault/notes.js");
  const success = updateNote(name, content);
  return c.json({ success });
});

notesRoutes.patch("/notes/:name/append", async (c) => {
  const name = c.req.param("name");
  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  appendToNote(name, content);
  return c.json({ success: true });
});

notesRoutes.delete("/notes/:name", (c) => {
  const name = c.req.param("name");
  const deleted = deleteNote(name);
  if (!deleted) return c.json({ error: "Notiz nicht gefunden" }, 404);
  return c.json({ deleted: name });
});
