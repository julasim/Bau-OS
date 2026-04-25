// Companies-API (Migration 006). Firmen sind ab jetzt first-class Entity —
// Mitglieder verlinken ueber company_id FK statt Freitext. Vorteile: Firma
// umbenennen, alle Mitglieder ziehen mit; "Wer arbeitet bei Firma X?" in
// einer Query.
import { Hono } from "hono";
import { teamRepo } from "../../data/index.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";

export const companiesRoutes = new Hono<AppEnv>();

companiesRoutes.get("/companies", async (c) => {
  if (!teamRepo.listCompanies) return c.json([]);
  return c.json(await teamRepo.listCompanies());
});

companiesRoutes.get("/companies/:id", async (c) => {
  if (!teamRepo.getCompany) return c.json({ error: "Nicht unterstützt" }, 501);
  const company = await teamRepo.getCompany(c.req.param("id"));
  if (!company) return c.json({ error: "Firma nicht gefunden" }, 404);
  return c.json(company);
});

// Anlegen. Body: { name, address?, website?, notes? }. name ist Pflicht und
// UNIQUE — bei Konflikt gibt's einen 409.
companiesRoutes.post("/companies", async (c) => {
  if (!teamRepo.addCompany) return c.json({ error: "Nicht unterstützt" }, 501);
  const body = await c.req.json<{
    name: string;
    address?: string;
    website?: string;
    notes?: string;
  }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Name erforderlich" }, 400);
  try {
    const company = await teamRepo.addCompany({
      name,
      address: body.address?.trim() || null,
      website: body.website?.trim() || null,
      notes: body.notes?.trim() || null,
    });
    emit({ type: "team", action: "created", id: company.id });
    return c.json(company, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return c.json({ error: "Firma mit diesem Namen existiert bereits" }, 409);
    }
    return c.json({ error: "Anlegen fehlgeschlagen: " + msg }, 500);
  }
});

companiesRoutes.patch("/companies/:id", async (c) => {
  if (!teamRepo.updateCompany) return c.json({ error: "Nicht unterstützt" }, 501);
  const id = c.req.param("id");
  const body =
    await c.req.json<Partial<{ name: string; address: string | null; website: string | null; notes: string | null }>>();
  const updates: Record<string, unknown> = {};
  for (const key of ["name", "address", "website", "notes"] as const) {
    if (key in body) {
      const v = body[key];
      updates[key] = typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : (v ?? null);
    }
  }
  try {
    const company = await teamRepo.updateCompany(id, updates);
    if (!company) return c.json({ error: "Firma nicht gefunden" }, 404);
    emit({ type: "team", action: "updated", id });
    return c.json(company);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return c.json({ error: "Firma mit diesem Namen existiert bereits" }, 409);
    }
    return c.json({ error: "Update fehlgeschlagen: " + msg }, 500);
  }
});

companiesRoutes.delete("/companies/:id", async (c) => {
  if (!teamRepo.deleteCompany) return c.json({ error: "Nicht unterstützt" }, 501);
  const id = c.req.param("id");
  const ok = await teamRepo.deleteCompany(id);
  if (ok) emit({ type: "team", action: "deleted", id });
  return c.json({ ok });
});
