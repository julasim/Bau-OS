import { Hono } from "hono";
import { listTeam, addTeamMember, removeTeamMember } from "../../vault/index.js";

export const teamRoutes = new Hono();

teamRoutes.get("/team", (c) => {
  return c.json(listTeam());
});

teamRoutes.post("/team", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  if (!name) return c.json({ error: "Name erforderlich" }, 400);
  const ok = addTeamMember(name);
  if (!ok) return c.json({ error: "Mitglied existiert bereits" }, 409);
  return c.json({ ok: true }, 201);
});

teamRoutes.delete("/team/:name", (c) => {
  const ok = removeTeamMember(c.req.param("name"));
  return c.json({ ok });
});
