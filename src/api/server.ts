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
  getTotpSecretPlain,
  consumeBackupCode,
} from "./auth.js";
import { verifyToken as verifyTotpToken } from "./totp.js";
import { logEvent as audit } from "../data/db-audit.js";

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
import { auth2faRoutes } from "./routes/auth-2fa.js";

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

  // 2FA-Check: hat der DB-User TOTP aktiv? Dann statt Token ein kurzes
  // Ticket ausstellen, das nur fuer /auth/login/2fa verwendet werden kann.
  // Legacy-JSON-User haben kein 2FA — die laufen weiter mit Single-Factor.
  if (dbUser?.totpEnabled) {
    const ticket = create2faTicket(dbUser);
    void audit({
      event: "login.success",
      actorUserId: dbUser.id,
      actorUsername: dbUser.username,
      actorRole: dbUser.role,
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { step: "password-ok-pending-2fa" },
    });
    return c.json({ requires2fa: true, ticket, username: dbUser.username });
  }

  const token = createToken(username, role, userId);
  void audit({
    event: "login.success",
    actorUserId: userId ?? null,
    actorUsername: username,
    actorRole: role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { step: "single-factor" },
  });
  return c.json({ token, username, role });
});

// ── Login Step 2: TOTP-Token verifizieren und JWT ausstellen ────────────────
app.post("/api/auth/login/2fa", async (c) => {
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt && entry.count >= RATE_LIMIT_ATTEMPTS) {
    return c.json({ error: "Zu viele Versuche. Bitte spaeter erneut versuchen." }, 429);
  }

  let body: { ticket: string; token?: string; backupCode?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.ticket) return c.json({ error: "Ticket fehlt" }, 400);
  if (!body.token && !body.backupCode) {
    return c.json({ error: "TOTP-Token oder Backup-Code erforderlich" }, 400);
  }

  const claim = verify2faTicket(body.ticket);
  if (!claim) return c.json({ error: "Ticket abgelaufen oder ungueltig" }, 401);

  const user = await findDbUserById(claim.sub);
  if (!user || !user.totpEnabled) {
    return c.json({ error: "2FA nicht aktiv" }, 400);
  }

  // Reihenfolge: Token zuerst (regulaerer Flow). Backup-Code nur, wenn der
  // User explizit darauf umschaltet — dann wird genau einer verbraucht.
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

  let usedBackup = false;
  if (body.token) {
    const secret = await getTotpSecretPlain(user.id);
    if (!secret) {
      return c.json({ error: "Kein TOTP-Secret hinterlegt" }, 500);
    }
    if (!verifyTotpToken(secret, body.token)) {
      trackFail("token-invalid");
      return c.json({ error: "TOTP-Token ungueltig" }, 401);
    }
  } else if (body.backupCode) {
    const ok = await consumeBackupCode(user.id, body.backupCode);
    if (!ok) {
      trackFail("backup-code-invalid");
      return c.json({ error: "Backup-Code ungueltig" }, 401);
    }
    usedBackup = true;
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
    details: { method: usedBackup ? "backup-code" : "totp" },
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

  let body: { username: string; password: string };
  try {
    body = await c.req.json<{ username: string; password: string }>();
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

  const admin = await createInitialAdmin(username, password);
  const token = createToken(admin.username, admin.role, admin.id);
  return c.json({ token, username: admin.username, role: admin.role, id: admin.id }, 201);
});

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
app.route("/api", auth2faRoutes);

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
