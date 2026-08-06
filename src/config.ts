import "dotenv/config";
import path from "path";

// ============================================================
// PATIO — zentrale Konfiguration
//
// Alle Tunables als Konstanten, ausgewertet beim ersten Import.
// Seit dem Umbau zum Firmenserver gilt: KEIN LLM, KEIN Telegram-Bot,
// KEIN Aussenkontakt im Betrieb. Die frueheren Bloecke fuer LLM-Modelle,
// Agenten, Tool-Timeouts, Web-Suche und Telegram-Zugriffskontrolle sind
// entfallen — der zugehoerige Code wurde in AP0 entfernt, die Konstanten
// hatten danach nachweislich keinen einzigen Konsumenten mehr.
// ============================================================

// ── Workspace ────────────────────────────────────────────────────────────────
// Nicht-null-Assertion ist hier bewusst: index.ts bricht den Boot ab, bevor
// irgendein Modul diesen Wert liest, wenn WORKSPACE_PATH fehlt.
export const WORKSPACE_PATH = (process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH)!;
// Altbestand aus der Bot-Aera: diese Ordner werden im Dateibrowser
// ausgeblendet, falls sie in einem gewachsenen Workspace noch herumliegen.
export const WORKSPACE_AGENTS_DIR = "Agents";
export const WORKSPACE_LOGS_DIR = "MEMORY_LOGS";

// ── System ────────────────────────────────────────────────────────────────────
export const TIMEZONE = "Europe/Vienna";
export const LOCALE = "de-AT";
export const LANGUAGE = "Deutsch";
// Hiess bis zum Umbau zum Firmenserver "bot.log" — den Telegram-Bot gibt es
// nicht mehr, der Name blieb stehen und war beim Suchen im Betrieb irrefuehrend.
export const LOG_FILE = path.join(process.cwd(), "logs", "patio.log");

// ── Logging ──────────────────────────────────────────────────────────────────
export const MAX_LOG_LINES = 500; // patio.log Zeilen-Limit

// JSONL-Log (maschinenlesbar, vollstaendig): groessenbasierte Rotation.
// Bei Ueberschreitung wird patio.jsonl → patio.jsonl.1, patio.jsonl.1 → .2 ...
// und das aelteste geloescht. Verhindert dass Disk volllaeuft auf
// Long-Running-Installationen. 5 MB * 5 Files = 25 MB max im Worst-Case.
export const LOG_JSONL_MAX_BYTES = parseInt(process.env.LOG_JSONL_MAX_BYTES || String(5 * 1024 * 1024), 10);
export const LOG_JSONL_KEEP_FILES = parseInt(process.env.LOG_JSONL_KEEP_FILES || "5", 10);

// ── Audit-Log Retention ────────────────────────────────────────────────────
// Wie lange Audit-Eintraege aufbewahrt werden (Tage). Default 365 — fuer
// Sicherheits-Forensik braucht man eher zu viel als zu wenig. Per Env
// kuerzer setzbar, falls die Tabelle bei extrem hohem Traffic wegen
// Login-Fail-Bombings zu gross wird.
// 0 = nie loeschen (manuelle Verwaltung).
export const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS || "365", 10);

// ── Passwoerter ──────────────────────────────────────────────────────────────
// Seit dem Umbau zum Firmenserver ist das Passwort der EINZIGE Faktor: der
// Email-Code-Zweig ist entfallen (er brauchte SMTP und war ohne Internet nicht
// zustellbar), TOTP kommt erst mit dem Zugang von aussen zurueck. Damit traegt
// diese Zahl mehr Gewicht als vorher — 8 Zeichen waren fuer einen zweiten
// Faktor daneben vertretbar, allein sind sie es nicht.
export const PASSWORD_MIN_LENGTH = 12;

// bcrypt-Kostenfaktor. Jede Stufe verdoppelt die Rechenzeit — 12 liegt auf
// heutiger Hardware bei rund 250 ms pro Pruefung. Das bremst das Anmelden
// nicht spuerbar, verteuert aber das Durchprobieren erbeuteter Hashes um das
// Vierfache gegenueber den vorherigen 10.
export const BCRYPT_ROUNDS = 12;

// ── Rate-Limiting ────────────────────────────────────────────────────────────
// Login-Throttle (per-IP, schuetzt vor Brute-Force gegen das Loginformular)
export const RATE_LIMIT_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Globaler API-Throttle (per-IP, schuetzt vor Scrapern und automatisierten
// Scans). Generoes genug, damit normales UI-Browsing nie limitiert wird —
// 600 Requests pro Minute = 10/sec, deckt Bursts beim Tab-Wechsel locker ab.
// Ueberschritten = 429 mit Retry-After-Header.
export const API_RATE_LIMIT_REQUESTS = parseInt(process.env.API_RATE_LIMIT_REQUESTS || "600", 10);
export const API_RATE_LIMIT_WINDOW_MS = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || "60000", 10);

// ── Web-API ──────────────────────────────────────────────────────────────────
export const API_PORT = parseInt(process.env.API_PORT || "3000", 10);
export const JWT_SECRET = process.env.JWT_SECRET || "";
export const USERS_FILE = path.join(process.cwd(), "data", "users.json");
export const API_ENABLED = !!JWT_SECRET;
// Production-Hardening: schwache JWT-Secrets ablehnen (mind. 32 Zeichen).
// Im Dev-Modus nur warnen, damit der lokale Schnellstart funktioniert.
export const JWT_SECRET_OK = JWT_SECRET.length >= 32;
// SEC-4: Eigener Schluessel fuer die Feld-Verschluesselung (TOTP-Secret,
// Microsoft-OAuth-Token), getrennt vom JWT_SECRET. So reisst eine
// JWT_SECRET-Rotation die verschluesselten Felder nicht mehr mit. Solange nicht
// gesetzt, faellt crypto.ts auf JWT_SECRET zurueck (Migrationsphase) — index.ts
// warnt beim Start. Prod sollte einen eigenen setzen (>=32 Zeichen).
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
export const ENCRYPTION_KEY_SET = ENCRYPTION_KEY.length > 0;
export const ENCRYPTION_KEY_OK = ENCRYPTION_KEY.length >= 32;
export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";

// Public-Base-URL fuer Links in Emails (Magic-Link, Password-Reset, Welcome).
// Default leer → Backend nimmt Host aus dem Request-Header (Reverse-Proxy
// muss Host korrekt forwarden). Setzbar via Env, falls die App hinter
// einem CDN sitzt oder die Public-URL anders ist als der Request-Host.
//   Beispiel: APP_URL=https://app.patio.at
export const APP_URL = process.env.APP_URL || "";

// ── SMTP / Mail (Migration 020 — Email-2FA) ─────────────────────────────────
// Wird fuer den Versand der Login-Codes via Email genutzt. Ohne SMTP_HOST
// sind 2FA-Mails deaktiviert — der Code wird dann ins Server-Log geschrieben
// (Dev-Modus). In Production verweigert der Boot wenn SMTP nicht konfiguriert
// und Users mit Email-Adresse existieren.
//
// Tested: Office365, Gmail (mit App-Password), Mailgun, eigene Postfix-Server.
// Default Port 587 mit STARTTLS, secure=true bei 465.
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const SMTP_FROM = process.env.SMTP_FROM || "PATIO <noreply@patio.local>";
export const SMTP_SECURE = (process.env.SMTP_SECURE ?? "auto").toLowerCase();
export const SMTP_ENABLED = !!SMTP_HOST;

// ── Datenbank (PostgreSQL) ───────────────────────────────────────────────────
// PFLICHT. PATIO laeuft ausschliesslich gegen PostgreSQL — einen
// Filesystem-Modus gibt es seit dem Umbau nicht mehr. index.ts bricht den
// Boot ab, wenn DATABASE_URL fehlt (siehe DB_ENABLED-Check dort).
export const DATABASE_URL = process.env.DATABASE_URL || "";
export const DB_ENABLED = !!DATABASE_URL;
// Auto-Migrate beim Start. Default ON (Entwickler-freundlich), fuer Produktion
// mit Deploy-Pipelines per DB_AUTO_MIGRATE=false abschalten und Migrations
// explizit ueber "npm run db:migrate" fahren.
export const DB_AUTO_MIGRATE = (process.env.DB_AUTO_MIGRATE ?? "true").toLowerCase() !== "false";

// ── Upload-Limits ────────────────────────────────────────────────────────────
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? "50");
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// ── Dokument-Extraktion ──────────────────────────────────────────────────────
export const EXTRACT_MAX_CHARS = 50_000; // Max Zeichen bei Dokument-Extraktion
