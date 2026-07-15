import OpenAI from "openai";
import {
  OLLAMA_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  OPENAI_ENABLED,
  DEFAULT_MODEL,
  FAST_MODEL,
  SUBAGENT_MODEL,
  LOCALE,
  getRuntimeMainModel,
  setRuntimeMainModel,
} from "../config.js";

// OpenAI direkt wenn OPENAI_API_KEY gesetzt, sonst Ollama-kompatibel.
// OPENAI_BASE_URL erlaubt einen Drittanbieter (Groq/OpenRouter) am
// OpenAI-Pfad — LLM-Provider-Fallback ueber die .env (siehe docs/vps-runbook).
export const client = OPENAI_ENABLED
  ? new OpenAI({ apiKey: OPENAI_API_KEY, ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}) })
  : new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: "ollama" });

// Wahrheit liegt in config.ts (getRuntimeMainModel). Wir spiegeln nur
// den Fast-Mode-Zustand hier, der Modellname selbst lebt im Override.
let _fastMode = false;

export function getModel(): string {
  return getRuntimeMainModel() ?? DEFAULT_MODEL;
}
export function getSubagentModel(): string {
  return SUBAGENT_MODEL;
}
export function isFastMode(): boolean {
  return _fastMode;
}

export function setModel(name: string): void {
  setRuntimeMainModel(name);
}

export function toggleFast(): boolean {
  _fastMode = !_fastMode;
  setRuntimeMainModel(_fastMode ? FAST_MODEL : DEFAULT_MODEL);
  return _fastMode;
}

/** Einzige Code-Injektion: dynamisches Datum. Alles andere kommt aus den Agent-MD-Dateien. */
export function buildDateLine(): string {
  return `Heute ist: ${new Date().toLocaleDateString(LOCALE, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;
}
