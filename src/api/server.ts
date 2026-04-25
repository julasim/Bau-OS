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
import { API_PORT, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS, DB_ENABLED } from "../config.js";
import { logInfo } from "../logger.js";
import {
  authMiddleware,
  findUser,
  loadUsers,
  verifyPassword,
  createToken,
  findDbUserByUsername,
  countDbUsers,
  createInitialAdmin,
} from "./auth.js";

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
import { eventsRoutes } from "./routes/events.js";
import { chatRoutes } from "./routes/chat.js";
import { settingsRoutes } from "./routes/settings.js";
import { agentLogsRoutes } from "./routes/agent-logs.js";
import { adminUsersRoutes } from "./routes/admin-users.js";

const app = new Hono<AppEnv>();

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

  // Login-Strategie:
  //   1. DB-User (Migration 008) hat Vorrang. Sobald irgendein DB-User
  //      existiert, ist die JSON-Datei nur noch Read-Fallback fuer
  //      veraltete Konten — neue Logins gehen ueber DB.
  //   2. JSON-User (legacy) bleibt als Fallback solange noch nichts in
  //      der DB steht. Danach kann der Admin ihn via /admin/users in die
  //      DB nachimportieren (Phase 2).
  const dbUser = DB_ENABLED ? await findDbUserByUsername(body.username) : null;

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
    const jsonUser = findUser(body.username);
    if (jsonUser) {
      pwHash = jsonUser.passwordHash;
      username = jsonUser.username;
      role = jsonUser.role;
    }
  }

  const failLogin = () => {
    loginAttempts.set(ip, {
      count: (entry && now < entry.resetAt ? entry.count : 0) + 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return c.json({ error: "Benutzername oder Passwort falsch" }, 401);
  };

  if (!pwHash || !username || !role) return failLogin();

  const valid = await verifyPassword(body.password, pwHash);
  if (!valid) return failLogin();

  loginAttempts.delete(ip);
  const token = createToken(username, role, userId);
  return c.json({ token, username, role });
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
app.route("/api", adminUsersRoutes);
app.route("/api", eventsRoutes);
app.route("/api", chatRoutes);
app.route("/api", settingsRoutes);
app.route("/api", agentLogsRoutes);

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
