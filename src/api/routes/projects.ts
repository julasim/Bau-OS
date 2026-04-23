import { Hono } from "hono";
import { projectRepo, taskRepo, terminRepo, teamRepo } from "../../data/index.js";
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

// Projekt umbenennen. Body: { newName: string }. 4 Fehlerfaelle, jeder mit
// eindeutiger Meldung — damit das Frontend spezifisch reagieren kann.
projectsRoutes.put("/projects/:name/rename", async (c) => {
  const oldName = c.req.param("name");
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  const newName = typeof body.newName === "string" ? body.newName.trim() : "";
  if (!newName) return c.json({ error: "newName erforderlich" }, 400);

  const result = await projectRepo.rename(oldName, newName);
  if (result === "invalid") return c.json({ error: "Ungueltiger Projektname" }, 400);
  if (result === "not-found") return c.json({ error: "Projekt nicht gefunden" }, 404);
  if (result === "conflict") return c.json({ error: "Projekt mit diesem Namen existiert bereits" }, 409);

  emit({ type: "project", action: "updated", id: newName });
  const info = await projectRepo.getInfo(newName);
  return c.json(info);
});

// Projekt als Markdown exportieren — kompaktes Projekt-Dossier mit Stammdaten,
// Team, Aufgaben, Terminen, Notizen-Index. Direkt zum Download via
// Content-Disposition. Keine PDF-Engine noetig — Markdown ist lesbar, portabel
// und kann clientseitig in jede andere Form gewandelt werden.
projectsRoutes.get("/projects/:name/export.md", async (c) => {
  const name = c.req.param("name");
  const info = await projectRepo.getInfo(name);
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);

  const [notes, tasks, termine, teamList] = await Promise.all([
    projectRepo.listNotes(name),
    taskRepo.list(name),
    terminRepo.list(name),
    teamRepo.list(),
  ]);
  const team = teamList.filter((m) => m.projectId === info.id);

  // Kleine Helfer: markdown-sichere Zeile oder "—" wenn leer.
  const md = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "—");
  const lines: string[] = [];
  lines.push(`# ${info.name}\n`);
  lines.push(`_Exportiert: ${new Date().toLocaleDateString("de-AT")}_\n`);

  lines.push(`## Stammdaten\n`);
  lines.push(`| Feld | Wert |`);
  lines.push(`|---|---|`);
  lines.push(`| Status | ${md(info.status)} |`);
  lines.push(`| Projektnummer | ${md(info.projektnummer)} |`);
  lines.push(`| Bauherr | ${md(info.bauherr)} |`);
  lines.push(`| Standort | ${md(info.standort)} |`);
  lines.push(`| Projektart | ${md(info.projektart)} |`);
  lines.push(`| Nutzung | ${md(info.nutzung)} |`);
  lines.push(`| Phase | ${md(info.phase)} |`);
  lines.push(`| Start | ${md(info.startDate)} |`);
  lines.push(`| Ende | ${md(info.endDate)} |`);
  lines.push("");

  if (info.description) {
    lines.push(`## Beschreibung\n`);
    lines.push(info.description);
    lines.push("");
  }

  if (team.length > 0) {
    lines.push(`## Team (${team.length})\n`);
    for (const m of team) {
      const contact = [m.email, m.phone].filter(Boolean).join(" · ");
      lines.push(`- **${m.name}**${m.role ? ` — ${m.role}` : ""}${contact ? ` (${contact})` : ""}`);
    }
    lines.push("");
  }

  if (termine.length > 0) {
    lines.push(`## Termine (${termine.length})\n`);
    for (const t of termine) {
      const when = t.datum + (t.uhrzeit ? ` ${t.uhrzeit}` : "");
      lines.push(`- **${when}** — ${t.text}`);
    }
    lines.push("");
  }

  const openTasks = tasks.filter((t) => t.status !== "done");
  const doneTasks = tasks.filter((t) => t.status === "done");
  if (tasks.length > 0) {
    lines.push(`## Aufgaben (${openTasks.length} offen / ${tasks.length} gesamt)\n`);
    for (const t of openTasks) lines.push(`- [ ] ${t.text}`);
    for (const t of doneTasks) lines.push(`- [x] ${t.text}`);
    lines.push("");
  }

  if (notes.length > 0) {
    lines.push(`## Notizen (${notes.length})\n`);
    for (const n of notes) lines.push(`- ${n}`);
    lines.push("");
  }

  const body = lines.join("\n");
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(info.name)}.md"`);
  return c.body(body);
});

// Projekt loeschen. projectRepo.delete() ist idempotent — auch wenn das
// Projekt nicht existiert, kommt true zurueck. Semantik: "stelle sicher, dass
// es weg ist". Wir geben 204 No Content zurueck, weil es nichts zu rendern gibt.
projectsRoutes.delete("/projects/:name", async (c) => {
  const name = c.req.param("name");
  const ok = await projectRepo.delete(name);
  if (!ok) return c.json({ error: "Ungueltiger Projektname" }, 400);
  emit({ type: "project", action: "deleted", id: name });
  return c.body(null, 204);
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
