import { Hono } from "hono";

import type { DbUser, JwtPayload } from "./auth.js";

/** Hono-Variables-Shape, der von authMiddleware gesetzt wird. Routes-Dateien
 *  importieren diesen Typ und tippen ihre Hono-Instanz wie:
 *    const myRoutes = new Hono<AppEnv>();
 *  damit c.var.userId / c.var.userRole / c.var.dbUser typisiert sind. */
export type AppEnv = {
  Variables: {
    user: JwtPayload;
    userId: string | null;
    userRole: "admin" | "user";
    dbUser: DbUser | null;
  };
};
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "path";
import {
  API_PORT,
  RATE_LIMIT_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_REQUESTS,
  API_RATE_LIMIT_WINDOW_MS,
  DB_ENABLED,
} from "../config.js";
import { logInfo } from "../logger.js";
import {
  authMiddleware,
  findUser,
  loadUsers,
  verifyPassword,
  createToken,
  findDbUserByUsername,
  findDbUserById,
  countDbUsers,
  createInitialAdmin,
  create2faTicket,
  verify2faTicket,
  createEmailOtp,
  verifyAndConsumeEmailOtp,
  setUserEmail,
  isEmailTaken,
  createEmailSetupTicket,
  verifyEmailSetupTicket,
  createMagicLinkToken,
  consumeMagicLinkToken,
} from "./auth.js";
import { sendMail, buildLoginOtpMail, buildEmailVerifyMail, buildMagicLinkMail } from "./email.js";
import { logEvent as audit } from "../data/db-audit.js";
import { APP_URL } from "../config.js";

/** Bestimmt die Public-Base-URL fuer Links in Emails. APP_URL aus der
 *  Env hat Vorrang (z.B. wenn die App hinter CDN sitzt). Fallback: aus
 *  Request-Headern bauen. Caddy/Nginx muss Host + X-Forwarded-Proto
 *  korrekt forwarden — Bau-OS docker-compose macht das per Default. */
function publicBaseUrl(c: { req: { header(name: string): string | undefined } }): string {
  if (APP_URL) return APP_URL.replace(/\/$/, "");
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost";
  return `${proto}://${host}`;
}

/** Liefert IP + User-Agent fuer Audit-Eintraege aus Request-Headern.
 *  Trim auf 256 Zeichen, damit ein 8 KB User-Agent die Tabelle nicht
 *  unnoetig aufblaeht. */
function reqMeta(c: { req: { header(name: string): string | undefined } }): { ip: string; userAgent: string } {
  const ipRaw = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";
  const ua = (c.req.header("user-agent") ?? "").slice(0, 256);
  return { ip: ipRaw, userAgent: ua };
}

// Routes
import { dashboardRoutes } from "./routes/dashboard.js";
import { notesRoutes } from "./routes/notes.js";
import { tasksRoutes } from "./routes/tasks.js";
import { termineRoutes } from "./routes/termine.js";
import { projectsRoutes } from "./routes/projects.js";
import { agentsRoutes } from "./routes/agents.js";
import { searchRoutes } from "./routes/search.js";
import { filesRoutes } from "./routes/files.js";
import { teamRoutes } from "./routes/team.js";
import { companiesRoutes } from "./routes/companies.js";
import { bautagebuchRoutes } from "./routes/bautagebuch.js";
import { meetingsRoutes } from "./routes/meetings.js";
import { timeEntriesRoutes } from "./routes/time-entries.js";
import { eventsRoutes } from "./routes/events.js";
import { chatRoutes } from "./routes/chat.js";
import { settingsRoutes } from "./routes/settings.js";
import { agentLogsRoutes } from "./routes/agent-logs.js";
import { adminUsersRoutes } from "./routes/admin-users.js";
import { authMicrosoftRoutes } from "./routes/auth-microsoft.js";
import { webhooksMicrosoftRoutes } from "./routes/webhooks-microsoft.js";
// Old TOTP-Routes (auth2faRoutes): durch Email-2FA in Migration 020
// abgeloest. Endpoints werden nicht mehr exposed, damit nicht parallel
// zwei 2FA-Mechanismen laufen koennen. Datei bleibt im Code als Recovery-
// Pfad, falls die Email-2FA gar nicht zugestellt werden kann (manueller
// Re-Enable durch Admin via direktem DB-Patch).

const app = new Hono<AppEnv>();

// ── Health-Check (ohne Auth, ohne Rate-Limit) ────────────────────────────────
// Liveness-Probe fuer Reverse-Proxy / Uptime-Monitoring. Liefert minimale
// Information — KEINE Versionen, Build-Hashes oder DB-Zugaenge, weil der
// Endpunkt anonym erreichbar ist.
const startedAt = Date.now();
app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    db: DB_ENABLED,
  });
});

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()) : undefined;

app.use(
  "/api/*",
  cors({
    origin: allowedOrigins ?? `http://localhost:${API_PORT}`,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// ── Globaler Rate-Limit (per-IP, vor Auth-Middleware) ────────────────────────
// Schutz vor automatisierten Scans und Scrapern. Generoes (default 600/min),
// damit normales UI-Browsing nie limitiert wird. Login + Setup-Wizard haben
// zusaetzlich engere Limits weiter unten.
//
// In-Memory Sliding-Window: pro IP ein Bucket mit Counter und resetAt.
// Reicht fuer Single-Instance-Deployments (Bau-OS laeuft auf einer VM).
// Bei Multi-Instance muesste das auf Redis o.ae. wandern — aktuell nicht
// relevant.
const apiBuckets = new Map<string, { count: number; resetAt: number }>();

app.use("/api/*", async (c, next) => {
  // Health-Endpunkt ist oben schon abgehandelt — kommt hier nicht mehr an.
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";
  const now = Date.now();
  const bucket = apiBuckets.get(ip);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= API_RATE_LIMIT_REQUESTS) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Zu viele Anfragen. Bitte kurz warten." }, 429);
    }
    bucket.count++;
  } else {
    apiBuckets.set(ip, { count: 1, resetAt: now + API_RATE_LIMIT_WINDOW_MS });
  }

  // Bucket-GC: alle 5 Minuten Map durchlaufen und abgelaufene Eintraege
  // loeschen, sonst waechst die Map unbegrenzt bei jedem neuen Client.
  if (now % 100 === 0 && apiBuckets.size > 1000) {
    for (const [k, v] of apiBuckets) {
      if (now >= v.resetAt) apiBuckets.delete(k);
    }
  }

  await next();
});

// ── Rate Limiting (Login) ────────────────────────────────────────────────────
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// ── Login (ohne Auth) ────────────────────────────────────────────────────────
app.post("/api/auth/login", async (c) => {
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt && entry.count >= RATE_LIMIT_ATTEMPTS) {
    return c.json({ error: "Zu viele Login-Versuche. Bitte spaeter erneut versuchen." }, 429);
  }

  let body: { username: string; password: string };
  try {
    body = await c.req.json<{ username: string; password: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.username || !body.password) {
    return c.json({ error: "Benutzername und Passwort erforderlich" }, 400);
  }

  // Username trimmen — sonst schlaegt der Lookup fehl wenn der Browser
  // (z.B. via Autofill) ein Leerzeichen am Ende mitschickt. Konsistent
  // mit createDbUser/createInitialAdmin/Setup-Wizard, die schon trimmen.
  // Passwort bewusst NICHT trimmen — Whitespace darf Teil des Passworts sein.
  const usernameInput = body.username.trim();

  // Login-Strategie:
  //   1. DB-User (Migration 008) hat Vorrang. Sobald irgendein DB-User
  //      existiert, ist die JSON-Datei nur noch Read-Fallback fuer
  //      veraltete Konten — neue Logins gehen ueber DB.
  //   2. JSON-User (legacy) bleibt als Fallback solange noch nichts in
  //      der DB steht. Danach kann der Admin ihn via /admin/users in die
  //      DB nachimportieren (Phase 2).
  const dbUser = DB_ENABLED ? await findDbUserByUsername(usernameInput) : null;

  let pwHash: string | undefined;
  let username: string | undefined;
  let role: string | undefined;
  let userId: string | undefined;
  if (dbUser) {
    pwHash = dbUser.passwordHash;
    username = dbUser.username;
    role = dbUser.role;
    userId = dbUser.id;
  } else {
    const jsonUser = findUser(usernameInput);
    if (jsonUser) {
      pwHash = jsonUser.passwordHash;
      username = jsonUser.username;
      role = jsonUser.role;
    }
  }

  const meta = reqMeta(c);
  const failLogin = (reason: string) => {
    loginAttempts.set(ip, {
      count: (entry && now < entry.resetAt ? entry.count : 0) + 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    void audit({
      event: "login.fail",
      actorUsername: usernameInput,
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { reason },
      ok: false,
    });
    return c.json({ error: "Benutzername oder Passwort falsch" }, 401);
  };

  if (!pwHash || !username || !role) return failLogin("user-not-found");

  const valid = await verifyPassword(body.password, pwHash);
  if (!valid) return failLogin("password-mismatch");

  loginAttempts.delete(ip);

  // ── Email-2FA-Pfad (Migration 020) ──────────────────────────────────────
  // - DB-User MIT Email → 6-stelliger Code via SMTP, Ticket fuer Step 2.
  // - DB-User OHNE Email (Legacy-Konten vor Migration 020) → Setup-Ticket
  //   damit der User auf der Setup-Seite seine Email hinterlegen + verifizieren
  //   kann. Erst nach erfolgreicher Verifikation gibt's ein JWT.
  // - JSON-User → direkter Login ohne 2FA (Legacy-Pfad bleibt fuer Bootstrap).
  if (dbUser) {
    if (dbUser.email) {
      try {
        const { ticket: otpTicket, code } = await createEmailOtp(dbUser.id, "login");
        const ticket = create2faTicket(dbUser);
        const mail = buildLoginOtpMail({
          code,
          username: dbUser.displayName ?? dbUser.username,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        const sent = await sendMail({ to: dbUser.email, subject: mail.subject, text: mail.text, html: mail.html });
        void audit({
          event: sent ? "login.email.sent" : "login.email.fail",
          actorUserId: dbUser.id,
          actorUsername: dbUser.username,
          actorRole: dbUser.role,
          ip: meta.ip,
          userAgent: meta.userAgent,
          details: { sent, otpTicket: otpTicket.slice(0, 8) + "…" },
          ok: sent,
        });
        if (!sent) {
          return c.json({ error: "Login-Code konnte nicht zugestellt werden. Bitte Admin kontaktieren." }, 502);
        }
        // emailHint: maskierte Anzeige fuer die UI ("ju***@example.com").
        return c.json({
          requires2fa: true,
          ticket,
          username: dbUser.username,
          emailHint: maskEmail(dbUser.email),
        });
      } catch (err) {
        const { logError } = await import("../logger.js");
        logError("[Login] Email-OTP konnte nicht erstellt werden", err);
        return c.json({ error: "Login-Code konnte nicht erstellt werden." }, 500);
      }
    }
    // Kein Email gesetzt → Email-Setup-Flow erzwingen (mandatory).
    const ticket = createEmailSetupTicket(dbUser);
    void audit({
      event: "login.email_setup_required",
      actorUserId: dbUser.id,
      actorUsername: dbUser.username,
      actorRole: dbUser.role,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return c.json({ requiresEmailSetup: true, ticket, username: dbUser.username });
  }

  // Legacy-JSON-User: kein 2FA. Bleibt fuer Setup-Wizard und Recovery
  // erhalten — neue User werden als DB-User mit Email-Pflicht angelegt.
  const token = createToken(username, role, userId);
  void audit({
    event: "login.success",
    actorUserId: userId ?? null,
    actorUsername: username,
    actorRole: role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { step: "single-factor-legacy-json" },
  });
  return c.json({ token, username, role });
});

/** Maskiert eine Email-Adresse fuer die Anzeige im Login-UI:
 *    julius@sima.or.at → ju***@sima.or.at */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

// ── Login Step 2: Email-OTP verifizieren und JWT ausstellen ─────────────────
app.post("/api/auth/login/2fa", async (c) => {
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt && entry.count >= RATE_LIMIT_ATTEMPTS) {
    return c.json({ error: "Zu viele Versuche. Bitte spaeter erneut versuchen." }, 429);
  }

  let body: { ticket: string; code: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.ticket || !body.code) {
    return c.json({ error: "Ticket und Code erforderlich" }, 400);
  }

  const claim = verify2faTicket(body.ticket);
  if (!claim) return c.json({ error: "Ticket abgelaufen oder ungueltig" }, 401);

  const user = await findDbUserById(claim.sub);
  if (!user) return c.json({ error: "User nicht gefunden" }, 404);

  const meta = reqMeta(c);
  const trackFail = (reason: string) => {
    loginAttempts.set(ip, {
      count: (entry && now < entry.resetAt ? entry.count : 0) + 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    void audit({
      event: "login.2fa.fail",
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { reason },
      ok: false,
    });
  };

  // Wir suchen nach einem Email-OTP, das per createEmailOtp() angelegt
  // wurde — der Login-Flow uebergibt das JWT-Ticket nicht das DB-Ticket
  // direkt. Wir brauchen also den juengsten unbenutzten Login-OTP-Eintrag
  // dieses Users.
  const { getDb } = await import("../db/client.js");
  const db = getDb();
  const [otpRow] = await db`
    SELECT ticket FROM email_otp_tokens
     WHERE user_id = ${user.id} AND purpose = 'login' AND used = false
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1
  `;
  if (!otpRow) {
    trackFail("no-active-otp");
    return c.json({ error: "Kein aktiver Code. Bitte Login neu starten." }, 401);
  }

  const result = await verifyAndConsumeEmailOtp(String(otpRow.ticket), body.code, "login");
  if (!result.ok) {
    trackFail(result.reason);
    const msg =
      result.reason === "expired"
        ? "Code abgelaufen. Bitte Login neu starten."
        : result.reason === "too-many-attempts"
          ? "Zu viele Fehlversuche. Bitte Login neu starten."
          : result.reason === "used"
            ? "Code wurde bereits verwendet."
            : "Code ungueltig.";
    return c.json({ error: msg }, 401);
  }

  loginAttempts.delete(ip);
  const token = createToken(user.username, user.role, user.id);
  void audit({
    event: "login.2fa.success",
    actorUserId: user.id,
    actorUsername: user.username,
    actorRole: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { method: "email-otp" },
  });
  return c.json({ token, username: user.username, role: user.role });
});

// ── Email-Setup (mandatory): Code anfordern + verifizieren ──────────────────
// Wird nach dem Login aufgerufen, wenn der User noch keine Email hat
// (Legacy-Konten vor Migration 020).
//
// Schritt 1: POST /api/auth/setup-email/start (ticket + email)
//   - Sendet Verifikationscode an die NEUE Email
//   - Ticket bleibt gueltig bis verify oder Ablauf
// Schritt 2: POST /api/auth/setup-email/verify (ticket + code)
//   - Setzt users.email auf die pending_email
//   - Liefert reguläres JWT zurueck

app.post("/api/auth/setup-email/start", async (c) => {
  let body: { ticket: string; email: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.ticket || !body.email) return c.json({ error: "Ticket und Email erforderlich" }, 400);

  const email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Ungueltige Email-Adresse" }, 400);
  }

  const claim = verifyEmailSetupTicket(body.ticket);
  if (!claim) return c.json({ error: "Ticket abgelaufen oder ungueltig" }, 401);

  const user = await findDbUserById(claim.sub);
  if (!user) return c.json({ error: "User nicht gefunden" }, 404);

  if (await isEmailTaken(email, user.id)) {
    return c.json({ error: "Diese Email-Adresse ist bereits einem anderen Konto zugeordnet." }, 409);
  }

  const meta = reqMeta(c);
  try {
    const { code } = await createEmailOtp(user.id, "email-setup", email);
    const mail = buildEmailVerifyMail({ code, username: user.displayName ?? user.username });
    const sent = await sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
    void audit({
      event: sent ? "email_setup.code_sent" : "email_setup.code_fail",
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { email: maskEmail(email), sent },
      ok: sent,
    });
    if (!sent) {
      return c.json({ error: "Code konnte nicht zugestellt werden. Bitte Admin kontaktieren." }, 502);
    }
    return c.json({ ok: true, emailHint: maskEmail(email) });
  } catch (err) {
    const { logError } = await import("../logger.js");
    logError("[EmailSetup] Code konnte nicht erstellt werden", err);
    return c.json({ error: "Code konnte nicht erstellt werden." }, 500);
  }
});

app.post("/api/auth/setup-email/verify", async (c) => {
  let body: { ticket: string; code: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.ticket || !body.code) return c.json({ error: "Ticket und Code erforderlich" }, 400);

  const claim = verifyEmailSetupTicket(body.ticket);
  if (!claim) return c.json({ error: "Ticket abgelaufen oder ungueltig" }, 401);

  const user = await findDbUserById(claim.sub);
  if (!user) return c.json({ error: "User nicht gefunden" }, 404);

  // Juengsten unbenutzten Setup-OTP des Users finden.
  const { getDb } = await import("../db/client.js");
  const db = getDb();
  const [otpRow] = await db`
    SELECT ticket FROM email_otp_tokens
     WHERE user_id = ${user.id} AND purpose = 'email-setup' AND used = false
       AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1
  `;
  if (!otpRow) {
    return c.json({ error: "Kein aktiver Code. Bitte Setup neu starten." }, 401);
  }

  const result = await verifyAndConsumeEmailOtp(String(otpRow.ticket), body.code, "email-setup");
  if (!result.ok) {
    const msg =
      result.reason === "expired"
        ? "Code abgelaufen. Bitte Setup neu starten."
        : result.reason === "too-many-attempts"
          ? "Zu viele Fehlversuche. Bitte Setup neu starten."
          : "Code ungueltig.";
    return c.json({ error: msg }, 401);
  }

  // pending_email auf die echte Spalte schreiben.
  if (!result.pendingEmail) {
    return c.json({ error: "Setup-Token hat keine pending Email — bitte neu starten." }, 500);
  }

  // Race-Schutz: nochmal pruefen ob die Email zwischenzeitlich anderweitig
  // belegt wurde.
  if (await isEmailTaken(result.pendingEmail, user.id)) {
    return c.json({ error: "Diese Email-Adresse ist bereits einem anderen Konto zugeordnet." }, 409);
  }

  const updated = await setUserEmail(user.id, result.pendingEmail);
  if (!updated) return c.json({ error: "Speichern fehlgeschlagen" }, 500);

  const meta = reqMeta(c);
  void audit({
    event: "email_setup.success",
    actorUserId: user.id,
    actorUsername: user.username,
    actorRole: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { email: maskEmail(result.pendingEmail) },
  });

  // JWT direkt ausstellen — der User hat sich gerade per Passwort + Email-
  // Verifikation authentifiziert. Aequivalent zu einem 2FA-Login.
  const token = createToken(updated.username, updated.role, updated.id);
  return c.json({ token, username: updated.username, role: updated.role });
});

// ── Magic-Link-Login (Migration 021) ────────────────────────────────────────
//
// Schritt 1: POST /api/auth/login/magic-link/start (mit 2fa-Ticket)
//   - Generiert 32-Byte URL-safe Token, hasht ihn (sha256), speichert
//     den Hash im email_otp_tokens-Eintrag mit purpose='magic-link'.
//   - Versendet die Mail mit URL ?magic=<plain-Token>.
// Schritt 2: GET  /api/auth/login/magic-link/consume?token=<plain>
//   - Hasht den uebergebenen Token, sucht Eintrag, marked used.
//   - Liefert JWT bei Erfolg.
//
// Ablauf im UI:
//   1. User loggt sich mit Username+Passwort ein → kriegt 2FA-Ticket.
//   2. Statt Code einzutippen klickt er "Anmelde-Link statt Code".
//   3. Frontend POST /magic-link/start → Mail wird verschickt.
//   4. User klickt Link in Mail → Frontend nimmt ?magic-Param,
//      ruft GET /magic-link/consume → eingeloggt.

app.post("/api/auth/login/magic-link/start", async (c) => {
  let body: { ticket: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.ticket) return c.json({ error: "Ticket fehlt" }, 400);

  const claim = verify2faTicket(body.ticket);
  if (!claim) return c.json({ error: "Ticket abgelaufen oder ungueltig" }, 401);

  const user = await findDbUserById(claim.sub);
  if (!user || !user.email) {
    return c.json({ error: "User nicht gefunden oder keine Email hinterlegt" }, 404);
  }

  const meta = reqMeta(c);
  try {
    const tokenPlain = await createMagicLinkToken(user.id);
    // URL-Aufbau: /login?magic=<token>. LoginView fischt den Param,
    // ruft den Consume-Endpoint und ist dann eingeloggt.
    const url = `${publicBaseUrl(c)}/login?magic=${encodeURIComponent(tokenPlain)}`;
    const mail = buildMagicLinkMail({
      username: user.displayName ?? user.username,
      magicLinkUrl: url,
    });
    const sent = await sendMail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
    void audit({
      event: sent ? "login.magic_link.sent" : "login.magic_link.fail",
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { sent },
      ok: sent,
    });
    if (!sent) {
      return c.json({ error: "Anmelde-Link konnte nicht zugestellt werden" }, 502);
    }
    return c.json({ ok: true });
  } catch (err) {
    const { logError } = await import("../logger.js");
    logError("[Login] Magic-Link konnte nicht erstellt werden", err);
    return c.json({ error: "Anmelde-Link konnte nicht erstellt werden" }, 500);
  }
});

app.get("/api/auth/login/magic-link/consume", async (c) => {
  const tokenPlain = c.req.query("token");
  if (!tokenPlain) return c.json({ error: "Token fehlt" }, 400);

  const meta = reqMeta(c);
  const user = await consumeMagicLinkToken(tokenPlain);
  if (!user) {
    void audit({
      event: "login.magic_link.fail",
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { reason: "invalid-or-expired" },
      ok: false,
    });
    return c.json({ error: "Anmelde-Link ungueltig oder abgelaufen. Bitte neu starten." }, 401);
  }

  const token = createToken(user.username, user.role, user.id);
  void audit({
    event: "login.magic_link.success",
    actorUserId: user.id,
    actorUsername: user.username,
    actorRole: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return c.json({ token, username: user.username, role: user.role });
});

// ── Setup-Wizard (ohne Auth) ────────────────────────────────────────────────
// Wenn die DB leer ist UND es keine JSON-User gibt, kann der erste Aufruf
// einen Admin via Web-Formular anlegen. Sobald irgendein User existiert,
// kommt 410 zurueck — kein Setup mehr moeglich, alles laeuft ueber Login
// bzw. /admin/users.

app.get("/api/setup/status", async (c) => {
  if (!DB_ENABLED) {
    // Im FS-Mode regiert weiterhin users.json — kein Setup-Wizard noetig.
    return c.json({ needsSetup: false, dbEnabled: false });
  }
  const userCount = await countDbUsers();
  const jsonCount = loadUsers().length;
  return c.json({
    needsSetup: userCount === 0 && jsonCount === 0,
    dbEnabled: true,
  });
});

app.post("/api/setup/admin", async (c) => {
  if (!DB_ENABLED) {
    return c.json({ error: "Setup nur im DB-Modus verfuegbar" }, 503);
  }
  const userCount = await countDbUsers();
  const jsonCount = loadUsers().length;
  if (userCount > 0 || jsonCount > 0) {
    return c.json({ error: "Setup bereits abgeschlossen" }, 410);
  }

  let body: { username: string; password: string; email?: string };
  try {
    body = await c.req.json<{ username: string; password: string; email?: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  const email = (body.email ?? "").trim().toLowerCase();
  if (!username || username.length < 3) {
    return c.json({ error: "Benutzername muss mindestens 3 Zeichen haben" }, 400);
  }
  if (!password || password.length < 8) {
    return c.json({ error: "Passwort muss mindestens 8 Zeichen haben" }, 400);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Gueltige Email-Adresse erforderlich (fuer 2FA-Login)" }, 400);
  }

  const admin = await createInitialAdmin(username, password, email);
  const token = createToken(admin.username, admin.role, admin.id);
  return c.json({ token, username: admin.username, role: admin.role, id: admin.id }, 201);
});

// ── Microsoft-OAuth-Routes VOR der globalen authMiddleware ──────────────────
// Der Callback (/api/auth/microsoft/callback) muss public sein — Microsoft
// schickt einen anonymen Browser dorthin (ohne JWT-Header). Die Schutz-
// mechanik des Callbacks ist der state-JWT (audience='ms-oauth'), nicht das
// reguläre Auth-Token. Die anderen 4 Routes (status, connect, disconnect,
// settings) setzen ihre eigene authMiddleware inline — siehe auth-microsoft.ts.
app.route("/api", authMicrosoftRoutes);

// ── Microsoft-Webhook-Receiver VOR der globalen authMiddleware ──────────────
// Microsoft Graph schickt Notifications anonym (ohne Auth-Header). Die
// Sicherheit kommt aus dem clientState-HMAC, nicht aus JWT — siehe
// routes/webhooks-microsoft.ts. Endpoint: POST /api/webhooks/microsoft
app.route("/api", webhooksMicrosoftRoutes);

// ── Auth-Middleware für alle /api/* Routes ────────────────────────────────────
app.use("/api/*", authMiddleware);

// ── Auth-Check ───────────────────────────────────────────────────────────────
// Liefert minimales Profil fuer die Web-UI (Avatar, Begruessung, Settings).
// displayName kommt aus user.settings.displayName — falls nicht gesetzt,
// faellt die UI auf den Username zurueck.
app.get("/api/auth/me", (c) => {
  const jwtUser = c.get("user") as JwtPayload;
  const dbUser = c.get("dbUser") as DbUser | null;
  const userId = c.get("userId") as string | null;
  // DB-User hat Vorrang fuer alle Felder. Fallback ist der Legacy-JSON-User
  // (nur solange kein DB-User existiert).
  if (dbUser) {
    return c.json({
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role,
      displayName: dbUser.displayName ?? dbUser.settings?.displayName ?? null,
      isProtected: dbUser.isProtected,
      hasTelegram: !!dbUser.telegramChatId,
    });
  }
  const json = findUser(jwtUser.username);
  return c.json({
    // Fallback fuer Legacy-JSON-Konten: Username als id (eindeutig). Sobald
    // der Account in die DB migriert ist, kommt eine echte UUID zurueck.
    id: userId ?? jwtUser.username,
    username: jwtUser.username,
    role: jwtUser.role,
    displayName: json?.settings?.displayName ?? null,
    isProtected: false,
    hasTelegram: false,
  });
});

// ── API-Routes ───────────────────────────────────────────────────────────────
app.route("/api", dashboardRoutes);
app.route("/api", notesRoutes);
app.route("/api", tasksRoutes);
app.route("/api", termineRoutes);
app.route("/api", projectsRoutes);
app.route("/api", agentsRoutes);
app.route("/api", searchRoutes);
app.route("/api", filesRoutes);
app.route("/api", teamRoutes);
app.route("/api", companiesRoutes);
app.route("/api", bautagebuchRoutes);
app.route("/api", meetingsRoutes);
app.route("/api", timeEntriesRoutes);
app.route("/api", adminUsersRoutes);
app.route("/api", eventsRoutes);
app.route("/api", chatRoutes);
app.route("/api", settingsRoutes);
app.route("/api", agentLogsRoutes);
// authMicrosoftRoutes wird oben VOR der globalen authMiddleware registriert,
// damit /callback public bleibt — siehe Kommentar bei Zeile ~696.
// app.route("/api", auth2faRoutes); — siehe Kommentar oben

// ── Statische Dateien (Vue SPA in Production) ────────────────────────────────
app.use("/*", serveStatic({ root: "./dist/web" }));

// SPA Fallback: alle nicht-API Routes → index.html
app.get("/*", serveStatic({ root: "./dist/web", path: "index.html" }));

// ── Server starten ───────────────────────────────────────────────────────────
export function startApi(): void {
  serve({ fetch: app.fetch, port: API_PORT }, () => {
    logInfo(`[API] Web-Server gestartet auf http://0.0.0.0:${API_PORT}`);
  });
}
