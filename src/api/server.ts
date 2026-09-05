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
    userRole: Rolle;
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
  loadUsers,
  verifyPassword,
  createToken,
  findDbUserByUsername,
  countDbUsers,
  createInitialAdmin,
} from "./auth.js";
import { checkDbHealth } from "../db/client.js";
import { logEvent as audit } from "../data/db-audit.js";
import { KonfliktFehler } from "../data/konflikt.js";
import { geldFilter } from "./geld.js";
import { personendatenFilter, schreibschutz } from "./personendaten.js";
import type { Rolle } from "../data/access.js";

/** Liefert die Client-IP fuer Rate-Limiting und Audit-Eintraege.
 *
 *  ACHTUNG — dieser Wert ist nur so vertrauenswuerdig wie der Proxy davor.
 *  Der Dienst nimmt `x-forwarded-for` UNGEPRUEFT: setzt man den Header
 *  direkt gegen ihn, landet der erfundene Wert in der Ratebremse und im
 *  Pruefprotokoll (nachgemessen am 29.08.2026: ein Aufruf aus dem
 *  App-Container mit `X-Forwarded-For: 7.7.7.7` erzeugte einen
 *  `login.fail`-Eintrag mit genau dieser IP).
 *
 *  Dass eine Faelschung von aussen nicht durchkommt, leistet allein Caddy:
 *  es ERSETZT den Header, statt die echte Adresse anzuhaengen (gemessen mit
 *  Caddy v2.11.4 — ein Aufruf mit `X-Forwarded-For: 9.9.9.9` kam als
 *  172.20.0.1 an, und die Login-Bremse griff beim zweiten Versuch mit 429).
 *
 *  Daraus folgt die Betriebsregel: Der App-Container darf NIE ein `ports:`
 *  bekommen. `docker-compose.yml` haelt das ausdruecklich so. Wer den Dienst
 *  direkt erreichbar macht oder einen anderen Proxy davorsetzt, verliert die
 *  Ratebremse und die Aussagekraft des Protokolls — lautlos.
 *
 *  Die erste IP zu nehmen ist bei genau einem ersetzenden Proxy richtig.
 *  Kaeme je ein zweiter dazu, waere der rechteste Eintrag der richtige. */
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
import { entscheidungenRoutes } from "./routes/entscheidungen.js";
import { positionskatalogRoutes } from "./routes/positionskatalog.js";
import { aktivitaetRoutes } from "./routes/aktivitaet.js";
import { aufgabensystemRoutes } from "./routes/aufgabensystem.js";
import { benachrichtigungenRoutes } from "./routes/benachrichtigungen.js";
import { boardRoutes } from "./routes/board.js";
import { kiFreigabeRoutes } from "./routes/ki-freigabe.js";
import { sicherungRoutes } from "./routes/sicherung.js";
import { papierkorbRoutes } from "./routes/papierkorb.js";
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
// TOTP-Routen (auth2faRoutes) sind NICHT eingehaengt — siehe die Begruendung
// weiter unten bei der Anmeldung.
//
// Hier stand, sie seien "durch Email-2FA abgeloest" und blieben als
// Recovery-Pfad liegen. Beides stimmt seit dem Umbau zum Firmenserver nicht
// mehr: der E-Mail-Zweig ist ersatzlos entfallen (er brauchte SMTP, das es
// ohne Internet nicht gibt), und einen Wiedereinstieg ueber ihn gibt es
// folglich auch nicht. Wer den Kommentar las, hielt einen manuellen
// Recovery-Weg fuer moeglich, den es nicht gibt.
//
// Richtig ist: der zweite Faktor kommt mit dem Zugang von aussen zurueck
// (AP17). Bis dahin liegt der Zweig unberuehrt im Baum.

// Exportiert fuer Integrationstests (Hono `app.request()` gegen die echte
// Middleware-/Routen-Kette). `startApi()` startet den HTTP-Server separat.
export const app = new Hono<AppEnv>();

// ── Health-Check (ohne Auth, ohne Rate-Limit) ────────────────────────────────
// Liveness-Probe fuer Reverse-Proxy / Uptime-Monitoring. Liefert minimale
// Information — KEINE Versionen, Build-Hashes oder DB-Zugaenge, weil der
// Endpunkt anonym erreichbar ist.
//
// ── Warum hier wirklich die Datenbank gefragt wird ──────────────────────────
//
// Bis zum 30.08.2026 stand hier `db: DB_ENABLED` — und das sagt nur, ob
// `DATABASE_URL` GESETZT ist. Der Endpunkt konnte damit per Konstruktion nur
// 200 liefern; das `-f` im HEALTHCHECK des Dockerfiles war wirkungslos, und
// ein Postgres, das im laufenden Betrieb ausfaellt, blieb unsichtbar:
// Container `healthy`, `patio status` meldet „Der Dienst antwortet", und
// `update-offline.sh` bewertete ein Update als gelungen — waehrend jeder
// Datenzugriff einen 500er lieferte.
//
// Gefragt wird mit Zwischenspeicher: mehrere Aufrufer klopfen gleichzeitig an
// (Docker-Healthcheck, Monitoring, `patio status`, das Arbeitsplatz-Programm).
// Fuenf Sekunden buendeln diese Anfragen zu EINEM Ping, ohne dass ein Ausfall
// laenger als einen Healthcheck-Takt unentdeckt bliebe.
//
// ── Warum der Ping ein eigenes Zeitlimit braucht ────────────────────────────
//
// `checkDbHealth()` hat keines. `connect_timeout` in src/db/client.ts deckt
// allein den VERBINDUNGSAUFBAU ab; sind alle Poolverbindungen belegt (ein
// Volldump, ein paar parallele Berichte), landet die Abfrage im Backlog und
// wartet dort unbegrenzt.
//
// Ohne Grenze haette das den Health-Endpunkt von einer Auskunft in eine
// Haengepartie verwandelt — und zwar an Stellen, die alle KEIN eigenes Limit
// mitbringen: der HEALTHCHECK im Dockerfile bricht nach 5 s ab und meldete
// einen gesunden Dienst als krank; `patio status`, die Warteschleife von
// `update-offline.sh` und der Prueflauf des Arbeitsplatz-Programms rufen
// `curl` bzw. `net.request` ohne `--max-time`.
//
// Drei Sekunden sind reichlich fuer ein `SELECT 1` und liegen sicher unter
// allen genannten Grenzen. Laeuft die Zeit ab, gilt die Datenbank als NICHT
// erreichbar — was sie aus Sicht eines wartenden Nutzers auch ist.
const startedAt = Date.now();
const DB_PING_CACHE_MS = 5_000;
const DB_PING_TIMEOUT_MS = 3_000;
let dbPingStand = { zeitpunkt: 0, ok: false };

async function dbErreichbar(): Promise<boolean> {
  if (!DB_ENABLED) return false;
  if (Date.now() - dbPingStand.zeitpunkt < DB_PING_CACHE_MS) return dbPingStand.ok;

  let uhr: NodeJS.Timeout | undefined;
  const ok = await Promise.race([
    checkDbHealth(),
    new Promise<boolean>((loese) => {
      uhr = setTimeout(() => loese(false), DB_PING_TIMEOUT_MS);
    }),
  ]);
  if (uhr) clearTimeout(uhr);

  // Der Zeitstempel wird NACH dem Ping gesetzt, nicht davor: sonst waere ein
  // Eintrag, dessen Ping laenger gedauert hat als die Cache-Zeit, beim
  // Schreiben schon abgelaufen — und jeder Folgeaufruf zahlte den vollen
  // Zeitablauf erneut, genau dann, wenn die Datenbank ohnehin schwaechelt.
  dbPingStand = { zeitpunkt: Date.now(), ok };
  return ok;
}

app.get("/api/health", async (c) => {
  const db = await dbErreichbar();
  // 503 statt 200, wenn die Datenbank weg ist: erst damit hat der
  // HEALTHCHECK etwas zu melden und der Update-Rueckweg etwas zu erkennen.
  return c.json(
    {
      ok: db,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      db,
    },
    db ? 200 : 503,
  );
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

  // 23505 = unique_violation. Zwei Arbeitsplaetze speichern gleichzeitig
  // dieselbe eindeutige Angabe — das ist ein Konflikt, kein Serverfehler.
  //
  // Die Repos pruefen vorher, ob der Wert frei ist, und fangen den Wettlauf im
  // INSERT ab. Der Schreibpfad von `projectRepo.update()` geht aber ueber
  // `db.unsafe()` mit dynamisch gebautem SET und hat keinen eigenen Rueckfall;
  // dort wurde daraus bisher „Interner Fehler". Hier steht die letzte
  // Auffanglinie fuer alle eindeutigen Spalten des Hauses — heute der
  // Projektname (Migration 006) und die Projektnummer (052).
  if (code === "23505") {
    const bedingung = String((err as { constraint_name?: string }).constraint_name ?? "");
    const text = bedingung.includes("projektnummer")
      ? "Diese Projektnummer ist bereits vergeben"
      : bedingung.includes("projects_name_unique")
        ? "Ein Projekt mit diesem Namen existiert bereits"
        : "Dieser Wert ist bereits vergeben";
    // Bewusst OHNE Nennung des Datensatzes, der den Wert traegt: das waere
    // eine Auskunft ueber etwas, das der Fragende womoeglich nicht sehen darf.
    return c.json({ error: text }, 409);
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

// ── SEC-5: Content-Security-Policy — ERZWINGEND ─────────────────────────────
//
// Die Richtlinie stand lange unter dem Header `Content-Security-Policy-
// Report-Only`: der Browser meldete Verstoesse in der Konsole und blockierte
// nichts. Das war als Beobachtungsphase gedacht und hat als solche zu lange
// gedauert — eine Richtlinie, die nichts blockiert, ist keine Massnahme,
// sondern eine Notiz.
//
// Sie ist jetzt scharf. Das ist auch der Punkt, an dem die Offline-Zusage
// aufhoert, reine Code-Disziplin zu sein: `default-src 'self'` und
// `connect-src 'self'` machen aus „wir laden nichts von aussen nach" eine
// Regel, die der Browser durchsetzt, statt eine, die beim naechsten
// eingefuegten Schnipsel bricht.
//
// `style-src` braucht 'unsafe-inline' — Vue setzt Scoped-Styles zur Laufzeit;
// Skripte laufen dagegen ausschliesslich als gebuendelte Chunks.
const CSP_APP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// ── Warum die Dokumentation eine eigene Richtlinie bekommt ──────────────────
//
// Die gebaute VitePress-Seite unter /docs/ enthaelt drei INLINE-Skripte
// (Hell/Dunkel-Umschaltung, Plattform-Erkennung). Unter `script-src 'self'`
// wuerden sie blockiert, und die Doku-Seite kaeme im falschen Farbschema oder
// gar nicht richtig hoch.
//
// Statt der ganzen Anwendung 'unsafe-inline' fuer Skripte zu geben — was die
// strenge Richtlinie entwertet — bekommt nur /docs/ eine eigene. Der
// entscheidende Teil bleibt auch dort scharf: `default-src 'self'` und
// `connect-src 'self'`. Die Dokumentation ist statischer Text ohne
// Benutzerdaten; was dort zaehlt, ist, dass sie nichts von aussen nachlaedt.
const CSP_DOCS = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use("*", async (c, next) => {
  c.header("Content-Security-Policy", c.req.path.startsWith("/docs/") ? CSP_DOCS : CSP_APP);
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
// damit normales UI-Browsing nie limitiert wird. Der LOGIN hat zusaetzlich
// eine eigene, engere Bremse (`loginAttempts` weiter unten). Der
// Einrichtungsassistent hat KEINE eigene — er faellt nach dem ersten Konto
// ohnehin mit 410 zu.
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

  // Ausschliesslich gegen die Datenbank. Der frueher hier stehende Rueckfall
  // auf `data/users.json` ist entfallen — er war kein Sicherheitsnetz, sondern
  // ein zweiter Weg zum selben Konto, und einer, der die Rechte umging: eine
  // JSON-Anmeldung hatte keine UUID, und ohne die liefert
  // `getVisibleProjectIds()` fuer Nicht-Admins eine leere Liste.
  //
  // Bestehende JSON-Konten gehen beim Start in die Datenbank ueber
  // (`importLegacyJsonUsers()` in src/index.ts), bevor die erste Anfrage
  // angenommen wird.
  const dbUser = await findDbUserByUsername(usernameInput);

  const pwHash = dbUser?.passwordHash;
  const username = dbUser?.username;
  const role = dbUser?.role;
  const userId = dbUser?.id;

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
    details: { step: "password" },
  });
  return c.json({ token, username, role });
});

// ── Setup-Wizard (ohne Auth) ────────────────────────────────────────────────
// Ist noch kein Konto vorhanden, legt der erste Aufruf einen Admin ueber ein
// Web-Formular an. Sobald irgendeines existiert, kommt 410 — danach laeuft
// alles ueber die Anmeldung bzw. /admin/users.
//
// Gezaehlt werden weiterhin auch die Konten in `data/users.json`: sie gehen
// beim Start in die Datenbank ueber, und waehrend eines Umstiegs von einer
// alten Installation soll der Wizard nicht faelschlich erscheinen.

app.get("/api/setup/status", async (c) => {
  const userCount = await countDbUsers();
  const jsonCount = loadUsers().length;
  return c.json({
    needsSetup: userCount === 0 && jsonCount === 0,
    dbEnabled: true,
  });
});

app.post("/api/setup/admin", async (c) => {
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

// ── Praesentationsrolle: Schreibschutz und Personendaten ─────────────────────
//
// Der Schreibschutz steht VOR allen Routen: es gibt 94 schreibende Endpunkte,
// und jeden einzeln zu bewachen heisst, den 95. zu vergessen — genau so sind
// die siebzehn Rechte-Luecken entstanden, die im August geschlossen wurden.
//
// Der Personendaten-Filter arbeitet wie der Geld-Filter auf dem Rueckweg:
// `GET /api/team` liefert sonst jedem angemeldeten Konto E-Mail und
// Telefonnummer aller Mitglieder. Im Buero richtig, im Besprechungsraum nicht
// — dort sitzen auch Bauherren.
app.use("/api/*", schreibschutz);
app.use("/api/*", personendatenFilter);

// ── Auth-Check ───────────────────────────────────────────────────────────────
// Liefert minimales Profil fuer die Web-UI (Avatar, Begruessung, Settings).
// displayName kommt aus user.settings.displayName — falls nicht gesetzt,
// faellt die UI auf den Username zurueck.
app.get("/api/auth/me", (c) => {
  const dbUser = c.get("dbUser") as DbUser | null;
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
  // Kein Datenbank-Konto zu einem gueltigen Token: das Konto wurde
  // geloescht, waehrend die Sitzung noch lief. Frueher fiel die Antwort hier
  // auf einen JSON-Eintrag zurueck; den gibt es nicht mehr.
  return c.json({ error: "Konto nicht gefunden" }, 401);
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
app.route("/api", entscheidungenRoutes);
app.route("/api", positionskatalogRoutes);
app.route("/api", aktivitaetRoutes);
app.route("/api", aufgabensystemRoutes);
app.route("/api", benachrichtigungenRoutes);
app.route("/api", boardRoutes);
app.route("/api", kiFreigabeRoutes);
app.route("/api", sicherungRoutes);
app.route("/api", papierkorbRoutes);
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

// ── Offline-Dokumentation ────────────────────────────────────────────────────
// Die gebaute VitePress-Seite (npm run docs:build → dist/docs). Aufgerufen wird
// sie ueber "Hilfe → Dokumentation" (F1) im Arbeitsplatz-Programm.
//
// `root: "./dist"` und nicht `"./dist/docs"`: serveStatic haengt den ANFRAGEPFAD
// an die Wurzel, aus /docs/index.html wuerde sonst ./dist/docs/docs/index.html.
//
// Muss VOR dem SPA-Fallback stehen — der beantwortet sonst jeden Doku-Pfad mit
// der Vue-Oberflaeche.
//
// Bewusst OEFFENTLICH: die Route liegt vor der Auth-Middleware, die nur auf
// /api/* greift. Die Betriebsdoku enthaelt keine Geheimnisse, und das Netz ist
// geschlossen. Sollte das je stoeren, kommt sie hinter die Middleware.
app.use("/docs/*", serveStatic({ root: "./dist" }));
// Eine Doku-Seite, die es nicht gibt, ist ein 404 — ohne diese Zeile faellt sie
// in den SPA-Fallback und der Benutzer bekommt kommentarlos die Anwendung.
app.all("/docs/*", (c) => c.text("Diese Seite der Dokumentation gibt es nicht.", 404));

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
