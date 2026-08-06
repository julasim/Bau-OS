// ============================================================
// PATIO — User-Settings-Route
// Profil, Passwort aendern, Praeferenzen.
// Einstellungen, die keine grossen Systemauswirkungen haben.
//
// Die verifizierte Email-Aenderung (Code an die neue Adresse) ist mit dem
// Umbau zum Firmenserver entfallen — sie brauchte SMTP. Die Email-Adresse
// ist seither reine Kontaktinformation ohne Sicherheitsfunktion und wird
// vom Admin ueber PATCH /admin/users/:id gepflegt.
// ============================================================

import { Hono } from "hono";
import {
  findUser,
  updateUser,
  hashPassword,
  verifyPassword,
  updateDbUserSettings,
  updateDbUserPassword,
  type UserSettings,
  type DbUser,
  type JwtPayload,
} from "../auth.js";
import { PASSWORD_MIN_LENGTH } from "../../config.js";
import { logEvent as audit } from "../../data/db-audit.js";

type AppEnv = {
  Variables: {
    user: JwtPayload;
    userId: string | null;
    userRole: "admin" | "user";
    dbUser: DbUser | null;
  };
};
import { LANGUAGE, LOCALE, TIMEZONE, DB_ENABLED } from "../../config.js";
import { logInfo } from "../../logger.js";

export const settingsRoutes = new Hono<AppEnv>();

// ── Whitelist: nur diese Keys duerfen per PATCH geaendert werden ─────────────
const ALLOWED_SETTING_KEYS = new Set<keyof UserSettings>([
  "displayName",
  "notificationsEnabled",
  "defaultProject",
  "chatSearchMode",
]);

// ── GET /settings — Profil + Settings + Runtime-Info ─────────────────────────
settingsRoutes.get("/settings", (c) => {
  const dbUser = c.get("dbUser");
  const jwtUser = c.get("user");

  // DB-User hat Vorrang — Profil/Settings kommen aus der DB. Nur wenn kein
  // DB-User da ist (FS-Mode oder Legacy-JSON-Konto), faellt's auf JSON zurueck.
  let profile: { username: string; role: string; createdAt: string; email: string | null };
  let settings: UserSettings;
  if (dbUser) {
    profile = {
      username: dbUser.username,
      role: dbUser.role,
      createdAt: dbUser.createdAt,
      email: dbUser.email,
    };
    settings = dbUser.settings ?? {};
  } else {
    const user = findUser(jwtUser.username);
    if (!user) return c.json({ error: "User nicht gefunden" }, 404);
    profile = { username: user.username, role: user.role, createdAt: user.createdAt, email: null };
    settings = user.settings ?? {};
  }

  return c.json({
    profile,
    settings,
    runtime: {
      dbEnabled: DB_ENABLED,
    },
    system: {
      language: LANGUAGE,
      locale: LOCALE,
      timezone: TIMEZONE,
    },
  });
});

// ── PATCH /settings — Profil + Settings-Werte aendern ────────────────────────
settingsRoutes.patch("/settings", async (c) => {
  const dbUser = c.get("dbUser");
  const jwtUser = c.get("user");

  let body: { settings?: Record<string, unknown> };
  try {
    body = await c.req.json<{ settings?: Record<string, unknown> }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  if (!body.settings || typeof body.settings !== "object") {
    return c.json({ error: "settings-Objekt erforderlich" }, 400);
  }

  // Nur erlaubte Keys uebernehmen
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.settings)) {
    if (ALLOWED_SETTING_KEYS.has(key as keyof UserSettings)) {
      filtered[key] = value;
    }
  }

  // DB-User: in DB schreiben. JSON-User: in JSON-Datei.
  if (dbUser) {
    const updated = await updateDbUserSettings(dbUser.id, filtered as UserSettings);
    if (!updated) return c.json({ error: "User nicht gefunden" }, 404);
    logInfo(`[Settings] ${dbUser.username} hat Einstellungen aktualisiert: ${Object.keys(filtered).join(", ")}`);
    return c.json({ ok: true, settings: updated.settings ?? {} });
  }

  const updated = updateUser(jwtUser.username, { settings: filtered as UserSettings });
  if (!updated) return c.json({ error: "User nicht gefunden" }, 404);
  logInfo(`[Settings] ${jwtUser.username} hat Einstellungen aktualisiert: ${Object.keys(filtered).join(", ")}`);
  return c.json({ ok: true, settings: updated.settings ?? {} });
});

// ── POST /auth/password — Passwort aendern ───────────────────────────────────
settingsRoutes.post("/auth/password", async (c) => {
  const jwtUser = c.get("user");

  let body: { oldPassword: string; newPassword: string };
  try {
    body = await c.req.json<{ oldPassword: string; newPassword: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  if (!body.oldPassword || !body.newPassword) {
    return c.json({ error: "Altes und neues Passwort erforderlich" }, 400);
  }
  if (body.newPassword.length < PASSWORD_MIN_LENGTH) {
    return c.json({ error: `Neues Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben` }, 400);
  }

  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";
  const ua = (c.req.header("user-agent") ?? "").slice(0, 256);

  const dbUser = c.get("dbUser");
  if (dbUser) {
    const valid = await verifyPassword(body.oldPassword, dbUser.passwordHash);
    if (!valid) {
      void audit({
        event: "password.change",
        actorUserId: dbUser.id,
        actorUsername: dbUser.username,
        actorRole: dbUser.role,
        ip,
        userAgent: ua,
        details: { reason: "old-password-mismatch" },
        ok: false,
      });
      return c.json({ error: "Altes Passwort falsch" }, 401);
    }
    const newHash = await hashPassword(body.newPassword);
    const ok = await updateDbUserPassword(dbUser.id, newHash);
    if (!ok) return c.json({ error: "Update fehlgeschlagen" }, 500);
    logInfo(`[Settings] ${dbUser.username} hat Passwort geaendert`);
    void audit({
      event: "password.change",
      actorUserId: dbUser.id,
      actorUsername: dbUser.username,
      actorRole: dbUser.role,
      ip,
      userAgent: ua,
    });
    return c.json({ ok: true });
  }

  const user = findUser(jwtUser.username);
  if (!user) return c.json({ error: "User nicht gefunden" }, 404);
  const valid = await verifyPassword(body.oldPassword, user.passwordHash);
  if (!valid) return c.json({ error: "Altes Passwort falsch" }, 401);
  const newHash = await hashPassword(body.newPassword);
  updateUser(jwtUser.username, { passwordHash: newHash });
  logInfo(`[Settings] ${jwtUser.username} hat Passwort geaendert`);
  return c.json({ ok: true });
});
