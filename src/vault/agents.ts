import fs from "fs";
import path from "path";
import {
  PROTECTED_AGENTS as _PROTECTED_AGENTS,
  COMPACT_THRESHOLD, KEEP_RECENT_LOGS,
  VAULT_AGENTS_DIR, VAULT_LOGS_DIR,
  LOCALE,
} from "../config.js";
import { vaultPath, ensureDir } from "./helpers.js";

// ---- Constants ----

export const PROTECTED_AGENTS = _PROTECTED_AGENTS;

const EDITABLE_AGENT_FILES = [
  "SOUL.md", "BOOT.md", "AGENTS.md", "TOOLS.md",
  "HEARTBEAT.md", "BOOTSTRAP.md", "USER.md", "IDENTITY.md", "MEMORY.md"
];

const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 150_000;

// ---- Types ----

export interface ConversationEntry {
  user: string;
  assistant: string;
}

export interface SetupAnswers {
  name: string;
  emoji: string;
  vibe: string;
  context: string;
  userName: string;
  userCompany: string;
}

export interface WorkspaceFileInfo {
  name: string;
  rawChars: number;
  injectedChars: number;
  tokens: number;
  truncated: boolean;
  loaded: boolean;
}

// ---- Utilities ----

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function getAgentPath(agentName: string): string {
  return path.join(vaultPath, VAULT_AGENTS_DIR, agentName);
}

export function isProtectedAgent(agentName: string): boolean {
  return (PROTECTED_AGENTS as readonly string[]).includes(agentName);
}

export function listAgents(): string[] {
  const agentsRoot = path.join(vaultPath, VAULT_AGENTS_DIR);
  if (!fs.existsSync(agentsRoot)) return [];
  return fs.readdirSync(agentsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

export function vaultExists(): boolean {
  return fs.existsSync(vaultPath);
}

export function getVaultPath(): string {
  return vaultPath;
}

// ---- Workspace ----

function truncateFile(content: string, filename: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  const removed = content.length - MAX_FILE_CHARS;
  return content.slice(0, MAX_FILE_CHARS) + `\n\n[... ${filename} gekuerzt – ${removed} Zeichen entfernt]`;
}

export function isMainWorkspaceConfigured(): boolean {
  const identityPath = path.join(vaultPath, VAULT_AGENTS_DIR, "Main", "IDENTITY.md");
  if (!fs.existsSync(identityPath)) return false;
  return fs.readFileSync(identityPath, "utf-8").includes("## Name:");
}

export function loadAgentWorkspace(agentName: string, mode: "full" | "minimal" = "full"): string {
  const agentDir = getAgentPath(agentName);
  let context = "";
  let totalChars = 0;

  function addFile(filepath: string, label: string): void {
    if (!fs.existsSync(filepath)) return;
    const raw = fs.readFileSync(filepath, "utf-8").trim();
    if (!raw) return;
    const content = truncateFile(raw, label);
    const block = `\n\n---\n${content}`;
    if (totalChars + block.length > MAX_TOTAL_CHARS) {
      console.warn(`[context] Budget erschoepft – ${label} nicht geladen`);
      return;
    }
    context += block;
    totalChars += block.length;
  }

  addFile(path.join(agentDir, "IDENTITY.md"), "IDENTITY.md");
  addFile(path.join(agentDir, "SOUL.md"), "SOUL.md");
  addFile(path.join(agentDir, "BOOT.md"), "BOOT.md");

  if (mode === "full") {
    addFile(path.join(agentDir, "USER.md"),    "USER.md");
    addFile(path.join(agentDir, "AGENTS.md"),  "AGENTS.md");
    addFile(path.join(agentDir, "TOOLS.md"),   "TOOLS.md");
    addFile(path.join(agentDir, "MEMORY.md"),  "MEMORY.md");
    addFile(path.join(agentDir, "HEARTBEAT.md"), "HEARTBEAT.md");

    const memDir = path.join(agentDir, VAULT_LOGS_DIR);
    const isFirstRun = !fs.existsSync(memDir) ||
      fs.readdirSync(memDir).filter(f => f.endsWith(".md")).length === 0;
    if (isFirstRun) addFile(path.join(agentDir, "BOOTSTRAP.md"), "BOOTSTRAP.md");

    const today = new Date().toISOString().slice(0, 10);
    addFile(path.join(agentDir, VAULT_LOGS_DIR, `${today}.md`), "Tageslog");
  }

  return context.trim();
}

export function createAgentWorkspace(agentName: string, soul: string, agentsMd = "", userMd = ""): string {
  const agentDir = getAgentPath(agentName);
  ensureDir(path.join(agentDir, VAULT_LOGS_DIR));

  const userDefault = `# User\n\nJulius Sima – Architekt, Wien.\nSprache: Deutsch. Kurze, direkte Antworten bevorzugt.\n`;
  const agentsDefault = `# ${agentName} – Sub-Agents\n\nKeine Sub-Agents konfiguriert.\n`;

  const files: Record<string, string> = {
    "IDENTITY.md":   `\u{1F916} ${agentName}`,
    "SOUL.md":       soul,
    "AGENTS.md":     agentsMd || agentsDefault,
    "USER.md":       userMd || userDefault,
    "TOOLS.md":      `# ${agentName} – Tool-Konventionen\n\nNoch keine Konventionen definiert.\n`,
    "MEMORY.md":     `# Memory – ${agentName}\n\nNoch keine dauerhaften Erkenntnisse.\n`,
    "BOOT.md":       `# ${agentName} – Boot\n\nKein spezieller Startup-Check konfiguriert.\n`,
    "HEARTBEAT.md":  `# ${agentName} – Heartbeat\n\nCron: */30 8-20 * * 1-6\n\n## Aufgaben\nPruefe ob es etwas Relevantes zu melden gibt:\n1. Termine die HEUTE anstehen (nutze termine_auflisten)\n2. Offene Aufgaben die ueberfaellig oder dringend sind (nutze aufgaben_auflisten)\n3. Wichtige Erinnerungen aus MEMORY.md\n\n## Regeln\n- NUR melden wenn es etwas Konkretes gibt (Termin heute, ueberfaellige Aufgabe)\n- Wenn NICHTS relevant ist: antworte exakt mit [STILL] — keine Nachricht wird gesendet\n- Kurz und knapp — maximal 3-5 Zeilen\n- Keine Floskeln, kein "Guten Morgen", direkt zur Sache\n- Termine: Uhrzeit + was ansteht\n- Aufgaben: nur ueberfaellige oder heute faellige\n`,
    "BOOTSTRAP.md":  `# ${agentName} – Bootstrap\n\nErster Start. Stelle dich kurz vor und frage womit du helfen kannst.\n`,
  };

  for (const [filename, content] of Object.entries(files)) {
    const fp = path.join(agentDir, filename);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, content, "utf-8");
  }

  return agentDir;
}

export function finalizeMainWorkspace(answers: SetupAnswers): void {
  const identity = `# Identity\n\n## Name: ${answers.name}\n## Emoji: ${answers.emoji}\n## Vibe: ${answers.vibe}\n## Kontext: ${answers.context}\n`;

  const soul = `# ${answers.name} – Soul\n\n## Identitaet\nDu bist ${answers.name}, der KI-Assistent von ${answers.userName} fuer ${answers.userCompany}.\n${answers.vibe}.\n\n## Aufgaben\n- Notizen, Aufgaben und Termine verwalten\n- Projektinformationen abrufen und speichern\n- Im Vault suchen und Dateien lesen\n- Fragen ueber laufende Projekte beantworten\n- Bei Bedarf spezialisierte Sub-Agenten starten\n\n## Ton & Stil\n- Immer auf Deutsch\n- Kurz und direkt — wir sind in Telegram, kein Fliesstext\n- Wenn du etwas speicherst, kurz bestaetigen\n- Wenn etwas unklar ist, nachfragen\n- Keine unnoetigen Hoeflichkeitsfloskeln\n\n## Langzeitgedaechtnis (MEMORY.md)\nNutze \`memory_speichern\` proaktiv wenn:\n- ${answers.userName} explizit sagt: "merk dir", "vergiss nicht", "speicher das", "ist wichtig"\n- Du etwas ueber ${answers.userName} lernst das dauerhaft relevant ist (Praeferenzen, Arbeitsweise)\n- Wichtige Projektentscheidungen getroffen werden\n- ${answers.userName} eine klare Praeferenz aeussert\n\nNicht jede Konversation speichern — nur was dauerhaft relevant ist.\n`;

  const user = `# User – ${answers.userName}\n\n## Profil\n- Benutzer von ${answers.userCompany}\n- Sprache: Deutsch\n\n## Arbeitsweise\n- Bevorzugt kurze, direkte Antworten\n- Nutzt Sprachnachrichten haeufig (via Whisper transkribiert)\n\n## Hinweise\n- Wenn ${answers.userName} "morgen" sagt → Datum relativ zu heute berechnen\n- Wenn unklar ob Notiz oder Aufgabe → lieber nachfragen\n`;

  const agentDir = path.join(vaultPath, VAULT_AGENTS_DIR, "Main");
  ensureDir(path.join(agentDir, VAULT_LOGS_DIR));

  fs.writeFileSync(path.join(agentDir, "IDENTITY.md"), identity, "utf-8");
  fs.writeFileSync(path.join(agentDir, "SOUL.md"), soul, "utf-8");
  fs.writeFileSync(path.join(agentDir, "USER.md"), user, "utf-8");
}

export function inspectAgentWorkspace(agentName: string, mode: "full" | "minimal" = "full"): WorkspaceFileInfo[] {
  const agentDir = getAgentPath(agentName);
  const today = new Date().toISOString().slice(0, 10);

  const memDir = path.join(agentDir, VAULT_LOGS_DIR);
  const isFirstRun = !fs.existsSync(memDir) ||
    fs.readdirSync(memDir).filter(f => f.endsWith(".md")).length === 0;

  const candidates: { name: string; filepath: string }[] = [
    { name: "IDENTITY.md",   filepath: path.join(agentDir, "IDENTITY.md") },
    { name: "SOUL.md",       filepath: path.join(agentDir, "SOUL.md") },
    { name: "BOOT.md",       filepath: path.join(agentDir, "BOOT.md") },
    ...(mode === "full" ? [
      { name: "USER.md",       filepath: path.join(agentDir, "USER.md") },
      { name: "AGENTS.md",     filepath: path.join(agentDir, "AGENTS.md") },
      { name: "TOOLS.md",      filepath: path.join(agentDir, "TOOLS.md") },
      { name: "MEMORY.md",     filepath: path.join(agentDir, "MEMORY.md") },
      { name: "HEARTBEAT.md",  filepath: path.join(agentDir, "HEARTBEAT.md") },
      ...(isFirstRun ? [{ name: "BOOTSTRAP.md", filepath: path.join(agentDir, "BOOTSTRAP.md") }] : []),
      { name: "Tageslog",      filepath: path.join(agentDir, VAULT_LOGS_DIR, `${today}.md`) },
    ] : []),
  ];

  const result: WorkspaceFileInfo[] = [];
  let totalChars = 0;

  for (const { name, filepath } of candidates) {
    if (!fs.existsSync(filepath)) continue;
    const raw = fs.readFileSync(filepath, "utf-8").trim();
    if (!raw) continue;

    const injected = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
    const block = `\n\n---\n${injected}`;
    const loaded = totalChars + block.length <= MAX_TOTAL_CHARS;

    result.push({
      name,
      rawChars: raw.length,
      injectedChars: loaded ? injected.length : 0,
      tokens: loaded ? estimateTokens(injected) : 0,
      truncated: raw.length > MAX_FILE_CHARS,
      loaded,
    });

    if (loaded) totalChars += block.length;
  }

  return result;
}

// ---- Conversation Logging ----

export function appendAgentConversation(agentName: string, userMsg: string, botReply: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const memDir = path.join(getAgentPath(agentName), VAULT_LOGS_DIR);
  const filepath = path.join(memDir, `${today}.md`);
  ensureDir(memDir);

  const now = new Date();
  const time = now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString(LOCALE, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, `# Log – ${dateStr}\n\n`, "utf-8");
  }

  fs.appendFileSync(filepath, `## ${time}\n**User:** ${userMsg}\n**${agentName}:** ${botReply}\n\n`, "utf-8");

  const bootstrapPath = path.join(getAgentPath(agentName), "BOOTSTRAP.md");
  if (fs.existsSync(bootstrapPath)) fs.unlinkSync(bootstrapPath);
}

export function loadAgentHistory(agentName: string, limit = 10): ConversationEntry[] {
  const results: ConversationEntry[] = [];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const date of [yesterday, today]) {
    const iso = date.toISOString().slice(0, 10);
    const filepath = path.join(getAgentPath(agentName), VAULT_LOGS_DIR, `${iso}.md`);
    if (!fs.existsSync(filepath)) continue;

    const content = fs.readFileSync(filepath, "utf-8");
    const blocks = content.split(/^## \d{2}:\d{2}/m).slice(1);

    for (const block of blocks) {
      const userMatch = block.match(/\*\*User:\*\* (.+)/);
      const botMatch = block.match(/\*\*[^*]+:\*\* ([\s\S]+?)(?=\n\n|\n##|$)/);
      if (userMatch && botMatch) {
        results.push({ user: userMatch[1].trim(), assistant: botMatch[1].trim() });
      }
    }
  }

  return results.slice(-limit);
}

export function clearAgentToday(agentName: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), VAULT_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}

// ---- Memory ----

export function appendAgentMemory(agentName: string, entry: string): void {
  const filepath = path.join(getAgentPath(agentName), "MEMORY.md");
  ensureDir(path.dirname(filepath));

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, `# Memory – ${agentName}\n\n`, "utf-8");
  }

  const date = new Date().toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
  fs.appendFileSync(filepath, `- ${date}: ${entry}\n`, "utf-8");
}

// ---- Agent File Editor ----

export function readAgentFile(agentName: string, filename: string): string | null {
  const filepath = path.join(vaultPath, VAULT_AGENTS_DIR, agentName, filename);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

export function writeAgentFile(agentName: string, filename: string, content: string): boolean {
  if (!EDITABLE_AGENT_FILES.includes(filename)) return false;
  const filepath = path.join(vaultPath, VAULT_AGENTS_DIR, agentName, filename);
  if (!fs.existsSync(path.dirname(filepath))) return false;
  fs.writeFileSync(filepath, content, "utf-8");
  return true;
}

// ---- Compaction Data ----

export function shouldCompact(agentName: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), VAULT_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return false;
  return fs.statSync(filepath).size >= COMPACT_THRESHOLD;
}

export function getLogForCompaction(agentName: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), VAULT_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return null;

  const content = fs.readFileSync(filepath, "utf-8");
  const entries = content.match(/## \d{2}:\d{2}\n[\s\S]*?(?=\n## \d{2}:\d{2}|$)/g) ?? [];
  if (entries.length <= KEEP_RECENT_LOGS) return null;

  return entries.slice(0, -KEEP_RECENT_LOGS).join("\n");
}

export function writeCompactedLog(agentName: string, summary: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), VAULT_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return;

  const content = fs.readFileSync(filepath, "utf-8");
  const header = content.match(/^(# .+\n\n)/)?.[1] ?? "";
  const entries = content.match(/## \d{2}:\d{2}\n[\s\S]*?(?=\n## \d{2}:\d{2}|$)/g) ?? [];
  if (entries.length <= KEEP_RECENT_LOGS) return;

  const toKeep = entries.slice(-KEEP_RECENT_LOGS);
  const time = new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

  fs.writeFileSync(
    filepath,
    `${header}## Zusammenfassung (${time})\n${summary}\n\n${toKeep.join("\n")}`,
    "utf-8"
  );
}
