import { Hono } from "hono";
import { taskRepo, projectRepo, teamRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx, type Rolle } from "../../data/access.js";
import { validateDatum, alsIsoDatum } from "../../data/termin-validation.js";
import type { AppEnv } from "../server.js";
import { emitForProjectName } from "../events.js";
import { projektBezugAusQuery, projektBezug } from "../projekt-bezug.js";
import { AUFWAND_STUFEN } from "../../data/types.js";
import { meldeAufgabeZugewiesen } from "../melden.js";

/**
 * Das Faelligkeitsdatum einer Aufgabe, geprueft und auf ISO gebracht.
 *
 * ── Warum `tasks.date` eine Sonderrolle hat ────────────────────────────────
 *
 * Es ist die LETZTE Datumsspalte des Hauses, die noch `TEXT` ist — Migration
 * 060 hat nur `termine.datum` angefasst. Und sie hatte NIRGENDS eine
 * Formatpruefung: weder hier, noch in `db-tasks.ts`, noch in der
 * Datenuebernahme.
 *
 * Verglichen und sortiert wird sie aber, als waere sie ISO:
 *
 *   * `src/maintenance.ts` prueft `t.date = to_char(now() …, 'YYYY-MM-DD')` —
 *     bei einem deutschen Datum trifft das NIE, und die Faelligkeitsmeldung
 *     (Migration 058) bleibt fuer diese Aufgabe fuer immer aus, ohne Fehler.
 *   * `routes/board.ts` sortiert `ORDER BY t.rang, t.date` als Zeichenkette:
 *     `01.09.2026` steht vor jedem ISO-Datum, die Aufgabe klebt also innerhalb
 *     ihres Rangs immer ganz oben.
 *
 * Dieselbe Konstruktion hat das Board ein Jahr lang leer gelassen — eine
 * Tabelle weiter. Der Typwechsel waere Migration 061 und braucht eine eigene
 * Gegenprobe; hier wird zunaechst die QUELLE geschlossen, damit kein neuer
 * Mischbestand mehr entsteht.
 *
 * Beide Formate werden angenommen, ISO wird gespeichert — genau wie bei den
 * Terminen.
 */
function alsFaelligkeit(roh: unknown): { ok: true; wert: string | null } | { ok: false; text: string } {
  if (roh === null || roh === undefined || roh === "") return { ok: true, wert: null };
  const wert = String(roh);
  const fehler = validateDatum(wert);
  if (fehler) return { ok: false, text: fehler };
  return { ok: true, wert: alsIsoDatum(wert) };
}

export const tasksRoutes = new Hono<AppEnv>();

/** Anzeigename des Auslösers — er wird in der Meldung MITGESPEICHERT, nicht
 *  als Verweis. Sonst stünde nach dem Löschen eines Kontos in jeder alten
 *  Meldung nichts mehr (Lehre aus dem Audit-Log). */
function ausloeserName(c: {
  var: { dbUser?: { displayName?: string | null; username?: string } | null };
}): string | null {
  const u = c.var.dbUser;
  return u?.displayName ?? u?.username ?? null;
}

function userCtx(c: { var: { userId: string | null; userRole: Rolle } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Ist diese Aufgabe dem angemeldeten Nutzer zugewiesen?
 *
 *  Warum das kein Direktvergleich sein darf: `tasks.assignee_id` ist ein FK auf
 *  `team_members(id)` (Migration 007), `ctx.userId` dagegen eine `users.id`.
 *  Die beiden UUID-Raeume sind disjunkt — `assigneeId === userId` trifft NIE zu
 *  und sperrt Nicht-Admins aus ihren eigenen projektlosen Aufgaben aus. Die
 *  Bruecke ist `team_members.user_id` (Migration 013); gleiches Vorgehen wie in
 *  time-entries.ts.
 *
 *  Ohne assigneeId faellt gar keine Abfrage an — das ist der Regelfall. */
async function isAssignedToMe(ctx: UserCtx, assigneeId: string | null | undefined): Promise<boolean> {
  if (!assigneeId || !ctx.userId) return false;
  const member = await teamRepo.get(assigneeId);
  return !!member?.userId && member.userId === ctx.userId;
}

/** Darf `ctx` diese projektlose Aufgabe sehen und aendern?
 *
 *  Zwei Wege fuehren dahin: die Aufgabe gehoert mir (created_by = meine
 *  users.id) oder sie ist mir zugewiesen (assignee_id -> team_members.user_id
 *  = meine users.id). Der Ersteller-Vergleich steht zuerst, weil er ohne
 *  Datenbankzugriff auskommt.
 *
 *  Ohne den Ersteller-Zweig war der haeufigste Fall ueberhaupt kaputt: wer
 *  sich selbst eine Aufgabe ohne Projekt und ohne Zuweisung anlegt, konnte
 *  sie anschliessend weder aendern noch abhaken noch loeschen (403). */
async function ownsPersonalTask(
  ctx: UserCtx,
  task: { createdById?: string | null; assigneeId?: string | null },
): Promise<boolean> {
  if (!ctx.userId) return false;
  if (task.createdById && task.createdById === ctx.userId) return true;
  return isAssignedToMe(ctx, task.assigneeId);
}

/** Memoisierte Variante fuer die Listen-Route: dort wird derselbe Test ueber
 *  viele Zeilen gefahren, ein ungepufferter Aufruf waere ein DB-Roundtrip je
 *  Aufgabe. Zusaetzlich greift `uq_team_members_user_id` (Migration 013) —
 *  je Nutzer gibt es hoechstens EIN Team-Mitglied. Sobald das eigene gefunden
 *  ist, kann jede andere assignee_id nur noch fremd sein, und es braucht gar
 *  keine weitere Abfrage. */
function assignedToMeChecker(ctx: UserCtx): (assigneeId: string | null | undefined) => Promise<boolean> {
  const seen = new Map<string, boolean>();
  let ownMemberId: string | null = null;
  return async (assigneeId) => {
    if (!assigneeId || !ctx.userId) return false;
    if (ownMemberId) return assigneeId === ownMemberId;
    const cached = seen.get(assigneeId);
    if (cached !== undefined) return cached;
    const mine = await isAssignedToMe(ctx, assigneeId);
    seen.set(assigneeId, mine);
    if (mine) ownMemberId = assigneeId;
    return mine;
  };
}

// Tasks-Liste: filtert nach sichtbaren Projekten. Tasks ohne project sind
// "persoenlich" — User sieht die nur wenn er Ersteller oder Assignee ist.
tasksRoutes.get("/tasks", async (c) => {
  // `?projectId=` ist die umbenennungsfeste Alternative zu `?project=`.
  // Zeigt die ID ins Leere, kommt 404 — NICHT die projektuebergreifende
  // Liste: eine veraltete Kennung darf nicht dazu fuehren, dass jemand mehr
  // sieht als gemeint.
  const bezug = await projektBezugAusQuery(c);
  if (bezug.unbekannt) return c.json({ error: "Projekt nicht gefunden" }, 404);
  const project = bezug.name ?? undefined;
  const all = await taskRepo.list(project);
  const ctx = userCtx(c);
  if (ctx.role === "admin") return c.json(all);

  const visible = await getVisibleProjectIds(ctx);
  if (visible === "all") return c.json(all);
  const visibleNames = new Set(await projectRepo.list(visible));
  const assignedToMe = assignedToMeChecker(ctx);

  const filtered: typeof all = [];
  for (const t of all) {
    if (t.project) {
      if (visibleNames.has(t.project)) filtered.push(t);
      continue;
    }
    // Ohne Projekt ist die Aufgabe persoenlich: sichtbar fuer den Ersteller
    // und fuer die zugewiesene Person.
    if (t.createdById && t.createdById === ctx.userId) {
      filtered.push(t);
      continue;
    }
    if (await assignedToMe(t.assigneeId)) filtered.push(t);
  }
  return c.json(filtered);
});

tasksRoutes.get("/tasks/:id", async (c) => {
  const task = await taskRepo.get(c.req.param("id"));
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = task.project ? await canSeeProjectByName(ctx, task.project) : await ownsPersonalTask(ctx, task);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  return c.json(task);
});

tasksRoutes.post("/tasks", async (c) => {
  const body = await c.req.json<{
    text: string;
    project?: string;
    /** Umbenennungsfeste Bezugsarten (Migrationen 042/052) — aufgeloest in
     *  src/api/projekt-bezug.ts. Sie standen hier bisher nicht im Typ,
     *  funktionierten aber schon: der ganze Body geht an `projektBezug()`,
     *  und die Felder kommen aus dem JSON durch. Undeklariert heisst nur,
     *  dass niemand sie beim Lesen findet. */
    projectId?: string;
    projektnummer?: string;
    assignee?: string;
    assigneeId?: string;
    date?: string;
    location?: string;
    phaseId?: string | null;
  }>();
  if (!body.text) return c.json({ error: "Text erforderlich" }, 400);
  // Wenn Projekt gesetzt: User muss Zugriff darauf haben.
  const bezug = await projektBezug(body);
  if (bezug.unbekannt) return c.json({ error: "Projekt nicht gefunden" }, 404);
  body.project = bezug.name ?? undefined;
  if (body.project && !(await canSeeProjectByName(userCtx(c), body.project))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const task = await taskRepo.save(body.text, body.project, c.var.userId);
  // Apply optional fields inkl. assigneeId (Migration 007) und phaseId (035).
  if (body.assignee || body.assigneeId || body.date || body.location || body.phaseId) {
    const faellig = alsFaelligkeit(body.date);
    if (!faellig.ok) return c.json({ error: faellig.text }, 400);
    const updated = await taskRepo.update(
      task.id,
      {
        assignee: body.assignee ?? null,
        assigneeId: body.assigneeId ?? null,
        date: faellig.wert,
        location: body.location ?? null,
        phaseId: body.phaseId ?? null,
      },
      body.project,
    );
    emitForProjectName({ type: "task", action: "created", id: task.id }, body.project, { actorId: c.var.userId });
    if (body.assigneeId) {
      // Ohne Projektbezug steht die Meldung in der Glocke ohne Projekt da —
      // `benachrichtigungen.project_id` (Migration 058) blieb bei Aufgaben und
      // Terminen IMMER leer, obwohl die Spalte und der JOIN auf den
      // Projektnamen von Anfang an vorhanden waren. Nur die Besprechungen
      // haben ihn je mitgegeben.
      await meldeAufgabeZugewiesen({
        aufgabeId: task.id,
        text: task.text,
        mitgliedId: body.assigneeId,
        projectId: body.project ? await projectRepo.idByName?.(body.project) : null,
        ausloeserId: c.var.userId,
        ausloeserName: ausloeserName(c),
      });
    }
    // `update()` liefert `null`, wenn die Zeile nicht mehr da ist. Ohne diesen
    // Rueckfall antwortete die Route mit **Status 201 und dem Koerper `null`**:
    // Der Client las eine erfolgreiche Anlage ohne Datensatz, `task.id` war
    // `undefined`, und der naechste Schritt in der Oberflaeche lief ins Leere.
    // Die Aufgabe SELBST ist angelegt — 201 bleibt richtig, nur ohne die
    // optionalen Felder, die nicht mehr geschrieben werden konnten.
    return c.json(updated ?? task, 201);
  }
  emitForProjectName({ type: "task", action: "created", id: task.id }, body.project, { actorId: c.var.userId });
  return c.json(task, 201);
});

tasksRoutes.put("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<
    Partial<{
      text: string;
      status: "open" | "in_progress" | "done";
      assignee: string | null;
      assigneeId: string | null;
      date: string | null;
      location: string | null;
      phaseId: string | null;
      // Aufgabensystem (Migration 050).
      rang: 1 | 2 | 3 | 4;
      aufwandMin: number | null;
    }>
  >();
  // Beide Felder haengen an einer CHECK-Bedingung in der Datenbank. Ohne
  // Pruefung hier kaeme ein Tippfehler als 500 zurueck statt als Hinweis,
  // was erlaubt ist.
  if ("rang" in body && body.rang !== undefined && ![1, 2, 3, 4].includes(body.rang)) {
    return c.json({ error: "Rang muss 1, 2, 3 oder 4 sein" }, 400);
  }
  if ("aufwandMin" in body && body.aufwandMin !== null && body.aufwandMin !== undefined) {
    if (!(AUFWAND_STUFEN as readonly number[]).includes(body.aufwandMin)) {
      return c.json({ error: `Aufwand muss eine der Stufen ${AUFWAND_STUFEN.join(", ")} Minuten sein` }, 400);
    }
  }
  // Vorherigen Stand laden, damit wir nur bei echter Assignee-Aenderung
  // benachrichtigen (kein Spam wenn nur Datum aktualisiert wird).
  const prev = await taskRepo.get(id);
  if (!prev) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = prev.project ? await canSeeProjectByName(ctx, prev.project) : await ownsPersonalTask(ctx, prev);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  // Die Faelligkeit wird auch beim Aendern geprueft — sonst waere die Quelle
  // nur halb geschlossen, und `PUT` ist der haeufigere Weg.
  const faellig = "date" in body ? alsFaelligkeit(body.date) : null;
  if (faellig && !faellig.ok) return c.json({ error: faellig.text }, 400);
  const task = await taskRepo.update(id, faellig?.ok ? { ...body, date: faellig.wert } : body);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  // prev.project (Stand VOR dem Update) ist hier die einzige verfuegbare
  // Projektangabe — taskRepo.update() aendert das Projekt nicht.
  emitForProjectName({ type: "task", action: "updated", id }, prev.project, { actorId: c.var.userId });

  // Nur bei ECHTER Aenderung der Zuweisung melden. Der Kommentar oben
  // („kein Spam wenn nur das Datum aktualisiert wird") stand seit dem Bau der
  // Route da — die Meldung selbst gab es nie.
  if ("assigneeId" in body && body.assigneeId && body.assigneeId !== prev.assigneeId) {
    await meldeAufgabeZugewiesen({
      aufgabeId: id,
      text: task.text,
      mitgliedId: body.assigneeId,
      projectId: prev.project ? await projectRepo.idByName?.(prev.project) : null,
      ausloeserId: c.var.userId,
      ausloeserName: ausloeserName(c),
    });
  }
  return c.json(task);
});

tasksRoutes.patch("/tasks/:id/complete", async (c) => {
  const id = c.req.param("id");
  const task = await taskRepo.get(id);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = task.project ? await canSeeProjectByName(ctx, task.project) : await ownsPersonalTask(ctx, task);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  const ok = await taskRepo.complete(id);
  if (ok) emitForProjectName({ type: "task", action: "completed", id }, task.project, { actorId: c.var.userId });
  return c.json({ ok });
});

// PATCH /tasks/complete (Legacy-Kompatibilitaet, per Freitext statt ID) ist
// ersatzlos entfallen. Sie hatte keinerlei Rechtepruefung und hakte damit
// Aufgaben in Projekten ab, die der Aufrufer nicht einmal sehen darf. Ein
// nachtraeglicher ACL-Check ist dort nicht sauber moeglich, weil die Route die
// Aufgabe erst in taskRepo.complete() per Textvergleich aufloest und der
// Route selbst kein Datensatz vorliegt, gegen den sie pruefen koennte.
// Ihr einziger Aufrufer war die Tool-Fläche des Telegram-Bots, die mit AP0
// entfernt wurde — weder web/ noch src/ noch tests/ rufen sie noch auf.
// Der korrekte Weg ist PATCH /tasks/:id/complete (mit ACL, siehe oben).

tasksRoutes.delete("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const task = await taskRepo.get(id);
  if (!task) return c.json({ error: "Aufgabe nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = task.project ? await canSeeProjectByName(ctx, task.project) : await ownsPersonalTask(ctx, task);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  const ok = await taskRepo.delete(id);
  if (ok) emitForProjectName({ type: "task", action: "deleted", id }, task.project, { actorId: c.var.userId });
  return c.json({ ok });
});
