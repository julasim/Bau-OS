// ============================================================
// PATIO — Projekt-Routen
// ============================================================
// ── Regel fuer JEDE Route unter /projects/:name ────────────────────────────
//
// **Der Projektname aus dem Pfad ist eine Behauptung des Aufrufers, keine
// Berechtigung.** Vor dem ersten Datenzugriff steht deshalb:
//
//     if (!(await canSeeProjectByName(userCtx(c), name))) {
//       return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
//     }
//
// Das galt bis zum 2026-08-23 fuer acht Routen NICHT — und die Lueckenhaftig-
// keit war der Grund, warum sie so lange niemandem auffiel: sie stand direkt
// neben dem richtigen Code. `POST /projects/:name/tasks` prueft sauber, das
// drei Zeilen weiter stehende `PATCH /projects/:name/tasks` pruefte nicht.
// Beim Lesen sieht die Datei bewacht aus, weil an der Stelle, an der man
// hinsieht, eine Pruefung steht.
//
// Moeglich war damit, allein mit einem gueltigen Konto und dem Projektnamen:
// den vollen Inhalt jeder Notiz lesen, das komplette Projekt-Dossier
// herunterladen, Aufgaben/Termine/Unterprojekte auflisten — und schreibend
// eine fremde Aufgabe abhaken sowie einen fremden Termin loeschen.
//
// Festgehalten in `tests/api-projects-acl-luecke.test.ts`; jede der acht
// Pruefungen dort war vor dem Fix rot. Wer hier eine Route ergaenzt, ergaenzt
// dort eine Zeile.
// ============================================================

import { Hono } from "hono";
import { projectRepo, taskRepo, terminRepo, teamRepo } from "../../data/index.js";
import { findDbUserById } from "../auth.js";
import { getVisibleProjectIds, canSeeProjectByName, type UserCtx } from "../../data/access.js";
import type { ProjectUpdate } from "../../data/types.js";
import type { AppEnv } from "../server.js";
import { emit, emitForProjectName } from "../events.js";
import {
  pruefeProjektnummer,
  PROJEKTNUMMER_BEISPIEL,
  mitProjektnummer,
  alsDokumentwert,
} from "../../data/projektnummer.js";

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
  // PERF-1: eine Aggregat-Query statt N+1 (frueher list() + getInfo() je Name).
  // Der FS-Mode kennt listInfos nicht → alter Pfad als Fallback.
  if (projectRepo.listInfos) {
    return c.json(await projectRepo.listInfos(visible));
  }
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

  // Die Projektnummer ist Pflicht (Migration 052) — sie ist die Kennung, unter
  // der das Projekt im Haus gefuehrt wird. Hier geprueft und nicht erst im
  // Repository, damit der Aufrufer den GRUND erfaehrt und nicht nur ein
  // „ging nicht": zu lang, leer und schon vergeben sind drei verschiedene
  // Auskuenfte.
  //
  // Ausnahme: `create()` ist in diesem Haus idempotent — auf einen bereits
  // vorhandenen Namen patcht es die mitgegebenen Stammdaten durch. In dem Fall
  // meint der Aufrufer die Nummer gar nicht, und eine Pflichtabfrage waere
  // falsch. Deshalb steht die Pflicht hier nur fuer die echte Neuanlage.
  const schonDa = await projectRepo.getInfo(name);
  if (!schonDa) {
    const geprueft = pruefeProjektnummer(body.projektnummer);
    if (!geprueft.ok) return c.json({ error: geprueft.text }, 400);
  }

  // Existenz-Check vor create, damit wir 201 vs 200 zurueckgeben koennen.
  const already = schonDa;

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
  if (ok === "ungueltiger-name") return c.json({ error: "Ungueltiger Projektname" }, 400);
  if (ok === "nummer-fehlt") {
    return c.json({ error: `Projektnummer erforderlich (z. B. ${PROJEKTNUMMER_BEISPIEL})` }, 400);
  }
  if (ok === "nummer-vergeben") {
    // 409, nicht 400: die Eingabe ist in Ordnung, nur eben schon belegt.
    // Der Text nennt bewusst NICHT, welches Projekt sie traegt — das waere
    // eine Auskunft ueber ein Projekt, das der Fragende womoeglich gar nicht
    // sehen darf (siehe src/data/access.ts).
    return c.json({ error: "Diese Projektnummer ist bereits vergeben" }, 409);
  }

  emitForProjectName({ type: "project", action: already ? "updated" : "created", id: name }, name, {
    actorId: c.var.userId,
  });
  const info = await projectRepo.getInfo(name);
  return c.json(info, already ? 200 : 201);
});

// Projekt-Detail — Phase 4: Zugriff pruefen.
// ── Papierkorb (Migration 044) ───────────────────────────────────────────────
//
// MUSS vor `/projects/:name` stehen: Hono trifft Routen in
// Registrierungsreihenfolge, nicht nach Genauigkeit. Darunter eingehaengt
// verschluckt der Platzhalter den Aufruf und antwortet mit „Projekt
// _papierkorb nicht gefunden" — das ist beim Bauen genau einmal passiert.
//
// Nur fuer Admins: ein geloeschtes Projekt ist fuer seinen Ersteller nicht
// mehr sichtbar, er koennte es also gar nicht auswaehlen. Und das endgueltige
// Entfernen ist der einzige unumkehrbare Schritt im ganzen Programm.
projectsRoutes.get("/projects/_papierkorb", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  if (!projectRepo.listDeleted) return c.json({ error: "Nicht unterstuetzt" }, 501);
  return c.json(await projectRepo.listDeleted());
});

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

  // `rev` ist der beim Laden mitgelieferte Zaehler (Konfliktschutz). Fehlt
  // er, gilt weiterhin „zuletzt gewinnt" — aeltere Aufrufer bleiben lauffaehig.
  const rev = typeof body.rev === "number" ? body.rev : undefined;
  const ok = await projectRepo.update(name, patch, rev);
  if (ok === "nummer-fehlt") {
    const geprueft = pruefeProjektnummer(patch.projektnummer);
    return c.json({ error: geprueft.ok ? "Projektnummer ungueltig" : geprueft.text }, 400);
  }
  if (ok === "nummer-vergeben") {
    return c.json({ error: "Diese Projektnummer ist bereits vergeben" }, 409);
  }
  if (!ok) {
    return c.json({ error: "Projekt nicht gefunden oder Update fehlgeschlagen" }, 404);
  }
  emitForProjectName({ type: "project", action: "updated", id: name }, name, { actorId: c.var.userId });

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

  emitForProjectName({ type: "project", action: "updated", id: newName }, newName, { actorId: c.var.userId });
  const info = await projectRepo.getInfo(newName);
  return c.json(info);
});

// Projekt als Markdown exportieren — kompaktes Projekt-Dossier mit Stammdaten,
// Team, Aufgaben, Terminen, Notizen-Index. Direkt zum Download via
// Content-Disposition. Keine PDF-Engine noetig — Markdown ist lesbar, portabel
// und kann clientseitig in jede andere Form gewandelt werden.
projectsRoutes.get("/projects/:name/export.md", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
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
  // `alsDokumentwert` statt des Rohwerts: der Platzhalter aus Migration 052
  // saehe in einem Dossier wie eine Aktennummer aus.
  lines.push(`| Projektnummer | ${md(alsDokumentwert(info.projektnummer) || null)} |`);
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
  // Die Projektnummer steht vorne im Dateinamen (Migration 052) — wer zwanzig
  // Dossiers in einem Ordner hat, sortiert sie damit nach Akte statt nach
  // Projektname. Bereinigt, weil die Nummer Freitext ist und ein `/` unter
  // Windows keine Zeichenfolge, sondern eine Pfadtrennung waere.
  const dateiname = mitProjektnummer(info.projektnummer, `${info.name}.md`);
  c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(dateiname)}"`);
  return c.body(body);
});

// Projekt loeschen. projectRepo.delete() ist idempotent — auch wenn das
// Projekt nicht existiert, kommt true zurueck. Semantik: "stelle sicher, dass
// es weg ist". Wir geben 204 No Content zurueck, weil es nichts zu rendern gibt.
// Phase-4-Schreibschutz: nur Admin oder Ersteller.
// ── Papierkorb (Migration 044) ───────────────────────────────────────────────
//
// Nur fuer Admins. Loeschen darf auch der Ersteller (siehe unten), das
// Zurueckholen und das endgueltige Entfernen sind Verwaltung: das eine, weil
// ein geloeschtes Projekt fuer den Ersteller nicht mehr sichtbar ist und er
// es also gar nicht auswaehlen koennte; das andere, weil es der einzige
// unumkehrbare Schritt im ganzen Programm ist.
//
// Die drei Routen stehen VOR `/projects/:name`, sonst schluckt der
// Platzhalter sie — Hono trifft in Registrierungsreihenfolge, nicht nach
// Genauigkeit.
projectsRoutes.post("/projects/:name/wiederherstellen", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  if (!projectRepo.restore) return c.json({ error: "Nicht unterstuetzt" }, 501);
  const name = decodeURIComponent(c.req.param("name"));
  const ok = await projectRepo.restore(name);
  if (!ok) return c.json({ error: "Liegt nicht im Papierkorb" }, 404);
  emit({ type: "project", action: "created", id: name, projectId: null }, { actorId: c.var.userId });
  return c.json(await projectRepo.getInfo(name));
});

projectsRoutes.delete("/projects/:name/endgueltig", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  if (!projectRepo.purge) return c.json({ error: "Nicht unterstuetzt" }, 501);
  const name = decodeURIComponent(c.req.param("name"));
  // Der einzige unumkehrbare Schritt: hier feuern die Kaskaden und nehmen
  // Bautagebuch, Besprechungen, Stunden, Phasen und Rechnungen mit.
  const ok = await projectRepo.purge(name);
  if (!ok) return c.json({ error: "Liegt nicht im Papierkorb" }, 404);
  return c.body(null, 204);
});

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
  // Das Projekt liegt jetzt im Papierkorb (Migration 044) — seine Datensaetze
  // sind unangetastet, ein Admin kann es zurueckholen.
  //
  // Bekannte Einschraenkung: das Ereignis geht projektlos raus, weil das
  // Projekt aus der Sichtbarkeit gefallen ist. Es erreicht damit nur Admins
  // und den Loeschenden; die uebrigen Berechtigten merken das Verschwinden
  // beim naechsten Laden.
  emit({ type: "project", action: "deleted", id: name, projectId: null }, { actorId: c.var.userId });
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
  emit({ type: "project", action: "updated", id: info.name, projectId: info.id ?? null }, { actorId: c.var.userId });
  return c.json({ ok: true });
});

projectsRoutes.delete("/projects/:name/access/:userId", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  if (!projectRepo.revokeAccess) return c.json({ error: "Nicht unterstützt" }, 501);
  const info = await projectRepo.getInfo(c.req.param("name"));
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);

  const ok = await projectRepo.revokeAccess(info.id!, c.req.param("userId"));
  if (ok)
    emit({ type: "project", action: "updated", id: info.name, projectId: info.id ?? null }, { actorId: c.var.userId });
  return c.json({ ok });
});

// Direkte Unter-Projekte eines Projekts (Migration 005).
projectsRoutes.get("/projects/:name/children", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  if (!projectRepo.listChildren) return c.json([]);
  const children = await projectRepo.listChildren(name);
  return c.json(children);
});

// Projekt-Notizen
projectsRoutes.get("/projects/:name/notes", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  return c.json(await projectRepo.listNotes(name));
});

projectsRoutes.get("/projects/:name/notes/:note", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const note = c.req.param("note");
  const content = await projectRepo.readNote(name, note);
  if (!content) return c.json({ error: "Notiz nicht gefunden" }, 404);
  return c.json({ name: note, content });
});

// Projekt-Aufgaben
projectsRoutes.get("/projects/:name/tasks", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
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
  emitForProjectName({ type: "task", action: "created", id: task.id }, name, { actorId: c.var.userId });
  return c.json({ ok: true });
});

projectsRoutes.patch("/projects/:name/tasks", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const { text } = await c.req.json<{ text: string }>();
  const ok = await taskRepo.complete(text, name);
  if (ok) emitForProjectName({ type: "task", action: "completed" }, name, { actorId: c.var.userId });
  return c.json({ ok });
});

// Projekt-Termine
projectsRoutes.get("/projects/:name/termine", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
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
  emitForProjectName({ type: "termin", action: "created", id: termin.id }, name, { actorId: c.var.userId });
  return c.json({ ok: true });
});

projectsRoutes.delete("/projects/:name/termine", async (c) => {
  const name = c.req.param("name");
  if (!(await canSeeProjectByName(userCtx(c), name))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const { text } = await c.req.json<{ text: string }>();
  const ok = await terminRepo.delete(text, name);
  if (ok) emitForProjectName({ type: "termin", action: "deleted" }, name, { actorId: c.var.userId });
  return c.json({ ok });
});
