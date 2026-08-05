// ============================================================
// PATIO — User-Settings-Route
// Profil, Passwort aendern, LLM-Runtime, Praeferenzen.
// Einstellungen, die keine grossen Systemauswirkungen haben.
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
  if (body.newPassword.length < 8) {
    return c.json({ error: "Neues Passwort muss mindestens 8 Zeichen haben" }, 400);
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

// ── Email-Aenderung (mit Bestaetigungs-Code) ────────────────────────────────
//
// Wir senden den Verifikations-Code an die NEUE Adresse — sonst koennte ein
// kompromittierter Login-Cookie die Email auf eine Angreifer-Adresse aendern
// ohne dass der echte User es merkt. Erst nach erfolgreicher Verifikation
// wird users.email umgeschrieben.
//
// Ticket-System: ein kurzlebiges JWT (audience='2fa-setup') referenziert den
// User. Verify-Step nutzt dasselbe Ticket + den Code aus der Mail.

settingsRoutes.post("/settings/email/change/start", async (c) => {
  const dbUser = c.get("dbUser");
  if (!dbUser) return c.json({ error: "Nur fuer DB-User verfuegbar" }, 400);

  let body: { email: string };
  try {
    body = await c.req.json<{ email: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Ungueltige Email-Adresse" }, 400);
  }
  if (email === (dbUser.email ?? "")) {
    return c.json({ error: "Diese Adresse ist bereits hinterlegt." }, 400);
  }

  const { isEmailTaken, createEmailOtp, createEmailSetupTicket } = await import("../auth.js");
  if (await isEmailTaken(email, dbUser.id)) {
    return c.json({ error: "Diese Email-Adresse ist bereits einem anderen Konto zugeordnet" }, 409);
  }

  try {
    const { code } = await createEmailOtp(dbUser.id, "email-setup", email);
    const { sendMail, buildEmailVerifyMail } = await import("../email.js");
    const mail = buildEmailVerifyMail({ code, username: dbUser.displayName ?? dbUser.username });
    const sent = await sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
    if (!sent) {
      return c.json({ error: "Code konnte nicht zugestellt werden. Bitte Admin kontaktieren." }, 502);
    }
    const ticket = createEmailSetupTicket(dbUser);
    return c.json({ ticket, emailHint: maskEmail(email) });
  } catch {
    return c.json({ error: "Code konnte nicht erstellt werden" }, 500);
  }
});

settingsRoutes.post("/settings/email/change/verify", async (c) => {
  const dbUser = c.get("dbUser");
  if (!dbUser) return c.json({ error: "Nur fuer DB-User verfuegbar" }, 400);

  let body: { ticket: string; code: string };
  try {
    body = await c.req.json<{ ticket: string; code: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  const { verifyEmailSetupTicket, verifyAndConsumeEmailOtp, setUserEmail, isEmailTaken } = await import("../auth.js");
  const claim = verifyEmailSetupTicket(body.ticket);
  if (!claim) return c.json({ error: "Ticket abgelaufen oder ungueltig" }, 401);
  if (claim.sub !== dbUser.id) return c.json({ error: "Ticket gehoert zu anderem User" }, 403);

  const { getDb } = await import("../../db/client.js");
  const db = getDb();
  const [otpRow] = await db`
    SELECT ticket FROM email_otp_tokens
     WHERE user_id = ${dbUser.id} AND purpose = 'email-setup' AND used = false
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1
  `;
  if (!otpRow) return c.json({ error: "Kein aktiver Code. Bitte neu starten." }, 401);

  const result = await verifyAndConsumeEmailOtp(String(otpRow.ticket), body.code, "email-setup");
  if (!result.ok) {
    return c.json({ error: "Code ungueltig oder abgelaufen." }, 401);
  }
  if (!result.pendingEmail) return c.json({ error: "Token hat keine pending Email" }, 500);

  if (await isEmailTaken(result.pendingEmail, dbUser.id)) {
    return c.json({ error: "Diese Email-Adresse ist bereits einem anderen Konto zugeordnet" }, 409);
  }

  const updated = await setUserEmail(dbUser.id, result.pendingEmail);
  if (!updated) return c.json({ error: "Speichern fehlgeschlagen" }, 500);

  logInfo(`[Settings] ${dbUser.username} hat Email auf ${result.pendingEmail} geaendert`);
  return c.json({ ok: true, email: updated.email });
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}
