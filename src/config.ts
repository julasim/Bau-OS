import "dotenv/config";
import path from "path";

// ── LLM ──────────────────────────────────────────────────────────────────────
export const OLLAMA_BASE_URL  = process.env.OLLAMA_BASE_URL  || "http://localhost:11434/v1";
export const DEFAULT_MODEL    = process.env.OLLAMA_MODEL     || "qwen2.5:7b";
export const FAST_MODEL       = process.env.OLLAMA_FAST_MODEL    || DEFAULT_MODEL;
export const SUBAGENT_MODEL   = process.env.OLLAMA_SUBAGENT_MODEL || DEFAULT_MODEL;
export const MAX_TOOL_ROUNDS  = 5;    // Max. Iterationen im Agentic Loop

// ── Agenten ───────────────────────────────────────────────────────────────────
export const AGENTS = [
  { name: "Main", model: DEFAULT_MODEL, protected: true,  description: "Haupt-Agent" },
  // { name: "Kalkulator", model: DEFAULT_MODEL, protected: false, description: "Kalkulations-Agent (ÖNORM)" },
];

export const PROTECTED_AGENTS = AGENTS.filter(a => a.protected).map(a => a.name);
export const getAgentModel    = (name: string) => AGENTS.find(a => a.name === name)?.model ?? DEFAULT_MODEL;
export const MAX_SPAWN_DEPTH  = 2;    // Sub-Agents können keine weiteren spawnen

// ── Gedächtnis ────────────────────────────────────────────────────────────────
export const MAX_HISTORY_CHARS  = 60_000;  // Pruning-Grenze für den Message-Buffer
export const COMPACT_THRESHOLD  = 8_000;   // Tageslog: ab hier wird komprimiert
export const KEEP_RECENT_LOGS   = 5;       // Letzte N Log-Einträge bleiben immer erhalten
export const HISTORY_LOAD_LIMIT = 10;      // Gesprächseinträge die beim Start geladen werden

// ── Vault / Obsidian ──────────────────────────────────────────────────────────
export const VAULT_PATH       = process.env.VAULT_PATH!;
export const VAULT_INBOX      = "Inbox";
export const VAULT_AGENTS_DIR = "Agents";
export const VAULT_LOGS_DIR   = "MEMORY_LOGS";
export const agentsPath       = () => path.join(VAULT_PATH, VAULT_AGENTS_DIR);
export const agentPath        = (name: string) => path.join(agentsPath(), name);
export const logsPath         = (name: string) => path.join(agentPath(name), VAULT_LOGS_DIR);

// ── System ────────────────────────────────────────────────────────────────────
export const TIMEZONE         = "Europe/Vienna";
export const LOCALE           = "de-AT";
export const LANGUAGE         = "Deutsch";
export const CHAT_ID_FILE     = path.join(process.cwd(), ".chat_id");
export const LOG_FILE         = path.join(process.cwd(), "logs", "bot.log");
export const DASHBOARD_PORT   = parseInt(process.env.DASHBOARD_PORT || "3000");

