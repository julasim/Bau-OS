import { Hono } from "hono";

type AppEnv = {
  Variables: { user: { username: string; role: string } };
};
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "path";
import { API_PORT, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS } from "../config.js";
import { logInfo } from "../logger.js";
import { authMiddleware, findUser, verifyPassword, createToken } from "./auth.js";

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

const app = new Hono<AppEnv>();

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()) : undefined;

app.use(
  "/api/*",
  cors({
    origin: allowedOrigins ?? "*",
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

  const user = findUser(body.username);
  if (!user) {
    loginAttempts.set(ip, {
      count: (entry && now < entry.resetAt ? entry.count : 0) + 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return c.json({ error: "Benutzername oder Passwort falsch" }, 401);
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    loginAttempts.set(ip, {
      count: (entry && now < entry.resetAt ? entry.count : 0) + 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return c.json({ error: "Benutzername oder Passwort falsch" }, 401);
  }

  loginAttempts.delete(ip);
  const token = createToken(user.username, user.role);
  return c.json({ token, username: user.username, role: user.role });
});

// ── Auth-Middleware für alle /api/* Routes ────────────────────────────────────
app.use("/api/*", authMiddleware);

// ── Auth-Check ───────────────────────────────────────────────────────────────
app.get("/api/auth/me", (c) => {
  const user = c.get("user") as { username: string; role: string };
  return c.json({ username: user.username, role: user.role });
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
