import { Hono } from "hono";
import { projectRepo, taskRepo, terminRepo } from "../../data/index.js";
import type { ProjectUpdate } from "../../data/types.js";
import { emit } from "../events.js";

export const projectsRoutes = new Hono();

// Whitelist der Felder, die per PATCH /projects/:name gesetzt werden duerfen.
// Andere Keys im Body werden stillschweigend verworfen (keine Error), damit
// Clients robust erweitert werden koennen ohne API-Breaking-Change.
const PATCHABLE_FIELDS: readonly (keyof ProjectUpdate)[] = [
  "description",
  "status",
  "color",
  "projektnummer",
  "bauherr",
  "standort",
  "projektart",
  "nutzung",
  "phase",
  "startDate",
  "endDate",
] as const;

function normalizePatchValue(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined; // ignoriere falsche Typen
  const trimmed = v.trim();
  // Leerer String = explizit leeren (wie null).
  return trimmed === "" ? null : trimmed;
}

// Alle Projekte
projectsRoutes.get("/projects", async (c) => {
  const names = await projectRepo.list();
  const projects = (await Promise.all(names.map((name) => projectRepo.getInfo(name)))).filter(Boolean);
  return c.json(projects);
});

// Projekt anlegen. Body: { name, description?, projektnummer?, bauherr?,
// standort?, projektart?, nutzung?, phase?, startDate?, endDate? }.
// create() ist idempotent — existiert das Projekt schon, werden nur die
// gesetzten Stammdaten-Felder gepatcht. Wir geben in dem Fall 200 zurueck;
// bei echter Neuanlage 201.
projectsRoutes.post("/projects", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "Name erforderlich" }, 400);

  // Existenz-Check vor create, damit wir 201 vs 200 zurueckgeben koennen.
  const already = await projectRepo.getInfo(name);

  // Nur erlaubte Stammdaten-Felder an create() weiterreichen. Leere Strings
  // werden zu null — konsistent mit dem PATCH-Endpoint.
  const normalize = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };

  const ok = await projectRepo.create(name, {
    description: normalize(body.description),
    projektnummer: normalize(body.projektnummer),
    bauherr: normalize(body.bauherr),
    standort: normalize(body.standort),
    projektart: normalize(body.projektart),
    nutzung: normalize(body.nutzung),
    phase: normalize(body.phase),
    startDate: normalize(body.startDate),
    endDate: normalize(body.endDate),
  });
  if (!ok) return c.json({ error: "Ungueltiger Projektname" }, 400);

  emit({ type: "project", action: already ? "updated" : "created", id: name });
  const info = await projectRepo.getInfo(name);
  return c.json(info, already ? 200 : 201);
});

// Projekt-Detail
projectsRoutes.get("/projects/:name", async (c) => {
  const name = c.req.param("name");
  const info = await projectRepo.getInfo(name);
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
  return c.json(info);
});

// Projekt-Stammdaten patchen (Migration 004).
// Body: { [field]: string | null }. Whitelist siehe PATCHABLE_FIELDS.
projectsRoutes.patch("/projects/:name", async (c) => {
  const name = c.req.param("name");

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Body muss ein Objekt sein" }, 400);
  }

  // Nur erlaubte Felder uebernehmen, leere Strings → null.
  const patch: ProjectUpdate = {};
  for (const key of PATCHABLE_FIELDS) {
    if (key in body) {
      const normalized = normalizePatchValue(body[key]);
      if (normalized !== undefined) {
        (patch as Record<string, string | null>)[key] = normalized;
      }
    }
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: "Kein patchbares Feld im Body" }, 400);
  }

  const ok = await projectRepo.update(name, patch);
  if (!ok) {
    return c.json({ error: "Projekt nicht gefunden oder Update fehlgeschlagen" }, 404);
  }
  emit({ type: "project", action: "updated", id: name });

  const updated = await projectRepo.getInfo(name);
  return c.json(updated);
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
