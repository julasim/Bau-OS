import { Hono } from "hono";
import { projectRepo, taskRepo, terminRepo, teamRepo } from "../../data/index.js";
import { findDbUserById } from "../auth.js";
import { getVisibleProjectIds, canSeeProjectByName, type UserCtx } from "../../data/access.js";
import type { ProjectUpdate } from "../../data/types.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import { notifyProjectAccessGranted } from "../../notifications.js";

// Hilfs-Builder: holt UserCtx aus dem Hono-Context — eine Stelle weniger,
// an der man c.var-Felder vergisst.
function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

export const projectsRoutes = new Hono<AppEnv>();

// Whitelist der Felder, die per PATCH /projects/:name gesetzt werden duerfen.
// Andere Keys im Body werden stillschweigend verworfen (keine Error), damit
// Clients robust erweitert werden koennen ohne API-Breaking-Change.
// Numerische Felder (budget, budgetUsed) werden separat behandelt.
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
  "bauherrId",
  "parentId",
] as const;

function normalizePatchValue(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined; // ignoriere falsche Typen
  const trimmed = v.trim();
  // Leerer String = explizit leeren (wie null).
  return trimmed === "" ? null : trimmed;
}

// Alle Projekte — Phase 4 scoped: Admin sieht alles, User nur user_projects.
projectsRoutes.get("/projects", async (c) => {
  const visible = await getVisibleProjectIds(userCtx(c));
  const names = await projectRepo.list(visible);
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

  // Phase 3: Ersteller-UUID aus Auth-Context durchreichen. Im FS-Mode oder
  // bei Legacy-Konten ohne UUID bleibt das Feld einfach NULL — die alte
  // Semantik bleibt erhalten.
  const createdById = c.var.userId ?? null;
  const ok = await projectRepo.create(
    name,
    {
      description: normalize(body.description),
      projektnummer: normalize(body.projektnummer),
      bauherr: normalize(body.bauherr),
      standort: normalize(body.standort),
      projektart: normalize(body.projektart),
      nutzung: normalize(body.nutzung),
      phase: normalize(body.phase),
      startDate: normalize(body.startDate),
      endDate: normalize(body.endDate),
    },
    createdById,
  );
  if (!ok) return c.json({ error: "Ungueltiger Projektname" }, 400);

  emit({ type: "project", action: already ? "updated" : "created", id: name });
  const info = await projectRepo.getInfo(name);
  return c.json(info, already ? 200 : 201);
});

// Projekt-Detail — Phase 4: Zugriff pruefen.
projectsRoutes.get("/projects/:name", async (c) => {
  const name = c.req.param("name");
  const info = await projectRepo.getInfo(name);
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  return c.json(info);
});

// Projekt-Stammdaten patchen (Migration 004).
// Body: { [field]: string | null }. Whitelist siehe PATCHABLE_FIELDS.
// Phase-4-Schreibschutz: nur Admin oder der Ersteller darf editieren.
projectsRoutes.patch("/projects/:name", async (c) => {
  const name = c.req.param("name");
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const info = await projectRepo.getInfo(name);
    if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
    if (info.createdById !== ctx.userId) {
      return c.json({ error: "Nur Admin oder Ersteller darf editieren" }, 403);
    }
  }

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
  // Numerische Budget-Felder: null = explizit leeren, number = setzen,
  // undefined/fehlend = unveraendert lassen.
  if ("budget" in body) {
    patch.budget = body.budget === null ? null : typeof body.budget === "number" ? body.budget : undefined;
  }
  if ("budgetUsed" in body) {
    patch.budgetUsed =
      body.budgetUsed === null ? null : typeof body.budgetUsed === "number" ? body.budgetUsed : undefined;
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
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const info = await projectRepo.getInfo(oldName);
    if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
    if (info.createdById !== ctx.userId) {
      return c.json({ error: "Nur Admin oder Ersteller darf umbenennen" }, 403);
    }
  }
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
// Phase-4-Schreibschutz: nur Admin oder Ersteller.
projectsRoutes.delete("/projects/:name", async (c) => {
  const name = c.req.param("name");
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const info = await projectRepo.getInfo(name);
    if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
    if (info.createdById !== ctx.userId) {
      return c.json({ error: "Nur Admin oder Ersteller darf loeschen" }, 403);
    }
  }
  const ok = await projectRepo.delete(name);
  if (!ok) return c.json({ error: "Ungueltiger Projektname" }, 400);
  emit({ type: "project", action: "deleted", id: name });
  return c.body(null, 204);
});

// ── Projekt-Zugriffs-ACL (Phase 3) ─────────────────────────────────────────
// Liste, Hinzufuegen, Entfernen — alle Admin-only. Routes sind separat von
// /admin/users, damit der Admin im Projekt-Kontext arbeitet (Tab "Zugriff").

projectsRoutes.get("/projects/:name/access", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  if (!projectRepo.listAccess) return c.json([]);
  const info = await projectRepo.getInfo(c.req.param("name"));
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
  return c.json(await projectRepo.listAccess(info.id!));
});

projectsRoutes.post("/projects/:name/access", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  if (!projectRepo.grantAccess) return c.json({ error: "Nicht unterstützt" }, 501);
  const info = await projectRepo.getInfo(c.req.param("name"));
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);

  const body = await c.req.json<{ userId: string }>();
  if (!body.userId) return c.json({ error: "userId erforderlich" }, 400);
  const target = await findDbUserById(body.userId);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);

  await projectRepo.grantAccess(info.id!, body.userId);
  emit({ type: "project", action: "updated", id: info.name });
  // Notification an den neu freigegebenen User. Eigene Aktion → kein Self-Ping.
  if (body.userId !== c.var.userId) {
    const actor = c.var.dbUser?.displayName ?? c.var.dbUser?.username ?? null;
    void notifyProjectAccessGranted(body.userId, info.name, actor);
  }
  return c.json({ ok: true });
});

projectsRoutes.delete("/projects/:name/access/:userId", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  if (!projectRepo.revokeAccess) return c.json({ error: "Nicht unterstützt" }, 501);
  const info = await projectRepo.getInfo(c.req.param("name"));
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);

  const ok = await projectRepo.revokeAccess(info.id!, c.req.param("userId"));
  if (ok) emit({ type: "project", action: "updated", id: info.name });
  return c.json({ ok });
});

// Direkte Unter-Projekte eines Projekts (Migration 005).
projectsRoutes.get("/projects/:name/children", async (c) => {
  const name = c.req.param("name");
  if (!projectRepo.listChildren) return c.json([]);
  const children = await projectRepo.listChildren(name);
  return c.json(children);
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
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const body = await c.req.json<{ text: string; assigneeId?: string | null }>();
  const task = await taskRepo.save(body.text, name);
  // Wenn assigneeId mitkommt (Migration 007), direkt setzen — das Repo
  // denormalisiert auch den assignee-Textnamen.
  if (body.assigneeId !== undefined) {
    await taskRepo.update(task.id, { assigneeId: body.assigneeId ?? null }, name);
  }
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
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const body = await c.req.json<{
    datum: string;
    text: string;
    uhrzeit?: string;
    assigneeIds?: string[];
  }>();
  const termin = await terminRepo.save(body.datum, body.text, body.uhrzeit, name);
  if (typeof termin === "string") return c.json({ error: termin }, 400);
  // assigneeIds nachziehen, falls uebergeben (Migration 007).
  if (body.assigneeIds !== undefined) {
    await terminRepo.update(termin.id, { assigneeIds: body.assigneeIds }, name);
  }
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
