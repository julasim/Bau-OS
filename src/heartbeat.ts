import fs from "fs";
import path from "path";
import cron from "node-cron";
import { getAgentPath, listAgents } from "./workspace/index.js";
import { TIMEZONE, CHAT_ID_FILE } from "./config.js";
import { logInfo, logError } from "./logger.js";

// ---- Chat-ID Persistenz ----

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
    if (!isNaN(id)) {
      _chatId = id;
      return id;
    }
  }
  return null;
}

// ---- HEARTBEAT.md Parser ----

interface HeartbeatConfig {
  cronExpression: string;
  prompt: string;
}

// Erlaubte Off-Marker fuer den Cron-Header. Wird absichtlich von User
// gesetzt um den Heartbeat eines Agenten stillzuhalten ohne die ganze
// HEARTBEAT.md zu loeschen (komfortabel fuer "spaeter wieder einschalten").
const HEARTBEAT_OFF_MARKERS = new Set(["disabled", "off", "none", "false", "no", "aus"]);

function parseHeartbeat(agentName: string): HeartbeatConfig | null {
  const hbPath = path.join(getAgentPath(agentName), "HEARTBEAT.md");
  if (!fs.existsSync(hbPath)) return null;

  const content = fs.readFileSync(hbPath, "utf-8");

  const cronMatch = content.match(/^Cron:\s*(.+)$/im);
  if (!cronMatch) return null;

  const cronExpression = cronMatch[1].trim();

  // Off-Marker silent behandeln — kein Error-Log, kein Cron-Job.
  if (HEARTBEAT_OFF_MARKERS.has(cronExpression.toLowerCase())) {
    return null;
  }

  if (!cron.validate(cronExpression)) {
    logError(`Heartbeat/${agentName}`, `Ungueltige Cron-Expression: "${cronExpression}"`);
    return null;
  }

  const aufgabenMatch = content.match(/##\s*Aufgaben[^\n]*\n([\s\S]+?)(?=##|$)/i);
  const prompt = aufgabenMatch ? aufgabenMatch[1].trim() : "Fuehre deinen Standard-Heartbeat durch.";

  return { cronExpression, prompt };
}

// ---- Heartbeat Runner ----

type ReplyFn = (chatId: number, text: string) => Promise<void>;

async function runHeartbeat(agentName: string, replyFn: ReplyFn): Promise<void> {
  const chatId = loadChatId();
  if (!chatId) {
    console.log(`[Heartbeat] ${agentName}: kein Chat-ID gespeichert, ueberspringe.`);
    return;
  }

  const config = parseHeartbeat(agentName);
  if (!config) return;

  logInfo(`[Heartbeat] ${agentName} gestartet`);

  try {
    const { processAgent } = await import("./llm/runtime.js");
    const antwort = await processAgent(agentName, config.prompt, "full", 0, "heartbeat");
    logInfo(`[Heartbeat] ${agentName} abgeschlossen`);

    // Stille-Modus: Agent antwortet mit [STILL] wenn nichts zu melden ist
    const trimmed = antwort.trim();
    if (trimmed.startsWith("[STILL]") || trimmed.toLowerCase() === "nichts zu melden.") {
      logInfo(`[Heartbeat] ${agentName}: nichts zu melden, ueberspringe Nachricht`);
      return;
    }

    await replyFn(chatId, `\u{1FAC0} ${agentName}:\n\n${antwort}`);
  } catch (err) {
    logError(`Heartbeat/${agentName}`, err);
  }
}

// ---- Scheduler ----

// Agents die bereits einen Cron-Job haben (verhindert Duplikate)
const _registeredAgents = new Set<string>();
// Agents bei denen wir wissen "kein Heartbeat" — verhindert dass der
// Meta-Cron jede Minute parseHeartbeat() neu aufruft und die Errors
// neu loggt. Wird via reloadHeartbeat() invalidiert wenn der User die
// HEARTBEAT.md aendert (live-reload).
const _knownNoHeartbeat = new Set<string>();
const _cronTasks = new Map<string, cron.ScheduledTask>();
let _replyFn: ReplyFn | null = null;

function registerAgentIfNeeded(agentName: string, replyFn: ReplyFn): boolean {
  if (_registeredAgents.has(agentName)) return false;
  if (_knownNoHeartbeat.has(agentName)) return false;

  const config = parseHeartbeat(agentName);
  if (!config) {
    // Einmal loggen, dann merken — sonst spamt der Meta-Cron jede Minute.
    logInfo(`[Heartbeat] ${agentName}: kein aktiver Cron — uebersprungen`);
    _knownNoHeartbeat.add(agentName);
    return false;
  }

  const task = cron.schedule(
    config.cronExpression,
    () => {
      runHeartbeat(agentName, replyFn).catch((err) => logError(`Heartbeat/cron/${agentName}`, err));
    },
    { timezone: TIMEZONE },
  );

  _cronTasks.set(agentName, task);
  _registeredAgents.add(agentName);
  logInfo(`[Heartbeat] ${agentName} registriert: "${config.cronExpression}"`);
  return true;
}

/** Live-Reload: Cron-Job eines Agenten aktualisieren (nach HEARTBEAT.md-Aenderung) */
export function reloadHeartbeat(agentName: string): string {
  const replyFn = _replyFn;
  if (!replyFn) return "Heartbeat nicht initialisiert (kein replyFn).";

  // Alten Job stoppen und entfernen
  const oldTask = _cronTasks.get(agentName);
  if (oldTask) {
    oldTask.stop();
    _cronTasks.delete(agentName);
    _registeredAgents.delete(agentName);
  }
  // Auch den "no-heartbeat"-Cache invalidieren, damit nach Reload eine
  // neu gesetzte Cron-Expression auch aktiv wird.
  _knownNoHeartbeat.delete(agentName);

  // Neuen Job registrieren
  const config = parseHeartbeat(agentName);
  if (!config) {
    logInfo(`[Heartbeat] ${agentName}: HEARTBEAT.md entfernt oder ungueltig — Cron gestoppt`);
    _knownNoHeartbeat.add(agentName);
    return `Heartbeat fuer ${agentName} deaktiviert (keine gueltige Cron-Expression).`;
  }

  const task = cron.schedule(
    config.cronExpression,
    () => {
      runHeartbeat(agentName, replyFn).catch((err) => logError(`Heartbeat/cron/${agentName}`, err));
    },
    { timezone: TIMEZONE },
  );

  _cronTasks.set(agentName, task);
  _registeredAgents.add(agentName);
  logInfo(`[Heartbeat] ${agentName} neu geladen: "${config.cronExpression}"`);
  return `Heartbeat fuer ${agentName} aktualisiert: "${config.cronExpression}"`;
}

export function startHeartbeat(replyFn: ReplyFn): void {
  _replyFn = replyFn;

  // Initial-Registrierung (Agents die beim Start schon existieren)
  for (const agentName of listAgents()) {
    registerAgentIfNeeded(agentName, replyFn);
  }

  if (_registeredAgents.size === 0) {
    logInfo("[Heartbeat] Keine Agents beim Start — Meta-Cron uebernimmt die Erkennung");
  } else {
    logInfo(`[Heartbeat] ${_registeredAgents.size} Cron-Job(s) registriert`);
  }

  // Meta-Cron: prueft jede Minute ob neue Agents hinzugekommen sind
  // Noetig weil Agents erst nach dem Setup-Wizard erstellt werden
  cron.schedule(
    "* * * * *",
    () => {
      let neu = 0;
      for (const agentName of listAgents()) {
        if (registerAgentIfNeeded(agentName, replyFn)) neu++;
      }
      if (neu > 0) logInfo(`[Heartbeat] ${neu} neue Cron-Job(s) nachregistriert`);
    },
    { timezone: TIMEZONE },
  );
}
