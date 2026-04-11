import OpenAI from "openai";
import {
  OLLAMA_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_ENABLED,
  DEFAULT_MODEL,
  FAST_MODEL,
  SUBAGENT_MODEL,
  LOCALE,
} from "../config.js";

// OpenAI direkt wenn OPENAI_API_KEY gesetzt, sonst Ollama-kompatibel
export const client = OPENAI_ENABLED
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: "ollama" });

let MODEL = DEFAULT_MODEL;
let _fastMode = false;

export function getModel(): string {
  return MODEL;
}
export function getSubagentModel(): string {
  return SUBAGENT_MODEL;
}
export function isFastMode(): boolean {
  return _fastMode;
}

export function setModel(name: string): void {
  MODEL = name;
}

export function toggleFast(): boolean {
  _fastMode = !_fastMode;
  MODEL = _fastMode ? FAST_MODEL : DEFAULT_MODEL;
  return _fastMode;
}

/** Einzige Code-Injektion: dynamisches Datum. Alles andere kommt aus den Agent-MD-Dateien. */
export function buildDateLine(): string {
  return `Heute ist: ${new Date().toLocaleDateString(LOCALE, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;
}
