import fs from "fs";
import path from "path";
import { getAgentPath, listAgents } from "./obsidian.js";

// ─── Chat-ID Persistenz ───────────────────────────────────────────────────────
// Wird beim ersten eingehenden Message gesetzt damit Heartbeat weiß wohin senden

let _chatId: number | null = null;
const CHAT_ID_FILE = path.join(process.cwd(), ".chat_id");

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
  times: string[];   // ["08:00", "18:00"]
  prompt: string;    // Aufgaben-Text für den Agent
}

function parseHeartbeat(agentName: string): HeartbeatConfig | null {
  const hbPath = path.join(getAgentPath(agentName), "HEARTBEAT.md");
  if (!fs.existsSync(hbPath)) return null;

  const content = fs.readFileSync(hbPath, "utf-8");

  // Zeitplan parsen: "Täglich: 08:00, 18:00"
  const zeitplanMatch = content.match(/##\s*Zeitplan\s*\n([^\n#]+)/i);
  if (!zeitplanMatch) return null;

  const zeitplanLine = zeitplanMatch[1].trim();
  const timeMatches = zeitplanLine.match(/\d{1,2}:\d{2}/g);
  if (!timeMatches || timeMatches.length === 0) return null;

  // Aufgaben-Abschnitt extrahieren
  const aufgabenMatch = content.match(/##\s*Aufgaben[^\n]*\n([\s\S]+?)(?=##|$)/i);
  const prompt = aufgabenMatch
    ? aufgabenMatch[1].trim()
    : "Führe deinen Standard-Heartbeat durch.";

  return { times: timeMatches, prompt };
}

// ─── Heartbeat Runner ─────────────────────────────────────────────────────────

type ReplyFn = (chatId: number, text: string) => Promise<void>;

let _lastRun: Record<string, string> = {}; // agentName → "HH:MM YYYY-MM-DD"

async function runHeartbeat(agentName: string, replyFn: ReplyFn): Promise<void> {
  const config = parseHeartbeat(agentName);
  if (!config) return;

  const chatId = loadChatId();
  if (!chatId) return; // Kein User hat sich noch gemeldet

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const today = now.toISOString().slice(0, 10);
  const runKey = `${agentName}-${hhmm}-${today}`;

  // Nur einmal pro Minute + Zeit ausführen
  if (!config.times.includes(hhmm)) return;
  if (_lastRun[agentName] === runKey) return;
  _lastRun[agentName] = runKey;

  console.log(`[Heartbeat] ${agentName} um ${hhmm}`);

  try {
    const { processAgent } = await import("./llm.js");
    const antwort = await processAgent(agentName, config.prompt, "full");
    await replyFn(chatId, `🫀 ${agentName}:\n\n${antwort}`);
  } catch (err) {
    console.error(`[Heartbeat] Fehler bei ${agentName}:`, err);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startHeartbeat(replyFn: ReplyFn): void {
  // Jede Minute prüfen
  setInterval(async () => {
    const agents = listAgents();
    for (const agent of agents) {
      await runHeartbeat(agent, replyFn);
    }
  }, 60_000);

  console.log("Heartbeat-Scheduler gestartet (prüft jede Minute).");
}
