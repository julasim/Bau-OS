import { Hono } from "hono";
import { terminRepo, projectRepo, teamRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx, type Rolle } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emitForProjectName } from "../events.js";
import { projektBezugAusQuery, projektBezug } from "../projekt-bezug.js";
import { meldeTerminTeilnahme } from "../melden.js";
import { validateDatum } from "../../data/termin-validation.js";

export const termineRoutes = new Hono<AppEnv>();

/** Anzeigename des Auslösers — er wird in der Meldung mitgespeichert. */
function ausloeserName(c: {
  var: { dbUser?: { displayName?: string | null; username?: string } | null };
}): string | null {
  const u = c.var.dbUser;
  return u?.displayName ?? u?.username ?? null;
}

function userCtx(c: { var: { userId: string | null; userRole: Rolle } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Darf `ctx` diesen projektlosen Termin sehen und aendern?
 *
 *  Wie bei den Aufgaben fuehren zwei Wege dahin: der Termin gehoert mir
 *  (created_by = meine users.id) oder ich bin Teilnehmer. Fuer den zweiten
 *  Weg reicht KEIN Direktvergleich: `termine.assignee_ids` ist ein Array von
 *  team_members-IDs (Migration 007), `ctx.userId` eine users.id — zwei
 *  disjunkte UUID-Raeume. Die Bruecke ist `team_members.user_id`
 *  (Migration 013), genau wie in tasks.ts und time-entries.ts.
 *
 *  Der Ersteller-Vergleich steht zuerst: er braucht keine Datenbank. */
async function ownsPersonalTermin(
  ctx: UserCtx,
  termin: { createdById?: string | null; assigneeIds?: string[] },
): Promise<boolean> {
  if (!ctx.userId) return false;
  if (termin.createdById && termin.createdById === ctx.userId) return true;
  for (const id of termin.assigneeIds ?? []) {
    const member = await teamRepo.get(id);
    if (member?.userId && member.userId === ctx.userId) return true;
  }
  return false;
}

termineRoutes.get("/termine", async (c) => {
  const bezug = await projektBezugAusQuery(c);
  if (bezug.unbekannt) return c.json({ error: "Projekt nicht gefunden" }, 404);
  const project = bezug.name ?? undefined;
  const all = await terminRepo.list(project);
  const ctx = userCtx(c);
  if (ctx.role === "admin") return c.json(all);

  const visible = await getVisibleProjectIds(ctx);
  if (visible === "all") return c.json(all);
  const visibleNames = new Set(await projectRepo.list(visible));

  // Ohne Projekt ist der Termin persoenlich: sichtbar fuer den Ersteller und
  // fuer die Teilnehmer. Der fruehere Direktvergleich assigneeIds.includes(me)
  // traf nie zu (team_members-IDs gegen users.id) — projektlose Termine waren
  // damit fuer Nicht-Admins grundsaetzlich unsichtbar.
  const filtered: typeof all = [];
  for (const t of all) {
    if (t.project) {
      if (visibleNames.has(t.project)) filtered.push(t);
      continue;
    }
    if (await ownsPersonalTermin(ctx, t)) filtered.push(t);
  }
  return c.json(filtered);
});

termineRoutes.get("/termine/:id", async (c) => {
  const termin = await terminRepo.get(c.req.param("id"));
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = termin.project
      ? await canSeeProjectByName(ctx, termin.project)
      : await ownsPersonalTermin(ctx, termin);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  return c.json(termin);
});

termineRoutes.post("/termine", async (c) => {
  const body = await c.req.json<{
    datum: string;
    text: string;
    uhrzeit?: string;
    endzeit?: string;
    location?: string;
    assignees?: string[];
    assigneeIds?: string[];
    project?: string;
    /** Umbenennungsfeste Bezugsarten (Migrationen 042/052) — aufgeloest in
     *  src/api/projekt-bezug.ts. Sie standen hier bisher nicht im Typ,
     *  funktionierten aber schon: der ganze Body geht an `projektBezug()`,
     *  und die Felder kommen aus dem JSON durch. Undeklariert heisst nur,
     *  dass niemand sie beim Lesen findet. */
    projectId?: string;
    projektnummer?: string;
    phaseId?: string | null;
    isMilestone?: boolean;
  }>();
  if (!body.datum || !body.text) return c.json({ error: "Datum und Text erforderlich" }, 400);
  const bezug = await projektBezug(body);
  if (bezug.unbekannt) return c.json({ error: "Projekt nicht gefunden" }, 404);
  body.project = bezug.name ?? undefined;
  if (body.project && !(await canSeeProjectByName(userCtx(c), body.project))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const termin = await terminRepo.save(body.datum, body.text, body.uhrzeit, body.project, c.var.userId);
  if (typeof termin === "string") return c.json({ error: termin }, 400);
  let result = termin;
  if (
    body.endzeit ||
    body.location ||
    body.assignees?.length ||
    body.assigneeIds?.length ||
    body.phaseId ||
    body.isMilestone
  ) {
    const updated = await terminRepo.update(
      termin.id,
      {
        endzeit: body.endzeit ?? null,
        location: body.location ?? null,
        assignees: body.assignees ?? [],
        assigneeIds: body.assigneeIds ?? [],
        phaseId: body.phaseId ?? null,
        isMilestone: body.isMilestone ?? false,
      },
      body.project,
    );
    if (updated) result = updated;
  }
  emitForProjectName({ type: "termin", action: "created", id: termin.id }, body.project, { actorId: c.var.userId });
  if (body.assigneeIds?.length) {
    // Ohne Projektbezug steht die Meldung in der Glocke ohne Projekt da —
    // `benachrichtigungen.project_id` (Migration 058) blieb bei Aufgaben und
    // Terminen IMMER leer, obwohl die Spalte und der JOIN auf den
    // Projektnamen von Anfang an vorhanden waren. Nur die Besprechungen
    // haben ihn je mitgegeben.
    await meldeTerminTeilnahme({
      terminId: termin.id,
      text: result.text,
      datum: result.datum,
      mitgliedIds: body.assigneeIds,
      projectId: body.project ? await projectRepo.idByName?.(body.project) : null,
      ausloeserId: c.var.userId,
      ausloeserName: ausloeserName(c),
    });
  }
  return c.json(result, 201);
});

termineRoutes.put("/termine/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<
    Partial<{
      text: string;
      datum: string;
      uhrzeit: string | null;
      endzeit: string | null;
      location: string | null;
      assignees: string[];
      assigneeIds: string[];
      phaseId: string | null;
      isMilestone: boolean;
    }>
  >();
  // Rechte VOR dem Schreiben pruefen. Bisher fehlte das hier ganz: wer eine
  // Termin-UUID kannte, konnte jeden Termin aendern — auch aus Projekten, die
  // ihm GET verweigert haette.
  // ── Das Datum wird HIER geprueft, nicht erst im Repository ───────────────
  //
  // ⚠ Regression, die Migration 060 erzeugt haette: `db-termine.update()`
  // prueft mit `if (updates.datum)`, und ein LEERER String ist falsy — die
  // Pruefung lief also nicht, und der leere Wert ging an die jetzt
  // `date`-typisierte Spalte. postgres.js wirft darauf clientseitig
  // `RangeError: Invalid time value` (am 01.09.2026 nachgemessen), also einen
  // unbehandelten 500er statt einer Absage mit Begruendung.
  //
  // Erreichbar aus der Oberflaeche: das Datumsfeld im Kalender laesst sich
  // leeren, und `save()` schickt den Wert ungeprueft. Solange die Spalte TEXT
  // war, landete dort einfach ein leerer String — falsch, aber lautlos.
  //
  // Die Pruefung steht in der ROUTE, weil das Repository fuer einen
  // Datumsfehler `null` zurueckgibt und die Route daraus „Termin nicht
  // gefunden" (404) macht. Das waere die falsche Auskunft.
  if (body.datum !== undefined) {
    const datumFehler = validateDatum(String(body.datum));
    if (datumFehler) return c.json({ error: datumFehler }, 400);
  }

  const vorher = await terminRepo.get(id);
  if (!vorher) return c.json({ error: "Termin nicht gefunden" }, 404);
  const ctxPut = userCtx(c);
  if (ctxPut.role !== "admin") {
    const erlaubt = vorher.project
      ? await canSeeProjectByName(ctxPut, vorher.project)
      : await ownsPersonalTermin(ctxPut, vorher);
    if (!erlaubt) return c.json({ error: "Kein Zugriff" }, 403);
  }
  const termin = await terminRepo.update(id, body);
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  // vorher.project = Stand vor dem Update; terminRepo.update() haengt den
  // Termin nicht um.
  emitForProjectName({ type: "termin", action: "updated", id }, vorher.project, { actorId: c.var.userId });
  return c.json(termin);
});

termineRoutes.delete("/termine/:id", async (c) => {
  const id = c.req.param("id");
  const termin = await terminRepo.get(id);
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const erlaubt = termin.project
      ? await canSeeProjectByName(ctx, termin.project)
      : await ownsPersonalTermin(ctx, termin);
    if (!erlaubt) return c.json({ error: "Kein Zugriff" }, 403);
  }
  const ok = await terminRepo.delete(id);
  if (ok) emitForProjectName({ type: "termin", action: "deleted", id }, termin.project, { actorId: c.var.userId });
  return c.json({ ok });
});

// Loeschen per Text — Altbestand aus der Bot-Aera, als Termine ueber ihren
// Wortlaut adressiert wurden. Kein Aufrufer im Frontend. Sie bleibt vorerst
// bestehen, ist aber jetzt Admins vorbehalten: eine Rechtepruefung waere hier
// nur scheinbar moeglich, weil terminRepo.delete() den Datensatz erst intern
// per Textvergleich aufloest und dabei projektuebergreifend trifft.
termineRoutes.delete("/termine", async (c) => {
  if (c.var.userRole !== "admin") return c.json({ error: "Kein Zugriff" }, 403);
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Text erforderlich" }, 400);
  const ok = await terminRepo.delete(text, project);
  if (ok) emitForProjectName({ type: "termin", action: "deleted" }, project, { actorId: c.var.userId });
  return c.json({ success: ok });
});
