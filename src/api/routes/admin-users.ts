// ============================================================
// PATIO — Admin-User-Verwaltung
// Nur fuer admins. Erfordert authMiddleware + adminMiddleware.
//
// Schutzregeln:
//  - is_protected-User koennen nicht geloescht werden
//  - is_protected-User koennen nicht herabgestuft werden
//  - Andere Admins koennen frei downgraded/geloescht werden — der
//    geschuetzte Admin garantiert, dass die Firma nie alle Admin-
//    Konten verliert
// ============================================================

import { Hono } from "hono";
import {
  adminMiddleware,
  listDbUsers,
  findDbUserById,
  findDbUserByUsername,
  createDbUser,
  updateDbUser,
  deleteDbUser,
  updateDbUserPassword,
  hashPassword,
  countDbAdmins,
} from "../auth.js";
import type { AppEnv } from "../server.js";
import { PASSWORD_MIN_LENGTH } from "../../config.js";
import { emit } from "../events.js";
import { logEvent as audit } from "../../data/db-audit.js";
import type { Context } from "hono";

export const adminUsersRoutes = new Hono<AppEnv>();

/** Sammelt Actor- und Request-Meta fuer Audit-Eintraege aus dem Hono-Context. */
function actorFromCtx(c: Context<AppEnv>): {
  actorUserId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  ip: string;
  userAgent: string;
} {
  const dbUser = c.get("dbUser");
  const jwtUser = c.get("user");
  return {
    actorUserId: dbUser?.id ?? c.get("userId") ?? null,
    actorUsername: dbUser?.username ?? jwtUser?.username ?? null,
    actorRole: dbUser?.role ?? c.get("userRole") ?? null,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown",
    userAgent: (c.req.header("user-agent") ?? "").slice(0, 256),
  };
}

// Alle /admin-Routes dieses Routers brauchen Admin-Rechte. Bewusst breit auf
// "/admin/*" statt je Pfad einzeln: die vorherigen Guards deckten nur
// /admin/users(/*) ab, wodurch /admin/audit ungeschuetzt danebenlag und jeder
// angemeldete Nutzer Login-Versuche, 2FA-Events und IPs aller Konten lesen
// konnte. Mit dem Prefix-Guard ist auch jede kuenftige Admin-Route gedeckt.
//
// Nicht betroffen: /users/mini (siehe unten) — die Route hat kein /admin-
// Prefix und ist absichtlich fuer alle angemeldeten Nutzer offen.
adminUsersRoutes.use("/admin/*", adminMiddleware);

// Mini-Liste fuer normale User: nur id+username+displayName, fuer Picker
// in TeamDetailView, Teilen-Modal, Member-Resolver. KEIN Admin-Guard,
// aber: nur authentifizierte User (authMiddleware ist app-weit gesetzt).
// Passwort-Hash, Telegram-Daten, is_protected sind NICHT enthalten —
// das ist die explizit oeffentliche Sicht.
adminUsersRoutes.get("/users/mini", async (c) => {
  const users = await listDbUsers();
  return c.json(
    users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
    })),
  );
});

// Hilfsfunktion: Public-Shape des Users — Passwort-Hash bleibt drin.
function publicUser(u: Awaited<ReturnType<typeof listDbUsers>>[number]) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    isProtected: u.isProtected,
    canSeeMoney: u.canSeeMoney,
    email: u.email,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

// ── Liste ────────────────────────────────────────────────────────────────────
adminUsersRoutes.get("/admin/users", async (c) => {
  const users = await listDbUsers();
  return c.json(users.map(publicUser));
});

// ── Anlegen ──────────────────────────────────────────────────────────────────
adminUsersRoutes.post("/admin/users", async (c) => {
  let body: { username: string; password: string; role?: string; displayName?: string; email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const email = (body.email ?? "").trim().toLowerCase();
  if (!username || username.length < 3) {
    return c.json({ error: "Benutzername muss mindestens 3 Zeichen haben" }, 400);
  }
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return c.json({ error: `Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben` }, 400);
  }
  // Email ist OPTIONAL. Sie war Pflicht, solange der Login 6-stellige Codes
  // dorthin verschickte; auf dem Firmenserver ohne Internet gibt es diesen
  // Weg nicht mehr, und die Pflicht haette schlicht verhindert, ueberhaupt
  // ein Konto anzulegen. Angegeben muss sie aber gueltig sein.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Ungueltige Email-Adresse" }, 400);
  }
  const role = body.role === "admin" ? "admin" : "user";

  // Duplicate-Check: bevor wir ans bcrypt-Hashing gehen.
  const existing = await findDbUserByUsername(username);
  if (existing) return c.json({ error: "Benutzername existiert bereits" }, 409);

  try {
    const user = await createDbUser({
      username,
      password,
      role,
      displayName: body.displayName?.trim() || null,
      email: email || null,
    });
    emit({ type: "team", action: "created", id: user.id });
    void audit({
      ...actorFromCtx(c),
      event: "user.create",
      targetUserId: user.id,
      targetLabel: user.username,
      details: { role: user.role },
    });
    return c.json(publicUser(user), 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return c.json({ error: "Benutzername existiert bereits" }, 409);
    }
    return c.json({ error: "Anlegen fehlgeschlagen: " + msg }, 500);
  }
});

// ── Aktualisieren (Rolle, Display-Name, Username) ───────────────────────────
adminUsersRoutes.patch("/admin/users/:id", async (c) => {
  const id = c.req.param("id");
  const target = await findDbUserById(id);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);

  let body: {
    username?: string;
    role?: string;
    displayName?: string | null;
    email?: string | null;
    canSeeMoney?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  const patch: {
    username?: string;
    role?: "admin" | "user";
    displayName?: string | null;
    email?: string | null;
    canSeeMoney?: boolean;
  } = {};

  // Geld-Recht (Migration 043). Bewusst unabhaengig von der Rolle: „Admin"
  // heisst „verwaltet die Anwendung", nicht „darf die Zahlen des Bueros
  // sehen". Die Buchhaltung braucht das eine ohne das andere.
  if ("canSeeMoney" in body) patch.canSeeMoney = body.canSeeMoney === true;

  if ("username" in body) {
    const newUsername = (body.username ?? "").trim();
    if (newUsername.length < 3) {
      return c.json({ error: "Benutzername muss mindestens 3 Zeichen haben" }, 400);
    }
    if (newUsername !== target.username) {
      const existing = await findDbUserByUsername(newUsername);
      if (existing) return c.json({ error: "Benutzername existiert bereits" }, 409);
    }
    patch.username = newUsername;
  }

  if ("role" in body) {
    const newRole = body.role === "admin" ? "admin" : "user";
    // Schutzregel A: geschuetzter Admin bleibt Admin.
    if (target.isProtected && newRole !== "admin") {
      return c.json({ error: "Geschuetzter Admin kann nicht herabgestuft werden" }, 403);
    }
    // Schutzregel B: Last-Admin-Schutz. Pre-Check als schneller Pfad,
    // der echte Race-sichere Check passiert atomar in updateDbUser().
    if (target.role === "admin" && newRole !== "admin") {
      const adminCount = await countDbAdmins();
      if (adminCount <= 1) {
        return c.json({ error: "Letzter Admin kann nicht herabgestuft werden" }, 403);
      }
    }
    patch.role = newRole;
  }

  if ("displayName" in body) {
    const dn = body.displayName;
    patch.displayName = typeof dn === "string" ? dn.trim() || null : null;
  }

  if ("email" in body) {
    const e = body.email;
    if (e === null || e === "") {
      // Admin kann die Adresse entfernen. Das hat keine Folgen mehr fuer die
      // Anmeldung — sie ist seit dem Umbau zum Firmenserver reine
      // Kontaktinformation. (Frueher stand hier, der Nutzer muesse dann den
      // Email-Einrichtungs-Fluss durchlaufen; den gibt es nicht mehr.)
      patch.email = null;
    } else if (typeof e === "string") {
      const normalized = e.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return c.json({ error: "Ungueltige Email-Adresse" }, 400);
      }
      const { isEmailTaken } = await import("../auth.js");
      if (await isEmailTaken(normalized, id)) {
        return c.json({ error: "Diese Email-Adresse ist bereits einem anderen Konto zugeordnet" }, 409);
      }
      patch.email = normalized;
    }
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "Keine aenderbaren Felder im Body" }, 400);
  }

  const updated = await updateDbUser(id, patch);
  if (updated === "last-admin") {
    return c.json({ error: "Letzter Admin kann nicht herabgestuft werden" }, 403);
  }
  if (!updated) return c.json({ error: "Update fehlgeschlagen" }, 500);
  emit({ type: "team", action: "updated", id });
  // Bei Rollen-Wechsel ein dediziertes Event — sonst generisches user.update.
  const event = patch.role && patch.role !== target.role ? "user.role" : "user.update";
  void audit({
    ...actorFromCtx(c),
    event,
    targetUserId: id,
    targetLabel: updated.username,
    details: {
      changed: Object.keys(patch),
      ...(patch.role && patch.role !== target.role ? { from: target.role, to: patch.role } : {}),
    },
  });
  return c.json(publicUser(updated));
});

// ── Passwort zuruecksetzen ──────────────────────────────────────────────────
adminUsersRoutes.patch("/admin/users/:id/password", async (c) => {
  const id = c.req.param("id");
  const target = await findDbUserById(id);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);

  let body: { newPassword: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.newPassword || body.newPassword.length < PASSWORD_MIN_LENGTH) {
    return c.json({ error: `Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben` }, 400);
  }

  const hash = await hashPassword(body.newPassword);
  const ok = await updateDbUserPassword(id, hash);
  if (!ok) return c.json({ error: "Update fehlgeschlagen" }, 500);
  emit({ type: "team", action: "updated", id });
  void audit({
    ...actorFromCtx(c),
    event: "password.admin_reset",
    targetUserId: id,
    targetLabel: target.username,
  });
  return c.json({ ok: true });
});

// ── Loeschen ────────────────────────────────────────────────────────────────
adminUsersRoutes.delete("/admin/users/:id", async (c) => {
  const id = c.req.param("id");
  const target = await findDbUserById(id);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);

  if (target.isProtected) {
    return c.json({ error: "Geschuetzter Admin kann nicht geloescht werden" }, 403);
  }

  // Schutz: User loescht sich nicht selbst (sonst sofortige Aussperrung).
  const currentUserId = c.var.userId;
  if (currentUserId && currentUserId === id) {
    return c.json({ error: "Du kannst dich nicht selbst loeschen" }, 403);
  }

  // Schutzregel: Last-Admin-Schutz. Schneller Pre-Check, der echte
  // Race-sichere Check passiert atomar in deleteDbUser().
  if (target.role === "admin") {
    const adminCount = await countDbAdmins();
    if (adminCount <= 1) {
      return c.json({ error: "Letzter Admin kann nicht geloescht werden" }, 403);
    }
  }

  const result = await deleteDbUser(id);
  if (result === "last-admin") {
    return c.json({ error: "Letzter Admin kann nicht geloescht werden" }, 403);
  }
  if (!result) return c.json({ error: "Loeschen fehlgeschlagen" }, 500);
  emit({ type: "team", action: "deleted", id });
  void audit({
    ...actorFromCtx(c),
    event: "user.delete",
    targetUserId: id,
    targetLabel: target.username,
    details: { role: target.role },
  });
  return c.json({ ok: true });
});

// ── Audit-Log lesen (nur Admins) ────────────────────────────────────────────
// Liefert die letzten N Audit-Eintraege, optional gefiltert. Limit max 500
// (DB-seitig erzwungen). Admin-only — Endpoint sitzt in admin-users weil das
// Audit-Log Auth-/User-Centric ist und der UI-Tab dort am besten passt.
adminUsersRoutes.get("/admin/audit", async (c) => {
  const { listEvents } = await import("../../data/db-audit.js");
  const url = new URL(c.req.url);
  const params = url.searchParams;

  const opts: Parameters<typeof listEvents>[0] = {};
  const limitStr = params.get("limit");
  if (limitStr) opts.limit = parseInt(limitStr, 10);
  const offsetStr = params.get("offset");
  if (offsetStr) opts.offset = parseInt(offsetStr, 10);
  const actor = params.get("actor");
  if (actor) opts.actorUserId = actor;
  const target = params.get("target");
  if (target) opts.targetUserId = target;
  const event = params.get("event");
  if (event) opts.event = event;
  const eventPrefix = params.get("eventPrefix");
  if (eventPrefix) opts.eventPrefix = eventPrefix;
  const since = params.get("since");
  if (since) opts.since = since;
  const until = params.get("until");
  if (until) opts.until = until;
  const ip = params.get("ip");
  if (ip) opts.ip = ip;

  const events = await listEvents(opts);
  return c.json(events);
});
