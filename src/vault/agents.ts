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
  try {
    return fs.readdirSync(agentsRoot, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
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
    let isFirstRun = !fs.existsSync(memDir);
    if (!isFirstRun) {
      try { isFirstRun = fs.readdirSync(memDir).filter(f => f.endsWith(".md")).length === 0; } catch { isFirstRun = true; }
    }
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
    "TOOLS.md":      `# ${agentName} – Tool-Konventionen\n\n## Sprache\n- Antworte IMMER mit echten deutschen Umlauten: ä, ö, ü, ß\n- NIEMALS ae/oe/ue als Ersatz verwenden\n\n## Wann welches Tool\n- antworten → JEDE Antwort an den Benutzer (PFLICHT, immer als letztes Tool aufrufen)\n- notiz_speichern → freie Gedanken, Beobachtungen, Ideen\n- aufgabe_speichern → konkrete To-dos mit Verb am Anfang\n- termin_speichern → Meetings, Deadlines (immer mit Datum TT.MM.JJJJ)\n- memory_speichern → dauerhaft wichtige Fakten\n- vault_suchen → vor dem Erstellen erst suchen ob es schon existiert\n- agent_spawnen → für kurze Sub-Aufgaben\n- agent_spawnen_async → für längere Aufgaben\n- befehl_ausfuehren → Shell-Befehle auf dem Server (ls, df, systemctl, grep, curl, ps etc.)\n- code_ausfuehren → JavaScript-Code direkt ausführen (Berechnungen, JSON, Daten)\n- http_anfrage → REST APIs aufrufen (GET/POST/PUT/DELETE mit Headers und Body)\n- web_suchen → im Internet nach Informationen suchen (allgemeine Recherche)\n- nachrichten_suchen → aktuelle Nachrichten und Meldungen suchen (Preise, Förderungen, Vorschriften)\n- webseite_lesen → eine URL öffnen und den Hauptinhalt als Markdown lesen\n\n## Dynamische Tools\nDu kannst eigene Tools erstellen die sofort verfügbar sind — ohne Neustart!\n- tool_erstellen → neues Tool als Ordner mit tool.json + run.js/run.sh anlegen\n- tools_auflisten → alle dynamischen Tools anzeigen\n- tool_loeschen → ein dynamisches Tool entfernen\n\nJedes Tool hat: tool.json (Schema) + run.js (Node.js) oder run.sh (Shell-Script)\nrun.js bekommt: args (Parameter), files() (Zusatzdateien lesen), fetch, console.log\nrun.sh bekommt: TOOL_ARG_* Umgebungsvariablen\n\n## Cron-Jobs / Heartbeat\nDu hast ein echtes Cron-System! Die Datei HEARTBEAT.md steuert es:\n- Cron-Expression ändern: agent_datei_schreiben mit datei='HEARTBEAT.md'\n- Format: 'Cron: */5 * * * *' (alle 5 Minuten) oder 'Cron: 0 8 * * *' (täglich 8 Uhr)\n- Änderungen sind SOFORT aktiv — kein Neustart nötig\n- Du musst KEINEN eigenen Timer bauen — das System macht das automatisch\n\n## Zuordnungs-Regeln (WICHTIG)\n- Enthält die Nachricht ein DATUM oder UHRZEIT → termin_speichern (nicht notiz_speichern)\n- Enthält die Nachricht ein TODO/Verb ("machen", "erledigen", "prüfen") → aufgabe_speichern\n- Alles andere → notiz_speichern\n- Im Zweifel: nachfragen statt falsch einordnen\n\n## Regeln\n- Nie doppelt speichern — zuerst suchen\n- Aufgaben immer mit konkretem Verb beginnen\n- Termine immer mit Datum im Format TT.MM.JJJJ\n- Bei Unsicherheit nachfragen statt raten\n`,
    "MEMORY.md":     `# Memory – ${agentName}\n\nNoch keine dauerhaften Erkenntnisse.\n`,
    "BOOT.md":       `# ${agentName} – Boot\n\n## Bei jedem Gespräch\n- Antworte immer auf Deutsch mit echten Umlauten (ä, ö, ü, ß) — NIEMALS ae/oe/ue\n- Halte Antworten kurz und direkt — wir sind in Telegram, kein Fließtext\n- Bestätigungen kurz halten (z.B. "gespeichert", "erledigt")\n- Bei Unsicherheit nachfragen statt raten\n- Keine unnötige Höflichkeitsfloskeln\n\n## Antwort-System (PFLICHT)\n- Du kannst NICHT direkt Text ausgeben — JEDE Antwort MUSS über das Tool 'antworten' gesendet werden\n- Workflow: (1) Daten-Tools aufrufen falls nötig → (2) 'antworten' mit dem Ergebnis aufrufen\n- Bei Fragen zu externen Daten (Wetter, Preise, Fakten): ZUERST web_suchen oder http_anfrage, DANN antworten\n- Wenn kein passendes Tool vorhanden: über 'antworten' ehrlich sagen "Das weiß ich nicht"\n- NIEMALS Daten erfinden — nur Informationen verwenden die aus einem Tool-Aufruf stammen\n- Quellen immer angeben wenn du web_suchen nutzt\n`,
    "HEARTBEAT.md":  `# ${agentName} – Heartbeat\n\nCron: */30 8-20 * * 1-6\n\n## Aufgaben\nPrüfe ob es etwas Relevantes zu melden gibt:\n1. Termine die HEUTE anstehen (nutze termine_auflisten)\n2. Offene Aufgaben die überfällig oder dringend sind (nutze aufgaben_auflisten)\n3. Wichtige Erinnerungen aus MEMORY.md\n\n## Regeln\n- NUR melden wenn es etwas Konkretes gibt (Termin heute, überfällige Aufgabe)\n- Wenn NICHTS relevant ist: antworte exakt mit [STILL] — keine Nachricht wird gesendet\n- Kurz und knapp — maximal 3-5 Zeilen\n- Keine Floskeln, kein "Guten Morgen", direkt zur Sache\n- Termine: Uhrzeit + was ansteht\n- Aufgaben: nur überfällige oder heute fällige\n`,
    "BOOTSTRAP.md":  `# ${agentName} – Bootstrap\n\nErster Start. Stelle dich kurz vor und frage womit du helfen kannst.\n`,
  };

  for (const [filename, content] of Object.entries(files)) {
    const fp = path.join(agentDir, filename);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, content, "utf-8");
  }

  return agentDir;
}

export function finalizeMainWorkspace(answers: SetupAnswers): void {
  const agentName = answers.name || "Main";
  const agentDir = path.join(vaultPath, VAULT_AGENTS_DIR, "Main");
  ensureDir(path.join(agentDir, VAULT_LOGS_DIR));

  const files: Record<string, string> = {
    "IDENTITY.md": `# Identity\n\n## Name: ${answers.name}\n## Emoji: ${answers.emoji}\n## Vibe: ${answers.vibe}\n## Kontext: ${answers.context}\n`,
    "SOUL.md": `# ${agentName} – Soul\n\n## Identität\nDu bist ${agentName}, der KI-Assistent von ${answers.userName} für ${answers.userCompany}.\n${answers.vibe}.\n\n## Aufgaben\n- Notizen, Aufgaben und Termine verwalten\n- Projektinformationen abrufen und speichern\n- Im Vault suchen und Dateien lesen\n- Fragen über laufende Projekte beantworten\n- Bei Bedarf spezialisierte Sub-Agenten starten\n\n## Ton & Stil\n- Immer auf Deutsch mit echten Umlauten (ä, ö, ü, ß) — NIEMALS ae/oe/ue\n- Kurz und direkt — wir sind in Telegram, kein Fließtext\n- Wenn du etwas speicherst, kurz bestätigen\n- Wenn etwas unklar ist, nachfragen\n- Keine unnötigen Höflichkeitsfloskeln\n\n## Langzeitgedächtnis (MEMORY.md)\nNutze \`memory_speichern\` proaktiv wenn:\n- ${answers.userName} explizit sagt: "merk dir", "vergiss nicht", "speicher das", "ist wichtig"\n- Du etwas über ${answers.userName} lernst das dauerhaft relevant ist (Präferenzen, Arbeitsweise)\n- Wichtige Projektentscheidungen getroffen werden\n- ${answers.userName} eine klare Präferenz äußert\n\nNicht jede Konversation speichern — nur was dauerhaft relevant ist.\n\n## Datenquellen & Genauigkeit\n- Deine Daten kommen AUSSCHLIESSLICH aus: (1) dem Vault, (2) verfügbaren Tools, (3) lokalen Berechnungen\n- Für alles andere: Tool nutzen oder ehrlich sagen "Das weiß ich nicht"\n- NIEMALS Daten erfinden, auch wenn sie plausibel klingen\n`,
    "USER.md": `# User – ${answers.userName}\n\n## Profil\n- Benutzer von ${answers.userCompany}\n- Sprache: Deutsch (echte Umlaute ä, ö, ü, ß verwenden)\n\n## Arbeitsweise\n- Bevorzugt kurze, direkte Antworten\n- Nutzt Sprachnachrichten häufig (via Whisper transkribiert)\n\n## Hinweise\n- Wenn ${answers.userName} "morgen" sagt → Datum relativ zu heute berechnen\n- Wenn unklar ob Notiz oder Aufgabe → lieber nachfragen\n`,
    "BOOT.md": `# ${agentName} – Boot\n\n## Bei jedem Gespräch\n- Antworte immer auf Deutsch mit echten Umlauten (ä, ö, ü, ß) — NIEMALS ae/oe/ue\n- Halte Antworten kurz und direkt — wir sind in Telegram, kein Fließtext\n- Bestätigungen kurz halten (z.B. "gespeichert", "erledigt")\n- Bei Unsicherheit nachfragen statt raten\n- Keine unnötige Höflichkeitsfloskeln\n\n## Antwort-System (PFLICHT)\n- Du kannst NICHT direkt Text ausgeben — JEDE Antwort MUSS über das Tool 'antworten' gesendet werden\n- Workflow: (1) Daten-Tools aufrufen falls nötig → (2) 'antworten' mit dem Ergebnis aufrufen\n- Bei Fragen zu externen Daten (Wetter, Preise, Fakten): ZUERST web_suchen oder http_anfrage, DANN antworten\n- Wenn kein passendes Tool vorhanden: über 'antworten' ehrlich sagen "Das weiß ich nicht"\n- NIEMALS Daten erfinden — nur Informationen verwenden die aus einem Tool-Aufruf stammen\n- Quellen immer angeben wenn du web_suchen nutzt\n`,
    "TOOLS.md": `# ${agentName} – Tool-Konventionen\n\n## Sprache\n- Antworte IMMER mit echten deutschen Umlauten: ä, ö, ü, ß\n- NIEMALS ae/oe/ue als Ersatz verwenden\n\n## Wann welches Tool\n- antworten → JEDE Antwort an den Benutzer (PFLICHT, immer als letztes Tool aufrufen)\n- notiz_speichern → freie Gedanken, Beobachtungen, Ideen\n- aufgabe_speichern → konkrete To-dos mit Verb am Anfang\n- termin_speichern → Meetings, Deadlines (immer mit Datum TT.MM.JJJJ)\n- memory_speichern → dauerhaft wichtige Fakten\n- vault_suchen → vor dem Erstellen erst suchen ob es schon existiert\n- agent_spawnen → für kurze Sub-Aufgaben\n- agent_spawnen_async → für längere Aufgaben\n- befehl_ausfuehren → Shell-Befehle auf dem Server (ls, df, systemctl, grep, curl, ps etc.)\n- code_ausfuehren → JavaScript-Code direkt ausführen (Berechnungen, JSON, Daten)\n- http_anfrage → REST APIs aufrufen (GET/POST/PUT/DELETE mit Headers und Body)\n- web_suchen → im Internet nach Informationen suchen (allgemeine Recherche)\n- nachrichten_suchen → aktuelle Nachrichten und Meldungen suchen (Preise, Förderungen, Vorschriften)\n- webseite_lesen → eine URL öffnen und den Hauptinhalt als Markdown lesen\n\n## Dynamische Tools\nDu kannst eigene Tools erstellen die sofort verfügbar sind — ohne Neustart!\n- tool_erstellen → neues Tool als Ordner mit tool.json + run.js/run.sh anlegen\n- tools_auflisten → alle dynamischen Tools anzeigen\n- tool_loeschen → ein dynamisches Tool entfernen\n\nJedes Tool hat: tool.json (Schema) + run.js (Node.js) oder run.sh (Shell-Script)\nrun.js bekommt: args (Parameter), files() (Zusatzdateien lesen), fetch, console.log\nrun.sh bekommt: TOOL_ARG_* Umgebungsvariablen\n\n## Cron-Jobs / Heartbeat\nDu hast ein echtes Cron-System! Die Datei HEARTBEAT.md steuert es:\n- Cron-Expression ändern: agent_datei_schreiben mit datei='HEARTBEAT.md'\n- Format: 'Cron: */5 * * * *' (alle 5 Minuten) oder 'Cron: 0 8 * * *' (täglich 8 Uhr)\n- Änderungen sind SOFORT aktiv — kein Neustart nötig\n- Du musst KEINEN eigenen Timer bauen — das System macht das automatisch\n\n## Zuordnungs-Regeln (WICHTIG)\n- Enthält die Nachricht ein DATUM oder UHRZEIT → termin_speichern (nicht notiz_speichern)\n- Enthält die Nachricht ein TODO/Verb ("machen", "erledigen", "prüfen") → aufgabe_speichern\n- Alles andere → notiz_speichern\n- Im Zweifel: nachfragen statt falsch einordnen\n\n## Regeln\n- Nie doppelt speichern — zuerst suchen\n- Aufgaben immer mit konkretem Verb beginnen\n- Termine immer mit Datum im Format TT.MM.JJJJ\n- Bei Unsicherheit nachfragen statt raten\n`,
    "AGENTS.md": `# ${agentName} – Sub-Agents\n\nKeine Sub-Agents konfiguriert.\n`,
    "MEMORY.md": `# Memory – ${agentName}\n\nNoch keine dauerhaften Erkenntnisse.\n`,
    "HEARTBEAT.md": `# ${agentName} – Heartbeat\n\nCron: */30 8-20 * * 1-6\n\n## Aufgaben\nPrüfe ob es etwas Relevantes zu melden gibt:\n1. Termine die HEUTE anstehen (nutze termine_auflisten)\n2. Offene Aufgaben die überfällig oder dringend sind (nutze aufgaben_auflisten)\n3. Wichtige Erinnerungen aus MEMORY.md\n\n## Regeln\n- NUR melden wenn es etwas Konkretes gibt (Termin heute, überfällige Aufgabe)\n- Wenn NICHTS relevant ist: antworte exakt mit [STILL] — keine Nachricht wird gesendet\n- Kurz und knapp — maximal 3-5 Zeilen\n- Keine Floskeln, kein "Guten Morgen", direkt zur Sache\n- Termine: Uhrzeit + was ansteht\n- Aufgaben: nur überfällige oder heute fällige\n`,
  };

  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(agentDir, filename), content, "utf-8");
  }
}

export function inspectAgentWorkspace(agentName: string, mode: "full" | "minimal" = "full"): WorkspaceFileInfo[] {
  const agentDir = getAgentPath(agentName);
  const today = new Date().toISOString().slice(0, 10);

  const memDir = path.join(agentDir, VAULT_LOGS_DIR);
  let isFirstRun = !fs.existsSync(memDir);
  if (!isFirstRun) {
    try { isFirstRun = fs.readdirSync(memDir).filter(f => f.endsWith(".md")).length === 0; } catch { isFirstRun = true; }
  }

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
