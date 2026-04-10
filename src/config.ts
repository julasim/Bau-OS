import "dotenv/config";
import path from "path";

// ── LLM ──────────────────────────────────────────────────────────────────────
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
export const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
export const FAST_MODEL = process.env.OLLAMA_FAST_MODEL || DEFAULT_MODEL;
export const SUBAGENT_MODEL = process.env.OLLAMA_SUBAGENT_MODEL || DEFAULT_MODEL;
export const MAX_TOOL_ROUNDS = 5; // Max. Iterationen im Agentic Loop

// ── Agenten ───────────────────────────────────────────────────────────────────
export const AGENTS = [
  { name: "Main", model: DEFAULT_MODEL, protected: true, description: "Haupt-Agent" },
  // { name: "Kalkulator", model: DEFAULT_MODEL, protected: false, description: "Kalkulations-Agent (ÖNORM)" },
];

export const PROTECTED_AGENTS = AGENTS.filter((a) => a.protected).map((a) => a.name);
export const getAgentModel = (name: string) => AGENTS.find((a) => a.name === name)?.model ?? DEFAULT_MODEL;
export const MAX_SPAWN_DEPTH = 2; // Sub-Agents können keine weiteren spawnen

// ── Gedächtnis ────────────────────────────────────────────────────────────────
export const MAX_HISTORY_CHARS = 60_000; // Pruning-Grenze für den Message-Buffer
export const COMPACT_THRESHOLD = 8_000; // Tageslog: ab hier wird komprimiert
export const KEEP_RECENT_LOGS = 5; // Letzte N Log-Einträge bleiben immer erhalten
export const HISTORY_LOAD_LIMIT = 10; // Gesprächseinträge die beim Start geladen werden

// ── Vault / Obsidian ──────────────────────────────────────────────────────────
export const VAULT_PATH = process.env.VAULT_PATH!;
export const VAULT_INBOX = "Inbox";
export const VAULT_AGENTS_DIR = "Agents";
export const VAULT_LOGS_DIR = "MEMORY_LOGS";
export const agentsPath = () => path.join(VAULT_PATH, VAULT_AGENTS_DIR);
export const agentPath = (name: string) => path.join(agentsPath(), name);
export const logsPath = (name: string) => path.join(agentPath(name), VAULT_LOGS_DIR);

// ── System ────────────────────────────────────────────────────────────────────
export const TIMEZONE = "Europe/Vienna";
export const LOCALE = "de-AT";
export const LANGUAGE = "Deutsch";
export const CHAT_ID_FILE = path.join(process.cwd(), ".chat_id");
export const LOG_FILE = path.join(process.cwd(), "logs", "bot.log");

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
export const SEARCH_MAX_RESULTS = 10; // searchVault Ergebnisse
export const SEARCH_LINE_MAX = 100; // searchVault Zeilen-Laenge

// ── Agent-Workspace ──────────────────────────────────────────────────────────
export const WS_MAX_FILE_CHARS = 20_000; // Max Zeichen pro Workspace-Datei
export const WS_MAX_TOTAL_CHARS = 150_000; // Max Zeichen gesamt
export const KEPT_TOOL_MESSAGES = 3; // Tool-Messages beim Pruning behalten

// ── Logging ──────────────────────────────────────────────────────────────────
export const MAX_LOG_LINES = 500; // bot.log Zeilen-Limit
export const LOG_DEFAULT_LINES = 20; // /logs Standard-Anzahl
export const LOG_MAX_DISPLAY_LINES = 50; // /logs Maximum
export const LOG_DISPLAY_MAX_CHARS = 3_800; // /logs Output-Limit

// ── Rate-Limiting ────────────────────────────────────────────────────────────
export const RATE_LIMIT_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// ── Web-API ──────────────────────────────────────────────────────────────────
export const API_PORT = parseInt(process.env.API_PORT || "3000", 10);
export const JWT_SECRET = process.env.JWT_SECRET || "";
export const USERS_FILE = path.join(process.cwd(), "data", "users.json");
export const API_ENABLED = !!JWT_SECRET;

// ── Datenbank (Supabase / PostgreSQL) ────────────────────────────────────────
export const DATABASE_URL = process.env.DATABASE_URL || "";
export const DB_ENABLED = !!DATABASE_URL;

// ── Supabase Client ──────────────────────────────────────────────────────────
export const SUPABASE_URL = process.env.SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
export const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// ── Embeddings ───────────────────────────────────────────────────────────────
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
export const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || "768", 10);
export const EMBEDDING_BATCH_SIZE = 5; // Parallele Embedding-Anfragen
