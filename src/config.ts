import "dotenv/config";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM CONFIG — zentrale Konfiguration für Bau-OS
// Secrets (.env): BOT_TOKEN, VAULT_PATH, PYTHON_PATH
// ─────────────────────────────────────────────────────────────────────────────

// ─── Ollama / LLM ─────────────────────────────────────────────────────────────

export const OLLAMA_BASE_URL  = process.env.OLLAMA_BASE_URL  || "http://localhost:11434/v1";
export const DEFAULT_MODEL    = process.env.OLLAMA_MODEL     || "qwen2.5:7b";
export const FAST_MODEL       = process.env.OLLAMA_FAST_MODEL || DEFAULT_MODEL;
export const SUBAGENT_MODEL   = process.env.OLLAMA_SUBAGENT_MODEL || DEFAULT_MODEL;

// ─── Agenten ──────────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;           // Ordnername unter Agents/
  model: string;          // LLM-Modell für diesen Agent
  protected: boolean;     // true = kann nicht gelöscht/überschrieben werden
  description: string;    // Kurzbeschreibung (für /agents Command)
}

export const AGENTS: AgentConfig[] = [
  {
    name:        "Main",
    model:       DEFAULT_MODEL,
    protected:   true,
    description: "Haupt-Agent — Ansprechpartner für alles",
  },
  // Weitere Agenten hier eintragen:
  // {
  //   name:        "Kalkulator",
  //   model:       DEFAULT_MODEL,
  //   protected:   false,
  //   description: "Kalkulations-Agent für Bauprojekte (ÖNORM)",
  // },
];

export const PROTECTED_AGENTS = AGENTS.filter(a => a.protected).map(a => a.name);

export function getAgentModel(name: string): string {
  return AGENTS.find(a => a.name === name)?.model ?? DEFAULT_MODEL;
}

// ─── System ───────────────────────────────────────────────────────────────────

export const MAX_SPAWN_DEPTH    = 2;       // Max. Tiefe für Sub-Agent-Spawning
export const MAX_HISTORY_CHARS  = 60_000;  // Pruning-Grenze pro Agent
export const COMPACT_THRESHOLD  = 8_000;   // Auto-Kompaktierung ab dieser Zeichenzahl
export const TIMEZONE           = "Europe/Vienna";
