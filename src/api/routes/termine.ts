import { Hono } from "hono";
import { saveTermin, listTermine, getTermin, updateTermin, deleteTermin } from "../../vault/index.js";

export const termineRoutes = new Hono();

termineRoutes.get("/termine", (c) => {
  const project = c.req.query("project");
  return c.json(listTermine(project));
});

termineRoutes.get("/termine/:id", (c) => {
  const termin = getTermin(c.req.param("id"));
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  return c.json(termin);
});

termineRoutes.post("/termine", async (c) => {
  const body = await c.req.json<{
    datum: string; text: string; uhrzeit?: string; endzeit?: string;
    location?: string; assignees?: string[]; project?: string;
  }>();
  if (!body.datum || !body.text) return c.json({ error: "Datum und Text erforderlich" }, 400);
  const termin = saveTermin(body.datum, body.text, body.uhrzeit, body.project);
  if (typeof termin === "string") return c.json({ error: termin }, 400);
  if (body.endzeit || body.location || body.assignees?.length) {
    const updated = updateTermin(termin.id, {
      endzeit: body.endzeit || null,
      location: body.location || null,
      assignees: body.assignees || [],
    }, body.project);
    return c.json(updated, 201);
  }
  return c.json(termin, 201);
});

termineRoutes.put("/termine/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<Partial<{
    text: string; datum: string; uhrzeit: string | null; endzeit: string | null;
    location: string | null; assignees: string[];
  }>>();
  const termin = updateTermin(id, body);
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  return c.json(termin);
});

termineRoutes.delete("/termine/:id", (c) => {
  const ok = deleteTermin(c.req.param("id"));
  return c.json({ ok });
});

// Legacy compat
termineRoutes.delete("/termine", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Text erforderlich" }, 400);
  const ok = deleteTermin(text, project);
  return c.json({ success: ok });
});
