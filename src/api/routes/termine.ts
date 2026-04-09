import { Hono } from "hono";
import { saveTermin, listTermine, deleteTermin } from "../../vault/index.js";

export const termineRoutes = new Hono();

termineRoutes.get("/termine", (c) => {
  const project = c.req.query("project");
  const termine = listTermine(project);
  return c.json(termine);
});

termineRoutes.post("/termine", async (c) => {
  const { datum, text, uhrzeit, project } = await c.req.json<{
    datum: string;
    text: string;
    uhrzeit?: string;
    project?: string;
  }>();
  if (!datum || !text) return c.json({ error: "Datum und Text erforderlich" }, 400);
  saveTermin(datum, text, uhrzeit, project);
  return c.json({ success: true }, 201);
});

termineRoutes.delete("/termine", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Termin-Text erforderlich" }, 400);
  const success = deleteTermin(text, project);
  return c.json({ success });
});
