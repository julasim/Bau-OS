import { Hono } from "hono";
import { terminRepo } from "../../data/index.js";
import { emit } from "../events.js";

export const termineRoutes = new Hono();

termineRoutes.get("/termine", async (c) => {
  const project = c.req.query("project");
  return c.json(await terminRepo.list(project));
});

termineRoutes.get("/termine/:id", async (c) => {
  const termin = await terminRepo.get(c.req.param("id"));
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  return c.json(termin);
});

termineRoutes.post("/termine", async (c) => {
  const body = await c.req.json<{
    datum: string;
    text: string;
    uhrzeit?: string;
    endzeit?: string;
    location?: string;
    assignees?: string[];
    project?: string;
  }>();
  if (!body.datum || !body.text) return c.json({ error: "Datum und Text erforderlich" }, 400);
  const termin = await terminRepo.save(body.datum, body.text, body.uhrzeit, body.project);
  if (typeof termin === "string") return c.json({ error: termin }, 400);
  if (body.endzeit || body.location || body.assignees?.length) {
    const updated = await terminRepo.update(
      termin.id,
      {
        endzeit: body.endzeit || null,
        location: body.location || null,
        assignees: body.assignees || [],
      },
      body.project,
    );
    emit({ type: "termin", action: "created", id: termin.id, project: body.project });
    return c.json(updated, 201);
  }
  emit({ type: "termin", action: "created", id: termin.id, project: body.project });
  return c.json(termin, 201);
});

termineRoutes.put("/termine/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<
    Partial<{
      text: string;
      datum: string;
      uhrzeit: string | null;
      endzeit: string | null;
      location: string | null;
      assignees: string[];
    }>
  >();
  const termin = await terminRepo.update(id, body);
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  emit({ type: "termin", action: "updated", id });
  return c.json(termin);
});

termineRoutes.delete("/termine/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await terminRepo.delete(id);
  if (ok) emit({ type: "termin", action: "deleted", id });
  return c.json({ ok });
});

// Legacy compat
termineRoutes.delete("/termine", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Text erforderlich" }, 400);
  const ok = await terminRepo.delete(text, project);
  if (ok) emit({ type: "termin", action: "deleted", project });
  return c.json({ success: ok });
});
