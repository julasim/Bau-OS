import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { logInfo, logError } from "./logger.js";
import { OLLAMA_BASE_URL, DEFAULT_MODEL, FAST_MODEL, SUBAGENT_MODEL as SUBAGENT_MODEL_CFG, MAX_HISTORY_CHARS, MAX_TOOL_ROUNDS, MAX_SPAWN_DEPTH, LANGUAGE, LOCALE, getAgentModel } from "./config.js";
import {
  saveNote, listNotes, readNote, appendToNote, deleteNote,
  saveTask, listTasks, completeTask,
  saveTermin, listTermine, deleteTermin,
  createProject, listProjects, getProjectInfo,
  readFile, createFile, listFolder,
  searchVault,
  loadAgentWorkspace, appendAgentConversation, loadAgentHistory,
  createAgentWorkspace, listAgents, getAgentPath, appendAgentMemory, isProtectedAgent,
  shouldCompact, getLogForCompaction, writeCompactedLog,
  finalizeMainWorkspace,
  readAgentFile, writeAgentFile,
} from "./obsidian.js";
import { deactivateSetup } from "./setup.js";

// ─── Reply-Kontext für async Spawns ─────────────────────────────────────────
// Wird von bot.ts gesetzt bevor processMessage() aufgerufen wird
let _replyFn: ((text: string) => Promise<void>) | null = null;

export function setReplyContext(fn: (text: string) => Promise<void>): void {
  _replyFn = fn;
}

// ─── Client ──────────────────────────────────────────────────────────────────
const client = new OpenAI({
  baseURL: OLLAMA_BASE_URL,
  apiKey: "ollama",
});

let MODEL = DEFAULT_MODEL;
let _fastMode = false;

export function getModel(): string { return MODEL; }
export function getSubagentModel(): string { return SUBAGENT_MODEL_CFG; }
export function isFastMode(): boolean { return _fastMode; }

export function setModel(name: string): void {
  MODEL = name;
}

export function toggleFast(): boolean {
  _fastMode = !_fastMode;
  MODEL = _fastMode ? FAST_MODEL : DEFAULT_MODEL;
  return _fastMode;
}

// Basis-Prompt — wird durch den Agent-Workspace (SOUL.md etc.) ergänzt
const BASE_PROMPT = `Heute ist: ${new Date().toLocaleDateString(LOCALE, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
Antworte immer auf ${LANGUAGE}. Halte Antworten kurz (wir sind in Telegram).`;

// ─── Tool Definitionen ───────────────────────────────────────────────────────
const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  // Notizen
  {
    type: "function",
    function: {
      name: "notiz_speichern",
      description: "Speichert eine Notiz im Obsidian Vault.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Inhalt der Notiz" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notizen_auflisten",
      description: "Listet die letzten Notizen aus der Inbox auf.",
      parameters: {
        type: "object",
        properties: {
          anzahl: { type: "number", description: "Wie viele Notizen anzeigen (Standard: 5)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_lesen",
      description: "Liest den Inhalt einer bestimmten Notiz.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Name der Notiz-Datei" },
        },
        required: ["dateiname"],
      },
    },
  },
  // Aufgaben
  {
    type: "function",
    function: {
      name: "aufgabe_speichern",
      description: "Speichert eine neue Aufgabe / Todo.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Beschreibung der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgaben_auflisten",
      description: "Listet alle offenen Aufgaben auf.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Optional: nur Aufgaben eines Projekts" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgabe_erledigen",
      description: "Markiert eine Aufgabe als erledigt.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Exakter Text der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  // Termine
  {
    type: "function",
    function: {
      name: "termin_speichern",
      description: "Speichert einen Termin oder Meeting.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
          text: { type: "string", description: "Beschreibung des Termins" },
          uhrzeit: { type: "string", description: "Optional: Uhrzeit im Format HH:MM" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["datum", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termine_auflisten",
      description: "Listet alle Termine auf.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Optional: nur Termine eines Projekts" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termin_loeschen",
      description: "Löscht einen Termin aus der Terminliste.",
      parameters: {
        type: "object",
        properties: {
          text:    { type: "string", description: "Text oder Teiltext des Termins" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_loeschen",
      description: "Löscht eine Notiz dauerhaft aus dem Vault.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Name der Notiz-Datei" },
        },
        required: ["dateiname"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_bearbeiten",
      description: "Fügt einer bestehenden Notiz einen Nachtrag hinzu.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Name der Notiz-Datei" },
          text:      { type: "string", description: "Inhalt des Nachtrags" },
        },
        required: ["dateiname", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datei_lesen",
      description: "Liest eine beliebige Datei aus dem Vault (relativer Pfad).",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad im Vault, z.B. 'Projekte/Alpha/README.md'" },
        },
        required: ["pfad"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "datei_erstellen",
      description: "Erstellt eine neue Datei im Vault oder überschreibt eine bestehende.",
      parameters: {
        type: "object",
        properties: {
          pfad:   { type: "string", description: "Relativer Pfad im Vault" },
          inhalt: { type: "string", description: "Dateiinhalt" },
        },
        required: ["pfad", "inhalt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ordner_auflisten",
      description: "Listet den Inhalt eines Ordners im Vault auf.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad (leer = Vault-Wurzel)" },
        },
        required: [],
      },
    },
  },
  // Vault & Projekte
  {
    type: "function",
    function: {
      name: "vault_suchen",
      description: "Sucht nach einem Begriff in allen Notizen.",
      parameters: {
        type: "object",
        properties: {
          suchbegriff: { type: "string", description: "Der Suchbegriff" },
          projekt: { type: "string", description: "Optional: Suche auf ein Projekt begrenzen" },
        },
        required: ["suchbegriff"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "projekte_auflisten",
      description: "Listet alle vorhandenen Projekte auf.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_info",
      description: "Zeigt Informationen zu einem bestimmten Projekt.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name des Projekts" },
        },
        required: ["name"],
      },
    },
  },
  // Langzeitgedächtnis
  {
    type: "function",
    function: {
      name: "memory_speichern",
      description: "Speichert eine wichtige Information dauerhaft in der MEMORY.md des Agenten. Verwenden wenn: (1) Julius explizit sagt 'merk dir', 'vergiss nicht', 'speicher dauerhaft' o.ä., (2) eine Information für zukünftige Gespräche wichtig ist (Präferenzen, Projektdetails, Entscheidungen, Kontakte).",
      parameters: {
        type: "object",
        properties: {
          eintrag: { type: "string", description: "Die zu speichernde Information – prägnant formuliert (1-2 Sätze)" },
        },
        required: ["eintrag"],
      },
    },
  },
  // Agent-Sessions
  {
    type: "function",
    function: {
      name: "agent_verlauf",
      description: "Liest den heutigen Gesprächsverlauf eines anderen Agenten. Verwenden wenn gefragt wird was ein Sub-Agent zuletzt gemacht hat.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Agenten (z.B. 'Protokoll')" },
        },
        required: ["agent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_aktiv",
      description: "Listet alle Agenten auf die heute aktiv waren (einen Tageslog haben).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  // Multi-Agent
  {
    type: "function",
    function: {
      name: "agent_spawnen_async",
      description: "Startet einen Sub-Agenten non-blocking im Hintergrund. Sofortige Rückkehr – Ergebnis wird als separate Nachricht gepostet wenn fertig. Verwenden für längere Aufgaben (Protokoll, Recherche) die den User nicht warten lassen sollen.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Sub-Agenten" },
          aufgabe: { type: "string", description: "Aufgabenbeschreibung für den Sub-Agenten" },
        },
        required: ["agent", "aufgabe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_spawnen",
      description: "Startet einen Sub-Agenten und wartet auf das Ergebnis (blocking). Für kurze Aufgaben. Für längere Aufgaben agent_spawnen_async verwenden.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Sub-Agenten (z.B. 'Protokoll', 'Recherche')" },
          aufgabe: { type: "string", description: "Detaillierte Aufgabenbeschreibung für den Sub-Agenten" },
        },
        required: ["agent", "aufgabe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_erstellen",
      description: "Erstellt einen neuen Sub-Agenten mit eigenem Workspace (SOUL.md, USER.md, AGENTS.md, MEMORY.md, memory/).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name des neuen Agenten" },
          beschreibung: { type: "string", description: "Was dieser Agent tun soll (wird zu SOUL.md)" },
        },
        required: ["name", "beschreibung"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agenten_auflisten",
      description: "Listet alle verfügbaren Sub-Agenten auf.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  // Agent-Datei Editor
  {
    type: "function",
    function: {
      name: "agent_datei_lesen",
      description: "Liest eine Konfigurationsdatei eines Agenten (z.B. SOUL.md, HEARTBEAT.md, TOOLS.md).",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Agenten (z.B. 'Main', 'CEO')" },
          datei: { type: "string", description: "Dateiname (z.B. 'SOUL.md', 'HEARTBEAT.md')" },
        },
        required: ["agent", "datei"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_datei_schreiben",
      description: "Überschreibt eine Konfigurationsdatei eines Agenten. Erlaubte Dateien: SOUL.md, BOOT.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, USER.md, IDENTITY.md, MEMORY.md.",
      parameters: {
        type: "object",
        properties: {
          agent:  { type: "string", description: "Name des Agenten" },
          datei:  { type: "string", description: "Dateiname (muss in der Whitelist sein)" },
          inhalt: { type: "string", description: "Neuer vollständiger Inhalt der Datei" },
        },
        required: ["agent", "datei", "inhalt"],
      },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────
let _currentDepth = 0; // wird von processAgent gesetzt

async function executeTool(name: string, args: Record<string, string | number>): Promise<string> {
  try {
    switch (name) {
      case "notiz_speichern": {
        const filepath = saveNote(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return `Notiz gespeichert: ${filepath.split(/[\\/]/).pop()}`;
      }
      case "notizen_auflisten": {
        const notes = listNotes(Number(args.anzahl) || 5);
        return notes.length ? notes.join("\n") : "Keine Notizen gefunden.";
      }
      case "notiz_lesen": {
        const content = readNote(String(args.dateiname));
        return content ?? "Datei nicht gefunden.";
      }
      case "aufgabe_speichern": {
        saveTask(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return `Aufgabe gespeichert: ${args.text}`;
      }
      case "aufgaben_auflisten": {
        const tasks = listTasks(args.projekt ? String(args.projekt) : undefined);
        return tasks.length ? tasks.map(t => `• ${t}`).join("\n") : "Keine offenen Aufgaben.";
      }
      case "aufgabe_erledigen": {
        const ok = completeTask(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return ok ? `Erledigt: ${args.text}` : "Aufgabe nicht gefunden.";
      }
      case "termin_speichern": {
        saveTermin(String(args.datum), String(args.text), args.uhrzeit ? String(args.uhrzeit) : undefined, args.projekt ? String(args.projekt) : undefined);
        return `Termin gespeichert: ${args.datum} – ${args.text}`;
      }
      case "termine_auflisten": {
        const termine = listTermine(args.projekt ? String(args.projekt) : undefined);
        return termine.length ? termine.map(t => `📅 ${t}`).join("\n") : "Keine Termine.";
      }
      case "vault_suchen": {
        const results = searchVault(String(args.suchbegriff), args.projekt ? String(args.projekt) : undefined);
        if (!results.length) return `Keine Treffer für "${args.suchbegriff}".`;
        return results.map(r => `📄 ${r.file}\n   ${r.line}`).join("\n\n");
      }
      case "projekte_auflisten": {
        const projects = listProjects();
        return projects.length ? projects.join("\n") : "Keine Projekte vorhanden.";
      }
      case "projekt_info": {
        const info = getProjectInfo(String(args.name));
        return info ?? "Projekt nicht gefunden.";
      }
      // Langzeitgedächtnis
      case "memory_speichern": {
        appendAgentMemory("Main", String(args.eintrag));
        return `In MEMORY.md gespeichert: ${args.eintrag}`;
      }
      // Agent-Session Tools
      case "agent_verlauf": {
        const history = loadAgentHistory(String(args.agent), 20);
        if (!history.length) return `Kein Verlauf für Agent "${args.agent}" heute.`;
        return history.map(h => `User: ${h.user}\n${args.agent}: ${h.assistant}`).join("\n\n---\n\n");
      }
      case "agent_aktiv": {
        const today = new Date().toISOString().slice(0, 10);
        const active = listAgents().filter(name => {
          const logPath = `${getAgentPath(name)}/memory/${today}.md`;
          return fs.existsSync(logPath);
        });
        return active.length
          ? `Heute aktive Agenten:\n${active.map(a => `• ${a}`).join("\n")}`
          : "Heute war noch kein Agent aktiv.";
      }
      // Multi-Agent Tools
      case "agent_spawnen_async": {
        const agentName = String(args.agent);
        const aufgabe = String(args.aufgabe);
        const reply = _replyFn;
        const spawnDepth = _currentDepth + 1;

        setImmediate(async () => {
          try {
            const result = await processAgent(agentName, aufgabe, "minimal", spawnDepth);
            if (reply) await reply(`⚡ ${agentName}:\n\n${result}`);
          } catch (err) {
            if (reply) await reply(`⚠️ ${agentName} Fehler: ${err}`);
          }
        });

        return `${agentName}-Agent gestartet ⚡ – Ergebnis kommt gleich.`;
      }
      case "agent_spawnen": {
        const result = await processAgent(String(args.agent), String(args.aufgabe), "minimal", _currentDepth + 1);
        return `[${args.agent}]: ${result}`;
      }
      case "agent_erstellen": {
        if (isProtectedAgent(String(args.name))) {
          return `"${args.name}" ist ein geschützter Agent und kann nicht überschrieben werden.`;
        }
        const soul = `# ${args.name}\n\n## Rolle\n${args.beschreibung}\n\n## Regeln\n- Antworte immer auf Deutsch\n- Sei präzise und fokussiert auf deine Aufgabe\n- Halte Antworten kurz\n`;
        createAgentWorkspace(String(args.name), soul);
        return `Agent "${args.name}" erstellt mit eigenem Workspace in Agents/${args.name}/`;
      }
      case "agenten_auflisten": {
        const agents = listAgents();
        return agents.length ? agents.join("\n") : "Keine Sub-Agenten vorhanden.";
      }
      // Fehlende Vault-Tools
      case "termin_loeschen": {
        const ok = deleteTermin(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return ok ? `Termin gelöscht: ${args.text}` : "Termin nicht gefunden.";
      }
      case "notiz_loeschen": {
        const deleted = deleteNote(String(args.dateiname));
        return deleted ? `Notiz gelöscht: ${deleted}` : "Notiz nicht gefunden.";
      }
      case "notiz_bearbeiten": {
        const ok = appendToNote(String(args.dateiname), String(args.text));
        return ok ? `Nachtrag gespeichert in: ${args.dateiname}` : "Notiz nicht gefunden.";
      }
      case "datei_lesen": {
        const content = readFile(String(args.pfad));
        return content ?? `Datei nicht gefunden: ${args.pfad}`;
      }
      case "datei_erstellen": {
        const fp = createFile(String(args.pfad), String(args.inhalt));
        return `Datei erstellt: ${fp.split(/[\\/]/).pop()}`;
      }
      case "ordner_auflisten": {
        const entries = listFolder(args.pfad ? String(args.pfad) : "");
        return entries.length ? entries.join("\n") : "Ordner leer oder nicht gefunden.";
      }
      // Agent-Datei Editor
      case "agent_datei_lesen": {
        const content = readAgentFile(String(args.agent), String(args.datei));
        return content ?? `Datei "${args.datei}" für Agent "${args.agent}" nicht gefunden.`;
      }
      case "agent_datei_schreiben": {
        const ok = writeAgentFile(String(args.agent), String(args.datei), String(args.inhalt));
        return ok
          ? `✅ ${args.agent}/${args.datei} gespeichert.`
          : `Fehler: "${args.datei}" nicht erlaubt oder Agent-Ordner nicht vorhanden.`;
      }
      default:
        return `Unbekanntes Tool: ${name}`;
    }
  } catch (err) {
    return `Fehler bei ${name}: ${err}`;
  }
}

// ─── Agent Runtime ────────────────────────────────────────────────────────────
export async function processAgent(agentName: string, userMessage: string, mode: "full" | "minimal" = "full", depth = 0): Promise<string> {
  if (depth > MAX_SPAWN_DEPTH) return `[${agentName}] Maximale Spawn-Tiefe erreicht (depth=${depth}).`;
  _currentDepth = depth;
  const preview = userMessage.length > 80 ? userMessage.slice(0, 80) + "…" : userMessage;
  logInfo(`[${agentName}] Start — "${preview}"`);

  // Workspace laden — full: alle Dateien, minimal: nur IDENTITY + SOUL
  const workspaceContext = loadAgentWorkspace(agentName, mode);
  const systemPrompt = workspaceContext
    ? `${BASE_PROMPT}\n\n${workspaceContext}`
    : BASE_PROMPT;

  // Nur im full-Modus Gesprächshistorie laden (Sub-Agents brauchen sie nicht)
  const history = mode === "full" ? loadAgentHistory(agentName, 10) : [];

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.flatMap(h => [
      { role: "user" as const, content: h.user },
      { role: "assistant" as const, content: h.assistant },
    ]),
    { role: "user", content: userMessage },
  ];

  // Agentic Loop — max 5 Runden
  // Modell: minimal-Modus nutzt den Sub-Agent-Konfig, sonst per-Agent-Modell aus config.ts
  const activeModel = mode === "minimal" ? SUBAGENT_MODEL_CFG : getAgentModel(agentName);

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const response = await client.chat.completions.create({
      model: activeModel,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const reply = response.choices[0].message;
    messages.push(reply);

    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      const antwort = reply.content ?? "Erledigt.";
      appendAgentConversation(agentName, userMessage, antwort);
      logInfo(`[${agentName}] Antwort (Runde ${i + 1}, ${antwort.length} Z)`);
      // Compaction im Hintergrund — blockiert nicht
      if (shouldCompact(agentName)) runCompaction(agentName).catch(err => logError("Compaction", err));
      return antwort;
    }

    // Alle Tool-Calls parallel ausführen (wichtig für Multi-Agent)
    const toolNames = reply.tool_calls.map(tc => (tc as { function: { name: string } }).function.name).join(", ");
    logInfo(`[${agentName}] Tools (Runde ${i + 1}): ${toolNames}`);
    const toolResults = await Promise.all(
      reply.tool_calls.map(async (toolCall) => {
        const tc = toolCall as { id: string; function: { name: string; arguments: string } };
        const args = JSON.parse(tc.function.arguments) as Record<string, string | number>;
        const result = await executeTool(tc.function.name, args);
        return { role: "tool" as const, tool_call_id: tc.id, content: result };
      })
    );

    messages.push(...toolResults);

    // Pruning: wenn messages zu groß → alte Tool-Results entfernen
    // System-Prompt + letzte 3 Tool-Results + aktuelle User-Nachricht bleiben immer
    const totalChars = messages.reduce((s, m) => s + JSON.stringify(m).length, 0);
    if (totalChars > MAX_HISTORY_CHARS) {
      const systemMsg = messages[0];
      const toolMsgs = messages.filter(m => m.role === "tool");
      const nonToolMsgs = messages.filter(m => m.role !== "tool");
      // Nur die letzten 3 Tool-Results behalten
      const keptTools = toolMsgs.slice(-3);
      // Neu aufbauen: system + non-tool (ohne system) + letzte tool-results
      messages.splice(0, messages.length,
        systemMsg,
        ...nonToolMsgs.slice(1),
        ...keptTools
      );
    }
  }

  const fallback = "Ich konnte deine Anfrage nicht vollständig bearbeiten.";
  appendAgentConversation(agentName, userMessage, fallback);
  logInfo(`[${agentName}] Fallback nach ${MAX_TOOL_ROUNDS} Runden`);
  if (shouldCompact(agentName)) runCompaction(agentName).catch(err => logError("Compaction", err));
  return fallback;
}

// ─── Compaction ──────────────────────────────────────────────────────────────
// Läuft im Hintergrund nach dem Antworten — blockiert den User nicht
async function runCompaction(agentName: string): Promise<void> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return;
  logInfo(`[${agentName}] Compaction gestartet`);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{
      role: "user",
      content: `Fasse diese Gesprächseinträge in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${toSummarize}`,
    }],
  });

  const summary = response.choices[0].message.content ?? "";
  if (summary) {
    writeCompactedLog(agentName, summary);
    logInfo(`[${agentName}] Compaction abgeschlossen`);
  }
}

// Manueller Compaction-Trigger (für /kompakt Befehl)
export async function compactNow(agentName: string): Promise<string> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return "Tageslog ist noch klein – kein Komprimieren nötig.";

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{
      role: "user",
      content: `Fasse diese Gesprächseinträge in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${toSummarize}`,
    }],
  });

  const summary = response.choices[0].message.content ?? "";
  if (!summary) return "Zusammenfassung fehlgeschlagen.";

  writeCompactedLog(agentName, summary);
  return `✅ Log komprimiert.\n\nZusammenfassung:\n${summary}`;
}

// btw-Modus: geht ans LLM aber wird NICHT ins Tages-Log geschrieben
export async function processBtw(userMessage: string): Promise<string> {
  // minimal: kein AGENTS.md → LLM versucht nicht Sub-Agents zu spawnen
  const workspaceContext = loadAgentWorkspace("Main", "minimal");
  const systemPrompt = workspaceContext ? `${BASE_PROMPT}\n\n${workspaceContext}` : BASE_PROMPT;

  // Keine Tools — direkte Antwort, kein Vault-Zugriff, kein Spawnen
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices[0].message.content ?? "Erledigt.";
}

// Alle Telegram-Nachrichten laufen durch den Main Agent
export const processMessage = (msg: string) => processAgent("Main", msg);

// ─── Erststart Setup ─────────────────────────────────────────────────────────

function loadBootstrapPrompt(): string {
  const bootstrapPath = path.join(
    process.env.VAULT_PATH!,
    "Agents", "Main", "BOOTSTRAP.md"
  );
  if (fs.existsSync(bootstrapPath)) {
    return fs.readFileSync(bootstrapPath, "utf-8").trim();
  }
  // Fallback falls Datei fehlt
  return "Du bist ein Einrichtungsassistent. Frage nach Name, Emoji, Charakter, Unternehmenskontext, Benutzername und Unternehmensname. Dann rufe setup_abschliessen auf.";
}

const SETUP_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "setup_abschliessen",
    description: "Schließt die Ersteinrichtung ab und speichert alle Konfigurationen.",
    parameters: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Name des Assistenten" },
        emoji:       { type: "string", description: "Emoji des Assistenten" },
        vibe:        { type: "string", description: "Charakter/Vibe des Assistenten" },
        context:     { type: "string", description: "Beschreibung des Unternehmens" },
        userName:    { type: "string", description: "Name des Benutzers" },
        userCompany: { type: "string", description: "Name des Unternehmens" },
      },
      required: ["name", "emoji", "vibe", "context", "userName", "userCompany"],
    },
  },
};

// Gesprächshistorie für Setup (bleibt im Speicher bis Setup abgeschlossen)
let _setupMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

export async function processSetup(userMessage: string): Promise<string> {
  // Ersten Start: BOOTSTRAP.md als System-Prompt laden
  if (_setupMessages.length === 0) {
    _setupMessages = [{ role: "system", content: loadBootstrapPrompt() }];
  }

  _setupMessages.push({ role: "user", content: userMessage });

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: _setupMessages,
    tools: [SETUP_TOOL],
    tool_choice: "auto",
  });

  const reply = response.choices[0].message;
  _setupMessages.push(reply);

  // LLM hat setup_abschliessen aufgerufen
  if (reply.tool_calls?.length) {
    const call = reply.tool_calls[0] as { id: string; function: { name: string; arguments: string } };
    const args = JSON.parse(call.function.arguments) as {
      name: string; emoji: string; vibe: string;
      context: string; userName: string; userCompany: string;
    };

    finalizeMainWorkspace(args);
    deactivateSetup();
    _setupMessages = []; // aufräumen

    const confirmation = `✅ Eingerichtet!\n\n${args.emoji} ${args.name}\n${args.vibe}\n\nHallo ${args.userName}! Ich bin bereit — was kann ich für ${args.userCompany} tun?`;

    // Tool-Result zurückgeben damit LLM nicht hängt (kein zweiter Request nötig)
    return confirmation;
  }

  return reply.content ?? "...";
}
