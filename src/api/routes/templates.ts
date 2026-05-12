// ============================================================
// Bau-OS — Templates-Routes (Phase 6c)
// ============================================================
// CRUD fuer Markdown-Vorlagen + render-Endpoint fuer Apply-Logik
// in NotesView/MeetingsView.
//
//   GET    /api/templates?kind=meeting        → Liste
//   GET    /api/templates/:id                  → einzeln
//   POST   /api/templates                      → anlegen
//   PATCH  /api/templates/:id                  → updaten
//   DELETE /api/templates/:id                  → loeschen
//   GET    /api/templates/:id/render?project=X → mit Variablen ersetzt
//   GET    /api/templates/_variables           → Liste der Placeholder
// ============================================================

import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderTemplate,
  listAvailableVariables,
  type TemplateKind,
} from "../../data/db-templates.js";
import {
  listCustomVariables,
  createCustomVariable,
  updateCustomVariable,
  deleteCustomVariable,
} from "../../data/db-custom-placeholders.js";

export const templatesRoutes = new Hono<AppEnv>();

const VALID_KINDS: TemplateKind[] = ["note", "meeting", "bautagebuch"];

// ── Variablen-Liste (built-in + custom) ───────────────────────────────────
templatesRoutes.get("/templates/_variables", async (c) => {
  const builtin = listAvailableVariables();
  let custom: { name: string; description: string }[] = [];
  try {
    const cvs = await listCustomVariables();
    custom = cvs.map((cv) => ({ name: cv.name, description: cv.description ?? cv.value ?? "Eigener Platzhalter" }));
  } catch {
    /* DB nicht verfügbar */
  }
  return c.json([...builtin, ...custom]);
});

// ── Custom Variables CRUD ─────────────────────────────────────────────────
templatesRoutes.get("/templates/custom-variables", async (c) => {
  const list = await listCustomVariables();
  return c.json(list);
});

templatesRoutes.post("/templates/custom-variables", async (c) => {
  let body: { name?: string; description?: string | null; value?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  if (!body.name?.trim()) return c.json({ error: "name ist Pflicht" }, 400);
  if (typeof body.value !== "string") return c.json({ error: "value ist Pflicht" }, 400);
  const created = await createCustomVariable({
    name: body.name.trim(),
    description: body.description ?? null,
    value: body.value,
  });
  return c.json(created, 201);
});

templatesRoutes.patch("/templates/custom-variables/:cvId", async (c) => {
  const cvId = c.req.param("cvId");
  let body: { name?: string; description?: string | null; value?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  const updated = await updateCustomVariable(cvId, body);
  if (!updated) return c.json({ error: "Variable nicht gefunden" }, 404);
  return c.json(updated);
});

templatesRoutes.delete("/templates/custom-variables/:cvId", async (c) => {
  const ok = await deleteCustomVariable(c.req.param("cvId"));
  return c.json({ ok });
});

// ── List ───────────────────────────────────────────────────────────────────
templatesRoutes.get("/templates", async (c) => {
  const kindParam = c.req.query("kind");
  if (kindParam && !VALID_KINDS.includes(kindParam as TemplateKind)) {
    return c.json({ error: `kind muss einer von: ${VALID_KINDS.join(", ")}` }, 400);
  }
  const list = await listTemplates(kindParam as TemplateKind | undefined);
  return c.json(list);
});

// ── Render ─────────────────────────────────────────────────────────────────
// Liefert das Template mit Variablen ersetzt — fuer Apply-Logik in der UI.
// Project ist optional: wenn weggelassen, bleiben projekt-spezifische
// Placeholder leer. Muss VOR /:id stehen sonst greift die Catch-All-Route.
templatesRoutes.get("/templates/:id/render", async (c) => {
  const id = c.req.param("id");
  const project = c.req.query("project") ?? null;
  const dbUser = c.var.dbUser;
  const userName = dbUser?.displayName ?? dbUser?.username ?? null;

  const result = await renderTemplate(id, { project, currentUserName: userName });
  if (!result) return c.json({ error: "Template nicht gefunden" }, 404);
  return c.json({
    template: result.template,
    rendered: result.rendered,
  });
});

// ── Single ─────────────────────────────────────────────────────────────────
templatesRoutes.get("/templates/:id", async (c) => {
  const t = await getTemplate(c.req.param("id"));
  if (!t) return c.json({ error: "Template nicht gefunden" }, 404);
  return c.json(t);
});

// ── Create ─────────────────────────────────────────────────────────────────
templatesRoutes.post("/templates", async (c) => {
  let body: { kind?: string; name?: string; description?: string | null; body?: string; isDefault?: boolean };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  if (!body.kind || !VALID_KINDS.includes(body.kind as TemplateKind)) {
    return c.json({ error: `kind muss einer von: ${VALID_KINDS.join(", ")}` }, 400);
  }
  if (!body.name?.trim()) return c.json({ error: "name ist Pflicht" }, 400);
  if (typeof body.body !== "string") return c.json({ error: "body ist Pflicht" }, 400);

  const created = await createTemplate(
    {
      kind: body.kind as TemplateKind,
      name: body.name.trim(),
      description: body.description ?? null,
      body: body.body,
      isDefault: body.isDefault === true,
    },
    c.var.userId,
  );
  return c.json(created, 201);
});

// ── Update ─────────────────────────────────────────────────────────────────
templatesRoutes.patch("/templates/:id", async (c) => {
  const id = c.req.param("id");
  let body: { name?: string; description?: string | null; body?: string; isDefault?: boolean };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  const updated = await updateTemplate(id, body);
  if (!updated) return c.json({ error: "Template nicht gefunden" }, 404);
  return c.json(updated);
});

// ── Delete ─────────────────────────────────────────────────────────────────
templatesRoutes.delete("/templates/:id", async (c) => {
  const ok = await deleteTemplate(c.req.param("id"));
  return c.json({ ok });
});
