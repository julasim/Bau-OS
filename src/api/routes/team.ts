import { Hono } from "hono";
import { teamRepo } from "../../data/index.js";
import type { MemberType, ContactLogEntry } from "../../data/types.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import { darfGeldSehen } from "../geld.js";
import { getVisibleProjectIds } from "../../data/access.js";

export const teamRoutes = new Hono<AppEnv>();

const ALLOWED_MEMBER_TYPES: MemberType[] = ["Intern", "Planer", "Ausführende", "Behörde", "Lieferant", "Bauherr"];

function normalizeMemberType(v: unknown): MemberType | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return (ALLOWED_MEMBER_TYPES as string[]).includes(t) ? (t as MemberType) : null;
}

/** Sichtbare Projekte des Aufrufers — begrenzt die Projektzuordnungen, die
 *  an den Mitgliedern haengen. */
async function sichtbar(c: { var: { userId: string | null; userRole: "admin" | "user" } }) {
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
  } catch {
    return c.json({ error: "Mitglied existiert bereits" }, 409);
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
    }>
  >();

  const updates: Record<string, unknown> = {};
  // Nur Felder uebernehmen, die explizit im Body sind (inkl. null = leeren).
  for (const key of ["name", "role", "email", "phone", "company", "companyId", "companyName", "projectId"] as const) {
    if (key in body) updates[key] = body[key];
  }
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
  const name = c.req.param("name");
  const ok = await teamRepo.remove(name);
  if (ok) emit({ type: "team", action: "deleted" }, { actorId: c.var.userId });
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

  const ok = await teamRepo.assignToProject(memberId, body.projectId, body.projectRole ?? null);
  if (!ok) return c.json({ error: "Zuordnung fehlgeschlagen" }, 500);
  emit({ type: "team", action: "updated", id: memberId }, { actorId: c.var.userId });
  emit(
    { type: "project", action: "updated", id: body.projectId, projectId: body.projectId },
    {
      actorId: c.var.userId,
    },
  );
  const member = await teamRepo.get(memberId);
  return c.json(member);
});

// Projekt-Rolle eines Mitglieds aktualisieren. Body: { projectRole }.
teamRoutes.patch("/team/:id/projects/:projectId", async (c) => {
  const memberId = c.req.param("id");
  const projectId = c.req.param("projectId");
  const body = await c.req.json<{ projectRole?: string | null }>();
  if (!teamRepo.updateProjectRole) return c.json({ error: "Nicht unterstützt" }, 501);

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

  const entry: ContactLogEntry = {
    ts: new Date().toISOString(),
    text,
    author: body.author?.trim() || undefined,
  };
  const ok = await teamRepo.appendLog(memberId, entry);
  if (!ok) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  emit({ type: "team", action: "updated", id: memberId }, { actorId: c.var.userId });
  return c.json(entry, 201);
});
