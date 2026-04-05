import OpenAI from "openai";
import {
  saveNote, listNotes, readNote,
  saveTask, listTasks, completeTask,
  saveTermin, listTermine,
  createProject, listProjects, getProjectInfo,
  searchVault,
  loadAgentWorkspace, appendAgentConversation, loadAgentHistory,
  createAgentWorkspace, listAgents,
  shouldCompact, getLogForCompaction, writeCompactedLog,
} from "./obsidian.js";

// ─── Client ──────────────────────────────────────────────────────────────────
const client = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
  apiKey: "ollama",
});

const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

// Basis-Prompt — wird durch den Agent-Workspace (SOUL.md etc.) ergänzt
const BASE_PROMPT = `Heute ist: ${new Date().toLocaleDateString("de-AT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
Antworte immer auf Deutsch. Halte Antworten kurz (wir sind in Telegram).`;

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
  // Multi-Agent
  {
    type: "function",
    function: {
      name: "agent_spawnen",
      description: "Startet einen spezialisierten Sub-Agenten für eine Aufgabe. Verwenden wenn spezialisiertes Wissen nötig ist (z.B. Protokoll, Recherche) oder mehrere Aufgaben parallel erledigt werden sollen.",
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
];

// ─── Tool Executor ────────────────────────────────────────────────────────────
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
      // Multi-Agent Tools
      case "agent_spawnen": {
        // Sub-Agents laufen im "minimal"-Modus: nur IDENTITY + SOUL, keine History
        const result = await processAgent(String(args.agent), String(args.aufgabe), "minimal");
        return `[${args.agent}]: ${result}`;
      }
      case "agent_erstellen": {
        const soul = `# ${args.name}\n\n## Rolle\n${args.beschreibung}\n\n## Regeln\n- Antworte immer auf Deutsch\n- Sei präzise und fokussiert auf deine Aufgabe\n- Halte Antworten kurz\n`;
        createAgentWorkspace(String(args.name), soul);
        return `Agent "${args.name}" erstellt mit eigenem Workspace in Agents/${args.name}/`;
      }
      case "agenten_auflisten": {
        const agents = listAgents();
        return agents.length ? agents.join("\n") : "Keine Sub-Agenten vorhanden.";
      }
      default:
        return `Unbekanntes Tool: ${name}`;
    }
  } catch (err) {
    return `Fehler bei ${name}: ${err}`;
  }
}

// ─── Agent Runtime ────────────────────────────────────────────────────────────
export async function processAgent(agentName: string, userMessage: string, mode: "full" | "minimal" = "full"): Promise<string> {
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
  for (let i = 0; i < 5; i++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const reply = response.choices[0].message;
    messages.push(reply);

    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      const antwort = reply.content ?? "Erledigt.";
      appendAgentConversation(agentName, userMessage, antwort);
      // Compaction im Hintergrund — blockiert nicht
      if (shouldCompact(agentName)) runCompaction(agentName).catch(console.error);
      return antwort;
    }

    // Alle Tool-Calls parallel ausführen (wichtig für Multi-Agent)
    const toolResults = await Promise.all(
      reply.tool_calls.map(async (toolCall) => {
        const args = JSON.parse(toolCall.function.arguments) as Record<string, string | number>;
        const result = await executeTool(toolCall.function.name, args);
        return { role: "tool" as const, tool_call_id: toolCall.id, content: result };
      })
    );

    messages.push(...toolResults);
  }

  const fallback = "Ich konnte deine Anfrage nicht vollständig bearbeiten.";
  appendAgentConversation(agentName, userMessage, fallback);
  if (shouldCompact(agentName)) runCompaction(agentName).catch(console.error);
  return fallback;
}

// ─── Compaction ──────────────────────────────────────────────────────────────
// Läuft im Hintergrund nach dem Antworten — blockiert den User nicht
async function runCompaction(agentName: string): Promise<void> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{
      role: "user",
      content: `Fasse diese Gesprächseinträge in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${toSummarize}`,
    }],
  });

  const summary = response.choices[0].message.content ?? "";
  if (summary) writeCompactedLog(agentName, summary);
}

// Alle Telegram-Nachrichten laufen durch den BauOS Main-Agent
export const processMessage = (msg: string) => processAgent("BauOS", msg);
