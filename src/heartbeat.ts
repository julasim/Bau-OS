import fs from "fs";
import path from "path";
import cron from "node-cron";
import { getAgentPath, listAgents } from "./obsidian.js";
import { TIMEZONE, CHAT_ID_FILE } from "./config.js";
import { logInfo, logError } from "./logger.js";

// ─── Chat-ID Persistenz ───────────────────────────────────────────────────────

let _chatId: number | null = null;

export function saveChatId(id: number): void {
  if (_chatId === id) return;
  _chatId = id;
  fs.writeFileSync(CHAT_ID_FILE, String(id), "utf-8");
}

export function loadChatId(): number | null {
  if (_chatId) return _chatId;
  if (fs.existsSync(CHAT_ID_FILE)) {
    const raw = fs.readFileSync(CHAT_ID_FILE, "utf-8").trim();
    const id = parseInt(raw);
    if (!isNaN(id)) { _chatId = id; return id; }
  }
  return null;
}

// ─── HEARTBEAT.md Parser ──────────────────────────────────────────────────────

interface HeartbeatConfig {
  cronExpression: string;
  prompt: string;
}

function parseHeartbeat(agentName: string): HeartbeatConfig | null {
  const hbPath = path.join(getAgentPath(agentName), "HEARTBEAT.md");
  if (!fs.existsSync(hbPath)) return null;

  const content = fs.readFileSync(hbPath, "utf-8");

  // Cron-Expression parsen: "Cron: 0 8 * * *"
  // Kommentarzeilen (# ...) werden ignoriert
  const cronMatch = content.match(/^Cron:\s*(.+)$/im);
  if (!cronMatch) return null;

  const cronExpression = cronMatch[1].trim();
  if (!cron.validate(cronExpression)) {
    console.warn(`[Heartbeat] Ungültige Cron-Expression für ${agentName}: "${cronExpression}"`);
    return null;
  }

  // Aufgaben-Abschnitt extrahieren
  const aufgabenMatch = content.match(/##\s*Aufgaben[^\n]*\n([\s\S]+?)(?=##|$)/i);
  const prompt = aufgabenMatch
    ? aufgabenMatch[1].trim()
    : "Führe deinen Standard-Heartbeat durch.";

  return { cronExpression, prompt };
}

// ─── Heartbeat Runner ─────────────────────────────────────────────────────────

type ReplyFn = (chatId: number, text: string) => Promise<void>;

async function runHeartbeat(agentName: string, replyFn: ReplyFn): Promise<void> {
  const chatId = loadChatId();
  if (!chatId) {
    console.log(`[Heartbeat] ${agentName}: kein Chat-ID gespeichert, überspringe.`);
    return;
  }

  const config = parseHeartbeat(agentName);
  if (!config) return;

  logInfo(`[Heartbeat] ${agentName} gestartet`);

  try {
    const { processAgent } = await import("./llm.js");
    const antwort = await processAgent(agentName, config.prompt, "full");
    logInfo(`[Heartbeat] ${agentName} abgeschlossen`);
    await replyFn(chatId, `🫀 ${agentName}:\n\n${antwort}`);
  } catch (err) {
    logError(`Heartbeat/${agentName}`, err);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
// Für jeden Agent wird ein eigener Cron-Job registriert.
// Ändert sich HEARTBEAT.md → Bot neu starten um neuen Zeitplan zu laden.

export function startHeartbeat(replyFn: ReplyFn): void {
  const agents = listAgents();
  let registered = 0;

  for (const agentName of agents) {
    const config = parseHeartbeat(agentName);
    if (!config) continue;

    cron.schedule(config.cronExpression, () => {
      runHeartbeat(agentName, replyFn).catch(err => logError(`Heartbeat/cron/${agentName}`, err));
    }, {
      timezone: TIMEZONE,
    });

    logInfo(`[Heartbeat] ${agentName} registriert: "${config.cronExpression}"`);
    registered++;
  }

  if (registered === 0) {
    logInfo("[Heartbeat] Keine Agents mit Cron-Konfiguration.");
  } else {
    logInfo(`[Heartbeat] ${registered} Cron-Job(s) registriert`);
  }
}
