import { Hono } from "hono";
import { teamRepo } from "../../data/index.js";
import type { MemberType, ContactLogEntry } from "../../data/types.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import { logError } from "../../logger.js";
import { darfGeldSehen } from "../geld.js";
import { getVisibleProjectIds, canSeeProject, type Rolle } from "../../data/access.js";
import { adminMiddleware } from "../auth.js";

export const teamRoutes = new Hono<AppEnv>();

// ── Ein Mitglied loeschen ist Verwaltungssache ──────────────────────────────
//
// ⚠ Hier stand KEINE Pruefung. Jedes angemeldete Konto konnte jedes
// Team-Mitglied entfernen — und daran haengen zwei Trigger und vier
// Fremdschluessel: `project_team_members` mit CASCADE, `tasks.assignee_id`,
// `time_entries.member_id` und `projects.bauherr_id` auf NULL, dazu
// `array_remove` aus `termine.assignee_ids` und `meetings.attendee_ids`.
// Einen Papierkorb fuer Mitglieder gibt es nicht.
//
// ── Warum genau `/team/:name` und nicht `/team/*` ──────────────────────────
//
// `DELETE /team/:id/projects/:projectId` — das Loesen einer Projektzuordnung —
// ist fuer Nicht-Admins bewusst offen (`tests/api-team-projekt-acl.test.ts`).
// Ein Platzhalter erfasste sie mit. `:name` deckt genau EIN Segment.
//
// Als eigener `.on()`-Eintrag und nicht als drittes Handler-Argument: mit
// Middleware in der Signatur verliert Hono den Pfad-Generic, und
// `c.req.param(...)` waere ploetzlich `string | undefined`. Dieselbe
// Begruendung steht in `companies.ts`.
teamRoutes.on(["DELETE"], "/team/:name", adminMiddleware);

const ALLOWED_MEMBER_TYPES: MemberType[] = ["Intern", "Planer", "Ausführende", "Behörde", "Lieferant", "Bauherr"];

function normalizeMemberType(v: unknown): MemberType | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return (ALLOWED_MEMBER_TYPES as string[]).includes(t) ? (t as MemberType) : null;
}

/** Sichtbare Projekte des Aufrufers — begrenzt die Projektzuordnungen, die
 *  an den Mitgliedern haengen. */
async function sichtbar(c: { var: { userId: string | null; userRole: Rolle } }) {
  return getVisibleProjectIds({ userId: c.var.userId, role: c.var.userRole });
}

// Alle Mitglieder. Die Stammdaten sind fuer jeden im Buero lesbar — die Liste
// ist der interne Kollegenkatalog und fuettert jeden Zuweisungs-Dialog.
// Gefiltert werden nur die angehaengten Projektzuordnungen.
teamRoutes.get("/team", async (c) => {
  return c.json(await teamRepo.list(await sichtbar(c)));
});

// Einzelnes Mitglied
teamRoutes.get("/team/:id", async (c) => {
  const member = await teamRepo.get(c.req.param("id"), await sichtbar(c));
  if (!member) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  return c.json(member);
});

// Mitglied hinzufuegen. Body akzeptiert companyId ODER companyName ODER
// company (Legacy-Freitext) — das Repo macht auto-create-or-find.
teamRoutes.post("/team", async (c) => {
  const body = await c.req.json<{
    name: string;
    role?: string;
    email?: string;
    phone?: string;
    company?: string;
    companyId?: string;
    companyName?: string;
    memberType?: string;
  }>();
  if (!body.name) return c.json({ error: "Name erforderlich" }, 400);

  try {
    const member = await teamRepo.add({
      name: body.name,
      role: body.role ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      company: body.company ?? null,
      companyId: body.companyId ?? null,
      companyName: body.companyName ?? null,
      memberType: normalizeMemberType(body.memberType),
      projectId: null,
    });
    emit({ type: "team", action: "created", id: member.id }, { actorId: c.var.userId });
    return c.json(member, 201);
  } catch (e) {
    // ⚠ Hier stand ein blankes `catch` mit „Mitglied existiert bereits" — JEDER
    // Fehler wurde zu einem Namenskonflikt erklaert. Eine kaputte Verbindung,
    // ein Tippfehler in einer Firmenkennung, ein verletzter CHECK: alles kam
    // als 409 zurueck, und wer den Namen dann aenderte, kam keinen Schritt
    // weiter.
    //
    // Muster wie in `companies.ts` und `admin-users.ts`.
    const meldung = e instanceof Error ? e.message : String(e);
    const klein = meldung.toLowerCase();
    if (klein.includes("unique") || klein.includes("duplicate")) {
      return c.json({ error: "Mitglied existiert bereits" }, 409);
    }
    logError("[Team] Anlegen fehlgeschlagen", e);
    return c.json({ error: "Anlegen fehlgeschlagen: " + meldung }, 500);
  }
});

// Mitglied aktualisieren — akzeptiert jetzt auch memberType, companyId, companyName.
teamRoutes.patch("/team/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<
    Partial<{
      name: string;
      role: string | null;
      email: string | null;
      phone: string | null;
      company: string | null;
      companyId: string | null;
      companyName: string | null;
      memberType: string | null;
      projectId: string | null;
      hourlyRate: number | string | null;
      // Migration 013: User-Account-Verknuepfung. Nur Admin darf
      // setzen — sonst koennten User sich gegenseitig "uebernehmen".
      userId: string | null;
      // Konfliktschutz (Migration 042). Fehlt der Zaehler, gilt weiterhin
      // „zuletzt gewinnt" — aeltere Aufrufer bleiben lauffaehig.
      rev: number;
    }>
  >();

  // ── projectId braucht dieselbe Pruefung wie die drei Nachbarrouten ───────
  //
  // POST/PATCH/DELETE /team/:id/projects… pruefen seit dem 23.08. jeweils
  // `canSeeProject`. Diese Route nimmt dasselbe Feld entgegen — ueber das
  // ALTE Einzelfeld `projectId` statt ueber die M:N-Zuordnung — und tat es
  // nicht. Die Oberflaeche schickt es nicht, ein Aufruf von Hand schon.
  if ("projectId" in body && body.projectId) {
    if (!(await canSeeProject({ userId: c.var.userId, role: c.var.userRole }, body.projectId))) {
      return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
    }
  }

  const updates: Record<string, unknown> = {};
  // Nur Felder uebernehmen, die explizit im Body sind (inkl. null = leeren).
  for (const key of ["name", "role", "email", "phone", "company", "companyId", "companyName", "projectId"] as const) {
    if (key in body) updates[key] = body[key];
  }

  // ── Der Konfliktschutz war von JEDEM Client aus unerreichbar ──────────────
  //
  // `db-team.ts` liest den Zaehler aus dem Update-Objekt
  // (`pruefeRev(..., (updates as { rev?: number }).rev)`) — und die Weissliste
  // darueber kennt `rev` nicht. Der Zaehler kam also NIE an, egal was die
  // Oberflaeche schickte.
  //
  // Das ist mehr als „vom Client aus abgeschaltet": Zwei Personen, die
  // dasselbe Team-Mitglied bearbeiten, ueberschrieben einander lautlos, und
  // kein Aufrufer haette daran etwas aendern koennen.
  //
  // Gefunden am 01.09.2026 beim Nachlesen des Plans, nicht im Code-Review.
  // Festgehalten in `tests/api-konflikt-erreichbar.test.ts` — und zwar ueber
  // die WIRKUNG (zweiter Schreibvorgang mit altem Zaehler ergibt 409), nicht
  // darueber, ob ein Feld im Anfragekoerper steht: genau diese Unterscheidung
  // haette den Fehler verhindert.
  if (typeof body.rev === "number") updates.rev = body.rev;
  // Stundensatz (Migration 037): in Zahl wandeln, leer/ungueltig → null.
  // Ohne Geld-Recht wird der Stundensatz IGNORIERT, nicht abgelehnt: der
  // Antwort-Filter entfernt ihn aus jeder Antwort, das Formular schickt also
  // ein leeres Feld zurueck. Mit einer Ablehnung koennte ein Projektleiter
  // ohne Geld-Recht keine Telefonnummer mehr aendern; mit stiller Uebernahme
  // wuerde er beim Speichern den Satz auf null setzen. Ignorieren ist das
  // einzige Verhalten, das beides vermeidet.
  if ("hourlyRate" in body && darfGeldSehen(c)) {
    const n = body.hourlyRate === null || body.hourlyRate === "" ? null : Number(body.hourlyRate);
    updates.hourlyRate = n !== null && Number.isFinite(n) ? n : null;
  }
  if ("memberType" in body) {
    updates.memberType = body.memberType ? normalizeMemberType(body.memberType) : null;
  }
  // userId nur fuer Admins. Non-Admins kriegen einfach keinen Update auf das Feld.
  if ("userId" in body && c.var.userRole === "admin") {
    updates.userId = body.userId;
  }

  const member = await teamRepo.update(id, updates);
  if (!member) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  emit({ type: "team", action: "updated", id }, { actorId: c.var.userId });
  return c.json(member);
});

// Mitglied entfernen
teamRoutes.delete("/team/:name", async (c) => {
  const nameOderId = c.req.param("name");
  const ok = await teamRepo.remove(nameOderId);
  if (ok) emit({ type: "team", action: "deleted", id: nameOderId }, { actorId: c.var.userId });
  return c.json({ ok });
});

// ── Projekt-Zuordnungen (Migration 006) ────────────────────────────────────

// Mitglied einem Projekt zuordnen (M:N). Body: { projectId, projectRole? }.
// Ist idempotent — existierende Zuordnung wird nicht doppelt, bei uebergebener
// projectRole wird sie aktualisiert.
teamRoutes.post("/team/:id/projects", async (c) => {
  const memberId = c.req.param("id");
  const body = await c.req.json<{ projectId: string; projectRole?: string | null }>();
  if (!body.projectId) return c.json({ error: "projectId erforderlich" }, 400);
  if (!teamRepo.assignToProject) return c.json({ error: "Nicht unterstützt" }, 501);
  // Der Projektbezug aus Body bzw. Pfad ist eine Behauptung des Aufrufers,
  // keine Berechtigung — dieselbe Regel wie in src/api/routes/projects.ts.
  if (!(await canSeeProject({ userId: c.var.userId, role: c.var.userRole }, body.projectId))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }

  const ok = await teamRepo.assignToProject(memberId, body.projectId, body.projectRole ?? null);
  if (!ok) return c.json({ error: "Zuordnung fehlgeschlagen" }, 500);
  emit({ type: "team", action: "updated", id: memberId }, { actorId: c.var.userId });
  emit(
    { type: "project", action: "updated", id: body.projectId, projectId: body.projectId },
    {
      actorId: c.var.userId,
    },
  );
  // Mit Sichtbarkeitsfilter: sonst stuenden in der Antwort auch die
  // Projektzuordnungen, die der Aufrufer gar nicht sehen darf — Name und ID
  // inklusive.
  const member = await teamRepo.get(memberId, await sichtbar(c));
  return c.json(member);
});

// Projekt-Rolle eines Mitglieds aktualisieren. Body: { projectRole }.
teamRoutes.patch("/team/:id/projects/:projectId", async (c) => {
  const memberId = c.req.param("id");
  const projectId = c.req.param("projectId");
  const body = await c.req.json<{ projectRole?: string | null }>();
  if (!teamRepo.updateProjectRole) return c.json({ error: "Nicht unterstützt" }, 501);
  // Der Projektbezug aus Body bzw. Pfad ist eine Behauptung des Aufrufers,
  // keine Berechtigung — dieselbe Regel wie in src/api/routes/projects.ts.
  if (!(await canSeeProject({ userId: c.var.userId, role: c.var.userRole }, projectId))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }

  const ok = await teamRepo.updateProjectRole(memberId, projectId, body.projectRole ?? null);
  if (!ok) return c.json({ error: "Zuordnung nicht gefunden" }, 404);
  emit({ type: "team", action: "updated", id: memberId }, { actorId: c.var.userId });
  return c.json({ ok });
});

// Mitglied aus Projekt entfernen (Zuordnung aufheben).
teamRoutes.delete("/team/:id/projects/:projectId", async (c) => {
  const memberId = c.req.param("id");
  const projectId = c.req.param("projectId");
  if (!teamRepo.unassignFromProject) return c.json({ error: "Nicht unterstützt" }, 501);
  // Der Projektbezug aus Body bzw. Pfad ist eine Behauptung des Aufrufers,
  // keine Berechtigung — dieselbe Regel wie in src/api/routes/projects.ts.
  if (!(await canSeeProject({ userId: c.var.userId, role: c.var.userRole }, projectId))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }

  const ok = await teamRepo.unassignFromProject(memberId, projectId);
  if (ok) {
    emit({ type: "team", action: "updated", id: memberId }, { actorId: c.var.userId });
    emit({ type: "project", action: "updated", id: projectId, projectId }, { actorId: c.var.userId });
  }
  return c.json({ ok });
});

// ── Kontakt-Log (Phase 4) ──────────────────────────────────────────────────

// Log-Eintrag anhaengen. Body: { text, author? }. Zeitstempel wird
// serverseitig gesetzt, damit Client-Uhren nicht driften.
teamRoutes.post("/team/:id/log", async (c) => {
  const memberId = c.req.param("id");
  const body = await c.req.json<{ text: string; author?: string }>();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text erforderlich" }, 400);
  if (!teamRepo.appendLog) return c.json({ error: "Nicht unterstützt" }, 501);

  // ── Der Verfasser kommt aus der Anmeldung, nicht aus dem Koerper ──────────
  //
  // Hier stand `body.author?.trim()`. Damit liess sich ein Kontaktvermerk
  // unter fremdem Namen ablegen — in einer Akte, die spaeter belegen soll,
  // wer wann mit wem gesprochen hat. Der Zeitstempel wurde aus genau diesem
  // Grund schon immer serverseitig gesetzt (siehe Kommentar oben); der Name
  // gehoert daneben.
  //
  // `body.author` wird stillschweigend verworfen statt abgelehnt: aeltere
  // Aufrufer schicken es weiterhin, und eine Absage brauchte niemand.
  const dbUser = c.get("dbUser");
  const entry: ContactLogEntry = {
    ts: new Date().toISOString(),
    text,
    author: dbUser?.displayName ?? dbUser?.username ?? undefined,
  };
  const ok = await teamRepo.appendLog(memberId, entry);
  if (!ok) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  emit({ type: "team", action: "updated", id: memberId }, { actorId: c.var.userId });
  return c.json(entry, 201);
});
