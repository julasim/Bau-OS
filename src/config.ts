import "dotenv/config";
import path from "path";

// ── LLM ──────────────────────────────────────────────────────────────────────
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const OPENAI_ENABLED = !!OPENAI_API_KEY;

// Falls OPENAI_API_KEY gesetzt: direkt OpenAI, sonst Ollama
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
const _defaultModel = OPENAI_ENABLED ? "gpt-4o-mini" : "qwen2.5:7b";
export const DEFAULT_MODEL = process.env.OLLAMA_MODEL || _defaultModel;
export const FAST_MODEL = process.env.OLLAMA_FAST_MODEL || DEFAULT_MODEL;
export const SUBAGENT_MODEL = process.env.OLLAMA_SUBAGENT_MODEL || DEFAULT_MODEL;
export const VISION_MODEL = process.env.VISION_MODEL || (OPENAI_ENABLED ? "gpt-4o" : DEFAULT_MODEL);
// Max. Iterationen im Agentic Loop. Semantik: aus User-Sicht ist EINE
// Benutzer-Nachricht = EINE Anfrage, egal wie viele Tool-Calls der Agent
// intern braucht. Der Loop zaehlt aber pro LLM-Iteration — kleine Ollama-
// Modelle feuern Tool-Calls oft sequenziell statt parallel, dann zaehlt
// jedes einzeln. Deshalb hier sehr hoch ansetzen (faktisch unlimitiert fuer
// normale Bulk-Anfragen), nur als Sicherheitsnetz gegen echte Endlos-Loops.
export const MAX_TOOL_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS) || 100;

// ── Agenten ───────────────────────────────────────────────────────────────────
export const AGENTS = [
  { name: "Main", model: DEFAULT_MODEL, protected: true, description: "Haupt-Agent" },
  // { name: "Kalkulator", model: DEFAULT_MODEL, protected: false, description: "Kalkulations-Agent (ÖNORM)" },
];

export const PROTECTED_AGENTS = AGENTS.filter((a) => a.protected).map((a) => a.name);

// Runtime-Override fuer das Main-Modell. Wird durch client.ts#setModel gesetzt
// (Web-UI "Setzen" / Fast-Mode-Toggle). Hier statt in client.ts, damit
// getAgentModel() den Override lesen kann ohne Zirkular-Import.
let _runtimeMainModel: string | null = null;
export function setRuntimeMainModel(name: string | null): void {
  _runtimeMainModel = name && name.trim() ? name.trim() : null;
}
export function getRuntimeMainModel(): string | null {
  return _runtimeMainModel;
}

export const getAgentModel = (name: string): string => {
  // Main-Agent respektiert den Runtime-Override (Web-UI + Fast-Mode).
  // Alle anderen Agents nutzen ihr in AGENTS deklariertes Modell.
  if (name === "Main" && _runtimeMainModel) return _runtimeMainModel;
  return AGENTS.find((a) => a.name === name)?.model ?? DEFAULT_MODEL;
};
export const MAX_SPAWN_DEPTH = 2; // Sub-Agents können keine weiteren spawnen

// ── Gedächtnis ────────────────────────────────────────────────────────────────
export const MAX_HISTORY_CHARS = 60_000; // Pruning-Grenze für den Message-Buffer
export const COMPACT_THRESHOLD = 8_000; // Tageslog: ab hier wird komprimiert
export const KEEP_RECENT_LOGS = 5; // Letzte N Log-Einträge bleiben immer erhalten
export const HISTORY_LOAD_LIMIT = 10; // Gesprächseinträge die beim Start geladen werden

// ── Workspace ────────────────────────────────────────────────────────────────
export const WORKSPACE_PATH = (process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH)!;
export const WORKSPACE_INBOX = "Inbox";
export const WORKSPACE_AGENTS_DIR = "Agents";
export const WORKSPACE_LOGS_DIR = "MEMORY_LOGS";
export const agentsPath = () => path.join(WORKSPACE_PATH, WORKSPACE_AGENTS_DIR);
export const agentPath = (name: string) => path.join(agentsPath(), name);
export const logsPath = (name: string) => path.join(agentPath(name), WORKSPACE_LOGS_DIR);

// ── System ────────────────────────────────────────────────────────────────────
export const TIMEZONE = "Europe/Vienna";
export const LOCALE = "de-AT";
export const LANGUAGE = "Deutsch";
export const CHAT_ID_FILE = path.join(process.cwd(), ".chat_id");
export const LOG_FILE = path.join(process.cwd(), "logs", "bot.log");

// ── Telegram-Zugriffskontrolle ───────────────────────────────────────────────
// Kommagetrennte Chat-IDs in ALLOWED_CHAT_IDS — leer bedeutet kein Schutz.
// Beispiel: ALLOWED_CHAT_IDS=123456789,987654321
const _allowedRaw = process.env.ALLOWED_CHAT_IDS ?? "";
export const ALLOWED_CHAT_IDS: Set<number> = _allowedRaw.trim()
  ? new Set(
      _allowedRaw
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n)),
    )
  : new Set();

// ── Dynamische Tools ─────────────────────────────────────────────────────────
export const TOOLS_DIR = path.join(process.cwd(), "tools");

// ── Timeouts (ms) ────────────────────────────────────────────────────────────
export const TYPING_INTERVAL_MS = 4_000; // Telegram-Typing-Indikator
export const FETCH_TIMEOUT_MS = 30_000; // Web-Fetch Timeout
export const VM_TIMEOUT_MS = 10_000; // code_ausfuehren Sandbox
export const HTTP_REQUEST_TIMEOUT_MS = 15_000; // http_anfrage Tool
export const DYNAMIC_TOOL_TIMEOUT_MS = 30_000; // Dynamische Tools (run.js/run.sh)
export const COMMAND_TIMEOUT_SEC = 15; // befehl_ausfuehren Default
export const COMMAND_TIMEOUT_MAX_SEC = 60; // befehl_ausfuehren Maximum

// ── Output-Limits (Zeichen) ──────────────────────────────────────────────────
export const TOOL_OUTPUT_MAX_CHARS = 8_000; // Tool-Output Truncation (executor, tools, mcp)
export const HTTP_RESPONSE_MAX_CHARS = 6_000; // http_anfrage Truncation
export const CODE_OUTPUT_MAX_CHARS = 4_000; // code_ausfuehren Truncation
export const MESSAGE_PREVIEW_LENGTH = 80; // Log-Preview von User-Nachrichten
export const COMMAND_BUFFER_SIZE = 1024 * 1024; // exec() maxBuffer (1 MB)

// ── Web-Suche ────────────────────────────────────────────────────────────────
export const MAX_RESPONSE_BYTES = 5_000_000; // fetchPage max Download
export const WEB_CACHE_TTL_MS = 15 * 60 * 1000; // 15 Minuten
export const WEB_CACHE_MAX = 200; // Max Cache-Eintraege
export const WEB_MAX_RETRIES = 2;

// ── Datei-Suche ──────────────────────────────────────────────────────────────
export const MAX_FILE_SCAN = 1_000; // Max Dateien bei walkDir
export const SEARCH_MAX_RESULTS = 10; // searchWorkspace Ergebnisse
export const SEARCH_LINE_MAX = 100; // searchWorkspace Zeilen-Laenge

// ── Agent-Workspace ──────────────────────────────────────────────────────────
export const WS_MAX_FILE_CHARS = 20_000; // Max Zeichen pro Workspace-Datei
export const WS_MAX_TOTAL_CHARS = 150_000; // Max Zeichen gesamt
export const KEPT_TOOL_MESSAGES = 8; // Tool-Messages beim Pruning behalten
export const TOOL_PRUNE_MAX_CHARS = 4_000; // Tool-Ergebnisse beim Pruning kuerzen

// ── Logging ──────────────────────────────────────────────────────────────────
export const MAX_LOG_LINES = 500; // bot.log Zeilen-Limit
export const LOG_DEFAULT_LINES = 20; // /logs Standard-Anzahl
export const LOG_MAX_DISPLAY_LINES = 50; // /logs Maximum
export const LOG_DISPLAY_MAX_CHARS = 3_800; // /logs Output-Limit

// JSONL-Log (maschinenlesbar, vollstaendig): groessenbasierte Rotation.
// Bei Ueberschreitung wird bot.jsonl → bot.jsonl.1, bot.jsonl.1 → .2 ...
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
// SEC-4: Eigener Schluessel fuer die Feld-Verschluesselung (Telegram-Bot-Token,
// TOTP-Secret, Microsoft-OAuth-Token), getrennt vom JWT_SECRET. So reisst eine
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

// ── Microsoft Graph (Outlook-Calendar-Sync, Migration 022/023) ──────────────
// Werte aus deiner Azure App-Registrierung:
//   1. portal.azure.com → App-Registrierungen → "+ Neue Registrierung"
//   2. Redirect-URI: <APP_URL>/api/auth/microsoft/callback
//   3. API-Berechtigungen: Calendars.ReadWrite + User.Read + offline_access
//   4. Werte hier eintragen.
//
// Tenant-ID: konkrete Tenant-UUID fuer Single-Tenant-Apps. "common" fuer
// Multi-Tenant (jeder MS-User kann sich verbinden). Default "common".
export const MS_CLIENT_ID = process.env.MS_CLIENT_ID || "";
export const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || "";
export const MS_TENANT_ID = process.env.MS_TENANT_ID || "common";
// Redirect-URI muss EXAKT mit dem Wert in Azure uebereinstimmen.
// Default leer → Backend baut sie aus APP_URL + dem Standard-Pfad.
export const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI || "";
export const MS_GRAPH_ENABLED = !!(MS_CLIENT_ID && MS_CLIENT_SECRET);

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
export const DATABASE_URL = process.env.DATABASE_URL || "";
export const DB_ENABLED = !!DATABASE_URL;
// Auto-Migrate beim Start. Default ON (Entwickler-freundlich), fuer Produktion
// mit Deploy-Pipelines per DB_AUTO_MIGRATE=false abschalten und Migrations
// explizit ueber "npm run migrate" fahren.
export const DB_AUTO_MIGRATE = (process.env.DB_AUTO_MIGRATE ?? "true").toLowerCase() !== "false";

// ── Embeddings ───────────────────────────────────────────────────────────────
const _defaultEmbeddingModel = OPENAI_ENABLED ? "text-embedding-3-small" : "nomic-embed-text";
const _defaultEmbeddingDims = OPENAI_ENABLED ? "1536" : "768";
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || _defaultEmbeddingModel;
export const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || _defaultEmbeddingDims, 10);
export const EMBEDDING_BATCH_SIZE = 5; // Parallele Embedding-Anfragen

// ── Upload-Limits ────────────────────────────────────────────────────────────
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? "50");
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// ── Dokument-Extraktion ──────────────────────────────────────────────────────
export const DAILY_NOTES_DIR = process.env.DAILY_NOTES_DIR || "Daily";
export const TEMPLATES_DIR = process.env.TEMPLATES_DIR || "Templates";
export const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || "Attachments";
export const EXTRACT_MAX_CHARS = 50_000; // Max Zeichen bei Dokument-Extraktion
