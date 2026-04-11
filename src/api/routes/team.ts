import { Hono } from "hono";
import { teamRepo } from "../../data/index.js";
import { emit } from "../events.js";

export const teamRoutes = new Hono();

// Alle Mitglieder
teamRoutes.get("/team", async (c) => {
  return c.json(await teamRepo.list());
});

// Einzelnes Mitglied
teamRoutes.get("/team/:id", async (c) => {
  const member = await teamRepo.get(c.req.param("id"));
  if (!member) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  return c.json(member);
});

// Mitglied hinzufuegen
teamRoutes.post("/team", async (c) => {
  const body = await c.req.json<{ name: string; role?: string; email?: string; phone?: string; company?: string }>();
  if (!body.name) return c.json({ error: "Name erforderlich" }, 400);

  try {
    const member = await teamRepo.add({
      name: body.name,
      role: body.role ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      company: body.company ?? null,
      projectId: null,
    });
    emit({ type: "team", action: "created", id: member.id });
    return c.json(member, 201);
  } catch {
    return c.json({ error: "Mitglied existiert bereits" }, 409);
  }
});

// Mitglied aktualisieren
teamRoutes.patch("/team/:id", async (c) => {
  const id = c.req.param("id");
  const updates =
    await c.req.json<Partial<{ name: string; role: string; email: string; phone: string; company: string }>>();
  const member = await teamRepo.update(id, updates);
  if (!member) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  emit({ type: "team", action: "updated", id });
  return c.json(member);
});

// Mitglied entfernen
teamRoutes.delete("/team/:name", async (c) => {
  const name = c.req.param("name");
  const ok = await teamRepo.remove(name);
  if (ok) emit({ type: "team", action: "deleted" });
  return c.json({ ok });
});
