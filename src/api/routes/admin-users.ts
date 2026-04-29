// ============================================================
// Bau-OS — Admin-User-Verwaltung
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
  createPairToken,
  setUserBotToken,
  setUserBotEnabled,
  countDbAdmins,
} from "../auth.js";
import type { AppEnv } from "../server.js";
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

// Alle Routes hier brauchen Admin-Rechte.
adminUsersRoutes.use("/admin/users/*", adminMiddleware);
adminUsersRoutes.use("/admin/users", adminMiddleware);

// Hilfsfunktion: Public-Shape des Users — Passwort-Hash bleibt drin.
function publicUser(u: Awaited<ReturnType<typeof listDbUsers>>[number]) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    isProtected: u.isProtected,
    hasTelegram: !!u.telegramChatId,
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
  let body: { username: string; password: string; role?: string; displayName?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || username.length < 3) {
    return c.json({ error: "Benutzername muss mindestens 3 Zeichen haben" }, 400);
  }
  if (!password || password.length < 8) {
    return c.json({ error: "Passwort muss mindestens 8 Zeichen haben" }, 400);
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

  let body: { username?: string; role?: string; displayName?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  const patch: { username?: string; role?: "admin" | "user"; displayName?: string | null } = {};

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
  if (!body.newPassword || body.newPassword.length < 8) {
    return c.json({ error: "Passwort muss mindestens 8 Zeichen haben" }, 400);
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

// ── Telegram-Pair-Token generieren (Phase 5) ───────────────────────────────
// Admin generiert einen Token, der User schickt /pair <token> dem Bot.
// 10 Minuten gueltig — danach automatisch ungueltig.
//
// Response enthaelt zusaetzlich botUsername — das ist der Telegram-Username
// (ohne @) des Bots, an den der Pair-Befehl geschickt werden muss. UI baut
// daraus einen t.me/<username>-Link, damit der User direkt in den richtigen
// Chat gelangt. Wenn der Ziel-User einen eigenen Bot hat, ist das sein Bot —
// sonst der Default-Bot. Kann null sein wenn weder eigener Bot laeuft noch
// Default-Bot gesetzt ist.
adminUsersRoutes.post("/admin/users/:id/pair-token", async (c) => {
  const id = c.req.param("id");
  const target = await findDbUserById(id);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);
  const result = await createPairToken(id);
  let botUsername: string | null = null;
  try {
    const { getBotUsernameForUser } = await import("../../bot-manager.js");
    botUsername = getBotUsernameForUser(id);
  } catch {
    /* BotManager nicht aktiv (FS-Mode) — UI faellt auf generische Anzeige zurueck */
  }
  void audit({
    ...actorFromCtx(c),
    event: "pair.create",
    targetUserId: id,
    targetLabel: target.username,
  });
  return c.json({ ...result, botUsername }, 201);
});

// ── Telegram-Bot eines Users setzen/entfernen (Phase 6) ───────────────────
// Admin-Override: kann fuer jeden User den Bot-Token setzen/loeschen.
// Self-Service-Variante laeuft ueber /me/telegram-bot (settings.ts).
//
// Helper: liefert botUsername (aus Bot-Manager-Cache) + botRunning,
// gleicher Pattern wie in settings.ts. UI nutzt das, um zu zeigen
// ob der Bot wirklich gestartet ist (vs. nur Token gesetzt).
async function getBotMeta(userId: string): Promise<{ botUsername: string | null; botRunning: boolean }> {
  try {
    const { getBotUsernameForUser, getBotStatus } = await import("../../bot-manager.js");
    return {
      botUsername: getBotUsernameForUser(userId),
      botRunning: getBotStatus(userId) === "running",
    };
  } catch {
    return { botUsername: null, botRunning: false };
  }
}

// GET — aktuellen Bot-Status fuer den User abrufen.
// Token selbst wird NIE im Response zurueckgegeben.
adminUsersRoutes.get("/admin/users/:id/telegram-bot", async (c) => {
  const id = c.req.param("id");
  const target = await findDbUserById(id);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);
  const meta = await getBotMeta(target.id);
  return c.json({
    hasToken: !!target.telegramBotToken,
    enabled: target.telegramBotEnabled,
    chatId: target.telegramChatId,
    ...meta,
  });
});

adminUsersRoutes.put("/admin/users/:id/telegram-bot", async (c) => {
  const id = c.req.param("id");
  const target = await findDbUserById(id);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);

  const body = await c.req.json<{ token?: string | null; enabled?: boolean }>();
  // Token-Format-Validation — gleiche Regex wie in settings.ts.
  // BotFather-Tokens haben das Format "123456789:ABC..." (Ziffern,
  // Doppelpunkt, mind. 30 Zeichen aus [A-Za-z0-9_-]).
  let tokenChanged: "set" | "clear" | null = null;
  if ("token" in body && body.token != null) {
    const token = String(body.token).trim();
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
      return c.json({ error: "Bot-Token hat falsches Format. Erwartet: '123456789:ABC...' (von @BotFather)" }, 400);
    }
    await setUserBotToken(id, token);
    tokenChanged = "set";
  } else if ("token" in body) {
    await setUserBotToken(id, null);
    tokenChanged = "clear";
  }
  if ("enabled" in body) {
    await setUserBotEnabled(id, body.enabled === true);
  }
  // Bot-Manager neu synchronisieren — alter Bot stoppt, neuer startet.
  try {
    const { refresh } = await import("../../bot-manager.js");
    await refresh();
  } catch {
    /* Manager ist evtl. nicht aktiv (FS-Mode) — kein Fehler */
  }
  emit({ type: "team", action: "updated", id });
  if (tokenChanged) {
    void audit({
      ...actorFromCtx(c),
      event: tokenChanged === "set" ? "bot.token.set" : "bot.token.clear",
      targetUserId: id,
      targetLabel: target.username,
    });
  }
  // Frischen Status zurueckgeben, damit UI sofort sieht ob Bot startet.
  const meta = await getBotMeta(id);
  return c.json({ ok: true, ...meta });
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
