import "dotenv/config";

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
export const DEFAULT_MODEL   = process.env.OLLAMA_MODEL || "qwen2.5:7b";
export const FAST_MODEL      = process.env.OLLAMA_FAST_MODEL || DEFAULT_MODEL;
export const SUBAGENT_MODEL  = process.env.OLLAMA_SUBAGENT_MODEL || DEFAULT_MODEL;

export const AGENTS = [
  { name: "Main", model: DEFAULT_MODEL, protected: true,  description: "Haupt-Agent" },
  // { name: "Kalkulator", model: DEFAULT_MODEL, protected: false, description: "Kalkulations-Agent (ÖNORM)" },
];

export const PROTECTED_AGENTS = AGENTS.filter(a => a.protected).map(a => a.name);
export const getAgentModel = (name: string) => AGENTS.find(a => a.name === name)?.model ?? DEFAULT_MODEL;

export const MAX_SPAWN_DEPTH   = 2;
export const MAX_HISTORY_CHARS = 60_000;
export const COMPACT_THRESHOLD = 8_000;
export const TIMEZONE          = "Europe/Vienna";
