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
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  API_PORT,
  PASSWORD_MIN_LENGTH,
  RATE_LIMIT_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  API_RATE_LIMIT_REQUESTS,
  API_RATE_LIMIT_WINDOW_MS,
  DB_ENABLED,
  IS_PRODUCTION,
  JWT_SECRET_OK,
} from "../config.js";
import { logInfo, logError } from "../logger.js";
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
import { logEvent as audit } from "../data/db-audit.js";
import { KonfliktFehler } from "../data/konflikt.js";
import { geldFilter } from "./geld.js";

/** Liefert die Client-IP fuer Rate-Limiting und Audit-Eintraege.
 *  Wichtig: nur die ERSTE IP aus x-forwarded-for verwenden — sonst kann
 *  ein Angreifer durch wechselnde XFF-Header pro Request einen anderen
 *  Bucket-Key erzeugen und das Rate-Limit umgehen. */
function getClientIp(c: { req: { header(name: string): string | undefined } }): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0]!.trim();
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

/** Liefert IP + User-Agent fuer Audit-Eintraege aus Request-Headern.
 *  Trim auf 256 Zeichen, damit ein 8 KB User-Agent die Tabelle nicht
 *  unnoetig aufblaeht. */
function reqMeta(c: { req: { header(name: string): string | undefined } }): { ip: string; userAgent: string } {
  const ua = (c.req.header("user-agent") ?? "").slice(0, 256);
  return { ip: getClientIp(c), userAgent: ua };
}

// Routes
import { dashboardRoutes } from "./routes/dashboard.js";
import { notesRoutes } from "./routes/notes.js";
import { tasksRoutes } from "./routes/tasks.js";
import { termineRoutes } from "./routes/termine.js";
import { projectsRoutes } from "./routes/projects.js";
import { searchRoutes } from "./routes/search.js";
import { filesRoutes } from "./routes/files.js";
import { teamRoutes } from "./routes/team.js";
import { companiesRoutes } from "./routes/companies.js";
import { bautagebuchRoutes } from "./routes/bautagebuch.js";
import { meetingsRoutes } from "./routes/meetings.js";
import { timeEntriesRoutes } from "./routes/time-entries.js";
import { phasesRoutes } from "./routes/phases.js";
import { invoicesRoutes } from "./routes/invoices.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { eventsRoutes } from "./routes/events.js";
import { settingsRoutes } from "./routes/settings.js";
import { adminUsersRoutes } from "./routes/admin-users.js";
import { brandingRoutes, publicBrandingRoutes } from "./routes/branding.js";
import { templatesRoutes } from "./routes/templates.js";
import { exportTemplatesRoutes } from "./routes/export-templates.js";
import { projectModulesRoutes } from "./routes/project-modules.js";
import { uiPreferencesRoutes } from "./routes/ui-preferences.js";
// Old TOTP-Routes (auth2faRoutes): durch Email-2FA in Migration 020
// abgeloest. Endpoints werden nicht mehr exposed, damit nicht parallel
// zwei 2FA-Mechanismen laufen koennen. Datei bleibt im Code als Recovery-
// Pfad, falls die Email-2FA gar nicht zugestellt werden kann (manueller
// Re-Enable durch Admin via direktem DB-Patch).

// Exportiert fuer Integrationstests (Hono `app.request()` gegen die echte
// Middleware-/Routen-Kette). `startApi()` startet den HTTP-Server separat.
export const app = new Hono<AppEnv>();

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

// ── Zentrale Fehlerbehandlung ────────────────────────────────────────────────
// Ohne diesen Handler beantwortet Hono jeden Wurf aus einer Route mit einem
// nackten "Internal Server Error" als text/plain. Das Frontend erwartet
// ueberall JSON (`await res.json()`), zeigt dem Nutzer also einen
// JSON-Parse-Fehler statt einer Meldung — der eigentliche Fehler steht
// nirgends.
//
// Wichtig: Routen, die ihre Fehler selbst beantworten (c.json({error}, 4xx)),
// laufen hier NICHT durch — sie geben eine Response zurueck, statt zu werfen.
// Der Handler greift nur bei unbehandelten Wuerfen. Eine bereits fertige
// Antwort (HTTPException, z.B. aus Hono-Middleware) wird unveraendert
// durchgereicht.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();

  const code = (err as NodeJS.ErrnoException).code ?? "";

  // Kaputter JSON-Body: rund die Haelfte der Routen ruft `await c.req.json()`
  // ohne eigenes try/catch. Das ist ein Client-Fehler, kein Serverfehler.
  if (err instanceof SyntaxError) {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }

  // Jemand anderes hat in der Zwischenzeit gespeichert (Migration 042).
  // Die Uebersetzung steht bewusst HIER und nicht in den neun Routen: so
  // koennen sie ihre Signatur behalten, und es gibt genau eine Stelle, an der
  // aus dem Konflikt ein HTTP-Status wird.
  //
  // 409 samt aktuellem Stand — die Oberflaeche kann damit zeigen, was sich
  // geaendert hat, statt den Benutzer ins Leere laufen zu lassen.
  if (err instanceof KonfliktFehler) {
    return c.json(
      {
        error: err.message,
        konflikt: true,
        aktuell: err.aktuell,
        erwarteteRev: err.erwartet,
        aktuelleRev: err.tatsaechlich,
      },
      409,
    );
  }

  // Postgres-SQLSTATEs, die eine sinnvolle Antwort erlauben:
  //   57014 = abgebrochen durch statement_timeout (z.B. eine zu teure Suche)
  //   53300 = zu viele Verbindungen
  if (code === "57014") {
    logError(`[API] Abfrage abgebrochen (Timeout) — ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Die Anfrage hat zu lange gedauert. Bitte den Umfang eingrenzen." }, 503);
  }
  // 22P02 = invalid_text_representation. Tritt auf, sobald ein Pfadsegment
  // als UUID interpretiert wird, aber keine ist ("/api/tasks/keine-uuid").
  // Das ist eine unbrauchbare Anfrage, kein Serverfehler — vorher kam ein
  // nackter 500, was in jedem Monitoring wie ein Ausfall aussieht.
  if (code === "22P02") {
    return c.json({ error: "Ungueltige ID im Pfad." }, 400);
  }
  if (code === "53300" || code === "ECONNREFUSED") {
    logError(`[API] Datenbank nicht erreichbar — ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Datenbank derzeit nicht erreichbar. Bitte kurz warten." }, 503);
  }

  // Dateizugriff (Uploads, Exporte, Vorlagen).
  if (code === "EACCES" || code === "EPERM") {
    logError(`[API] Kein Dateizugriff — ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Kein Zugriff auf die Datei bzw. den Ordner." }, 403);
  }
  if (code === "ENOSPC") {
    logError(`[API] Kein Speicherplatz — ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: "Kein Speicherplatz mehr auf dem Server." }, 507);
  }

  logError(`[API] ${c.req.method} ${c.req.path}`, err);
  return c.json({ error: "Interner Fehler — Details stehen im Log." }, 500);
});

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()) : undefined;

app.use("*", secureHeaders());

// SEC-5: Content-Security-Policy. Bewusst im REPORT-ONLY-Modus — meldet
// Verstoesse (Browser-Console), blockiert aber nichts, damit die SPA nicht
// bricht. Nach Beobachtung auf enforce umstellen: Header-Name in
// "Content-Security-Policy" aendern. style-src braucht 'unsafe-inline'
// (Vue-Scoped-Styles); Scripts laufen als gebuendelte Chunks (kein inline).
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");
app.use("*", async (c, next) => {
  c.header("Content-Security-Policy-Report-Only", CSP_POLICY);
  await next();
});

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
// Reicht fuer Single-Instance-Deployments (PATIO laeuft auf einer VM).
// Bei Multi-Instance muesste das auf Redis o.ae. wandern — aktuell nicht
// relevant.
const apiBuckets = new Map<string, { count: number; resetAt: number }>();

app.use("/api/*", async (c, next) => {
  // Health-Endpunkt ist oben schon abgehandelt — kommt hier nicht mehr an.
  const ip = getClientIp(c);
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
  if (Math.random() < 0.01) {
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
  const ip = getClientIp(c);
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

  // ── Ein Faktor: Benutzername + Passwort ─────────────────────────────────
  // Hier stand bis zum Umbau auf den Firmenserver der Email-2FA-Pfad
  // (Migration 020). Er verschickte 6-stellige Codes ueber SMTP und war damit
  // auf einem Server ohne Internet nicht anwendbar: JEDER Datenbank-Benutzer
  // landete entweder im Mailversand (der scheiterte → 502) oder im erzwungenen
  // Email-Einrichtungs-Fluss (der ebenfalls SMTP braucht). Der einzige Weg
  // hinein war das einstufige Legacy-JSON-Konto — auf einem Firmenserver
  // genau das falsche Ergebnis.
  //
  // Der zweite Faktor kommt zurueck, sobald es einen Weg von aussen gibt:
  // src/api/totp.ts und routes/auth-2fa.ts liegen dafuer unberuehrt bereit.
  // Solange nur das Bueronetz Zugang hat, traegt Passwort + Ratebremse.
  const token = createToken(username, role, userId);
  void audit({
    event: "login.success",
    actorUserId: userId ?? null,
    actorUsername: username,
    actorRole: role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { step: dbUser ? "password" : "password-legacy-json" },
  });
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
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return c.json({ error: `Passwort muss mindestens ${PASSWORD_MIN_LENGTH} Zeichen haben` }, 400);
  }
  // Email optional — siehe POST /admin/users. Der erste Admin muss anlegbar
  // sein, ohne dass irgendwo ein Postfach erreichbar ist.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Ungueltige Email-Adresse" }, 400);
  }

  const admin = await createInitialAdmin(username, password, email || undefined);
  const token = createToken(admin.username, admin.role, admin.id);
  return c.json({ token, username: admin.username, role: admin.role, id: admin.id }, 201);
});

// ── Branding-Logo PUBLIC ────────────────────────────────────────────────────
// GET /api/branding/logo liefert das Firmen-Logo als image/* aus. Public
// damit <img>-Tags ohne Auth-Header laden (Login-Page, PDF-Generator,
// externe Vorschau). Inhalt ist nicht sensibel.
app.route("/api", publicBrandingRoutes);

// ── Auth-Middleware für alle /api/* Routes ────────────────────────────────────
app.use("/api/*", authMiddleware);

// ── Geld-Recht ───────────────────────────────────────────────────────────────
// Direkt hinter der Anmeldung, VOR allen Routen: der Filter arbeitet auf dem
// Rueckweg und raeumt Betraege aus jeder JSON-Antwort, solange der Aufrufer
// das Recht nicht hat (src/api/geld.ts).
//
// Bewusst hier und nicht in den einzelnen Routen: Betraege kommen an neun
// Stellen heraus (Rechnungen, Portfolio, Cockpit, Stunden, Team, Phasen,
// Suche, Live-Kanal, Export). Neun Pruefungen sind neun Gelegenheiten, es beim
// naechsten neuen Endpunkt zu vergessen — hier ist eine neue Route von sich
// aus dicht.
app.use("/api/*", geldFilter);

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
      // Die Oberflaeche blendet Geldspalten aus, statt leere Zellen zu zeigen
      // — der Antwort-Filter entfernt die Felder, nicht die Tabelle.
      canSeeMoney: dbUser.role === "admin" || dbUser.canSeeMoney,
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
app.route("/api", searchRoutes);
app.route("/api", filesRoutes);
app.route("/api", teamRoutes);
app.route("/api", companiesRoutes);
app.route("/api", bautagebuchRoutes);
app.route("/api", meetingsRoutes);
app.route("/api", timeEntriesRoutes);
app.route("/api", phasesRoutes);
app.route("/api", invoicesRoutes);
app.route("/api", portfolioRoutes);
app.route("/api", adminUsersRoutes);
app.route("/api", eventsRoutes);
app.route("/api", settingsRoutes);
app.route("/api", brandingRoutes);
app.route("/api", templatesRoutes);
app.route("/api", exportTemplatesRoutes);
app.route("/api", projectModulesRoutes);
app.route("/api", uiPreferencesRoutes);
// app.route("/api", auth2faRoutes); — siehe Kommentar oben

// Unbekannte API-Pfade: JSON-404 statt der Vue-App. Ohne das faellt ein
// vertippter oder veralteter API-Aufruf in den SPA-Fallback darunter und
// bekommt HTML mit Status 200 — ein Client, der JSON erwartet, scheitert dann
// am Parsen statt am Statuscode. Muss VOR serveStatic stehen.
app.all("/api/*", (c) => c.json({ error: "Unbekannter Endpunkt." }, 404));

// ── Statische Dateien (Vue SPA in Production) ────────────────────────────────
app.use("/*", serveStatic({ root: "./dist/web" }));

// SPA Fallback: alle nicht-API Routes → index.html
app.get("/*", serveStatic({ root: "./dist/web", path: "index.html" }));

// ── Server starten ───────────────────────────────────────────────────────────
export function startApi(): void {
  if (IS_PRODUCTION && !JWT_SECRET_OK) {
    throw new Error(
      "JWT_SECRET ist zu kurz oder nicht gesetzt. Mindestens 32 Zeichen erforderlich. " +
        "Setze JWT_SECRET in der .env-Datei.",
    );
  }
  serve({ fetch: app.fetch, port: API_PORT }, () => {
    logInfo(`[API] Web-Server gestartet auf http://0.0.0.0:${API_PORT}`);
  });
}
