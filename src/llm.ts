import OpenAI from "openai";
import {
  saveNote, listNotes, readNote,
  saveTask, listTasks, completeTask,
  saveTermin, listTermine,
  createProject, listProjects, getProjectInfo,
  searchVault,
} from "./obsidian.js";

// ─── Client ──────────────────────────────────────────────────────────────────
// OpenAI-Package zeigt auf Ollama — gleiche API, anderer Server
const client = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
  apiKey: "ollama", // Ollama braucht keinen Key, aber das Feld ist Pflicht
});

const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

// ─── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Du bist Bau-OS, ein KI-Assistent für SIMA Architecture, ein österreichisches Architekturbüro.

Du hilfst bei:
- Notizen, Aufgaben und Termine verwalten
- Projektinformationen abrufen und speichern
- Im Vault suchen und Dateien lesen
- Fragen über laufende Projekte beantworten

Wichtige Regeln:
- Antworte immer auf Deutsch
- Halte Antworten kurz und präzise (wir sind in Telegram)
- Wenn du etwas speicherst, bestätige es kurz
- Wenn etwas unklar ist, frag nach
- Heute ist: ${new Date().toLocaleDateString("de-AT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;

// ─── Tool Definitionen ───────────────────────────────────────────────────────
// Das sind die "Werkzeuge" die der LLM aufrufen darf
const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "notiz_speichern",
      description: "Speichert eine Notiz im Obsidian Vault. Verwenden wenn jemand etwas notieren, festhalten oder aufschreiben möchte.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Inhalt der Notiz" },
          projekt: { type: "string", description: "Optionaler Projektname (z.B. 'Wohnbau-Linz')" },
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
  {
    type: "function",
    function: {
      name: "aufgabe_speichern",
      description: "Speichert eine neue Aufgabe / Todo. Verwenden wenn jemand etwas erledigen muss, eine Erinnerung möchte oder eine Aufgabe erwähnt.",
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
      description: "Listet alle offenen Aufgaben auf. Verwenden bei Fragen wie 'Was steht an?', 'Was muss ich noch tun?'",
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
  {
    type: "function",
    function: {
      name: "termin_speichern",
      description: "Speichert einen Termin. Verwenden wenn jemand einen Termin, Meeting oder eine Deadline erwähnt.",
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
      description: "Listet alle Termine auf. Verwenden bei Fragen wie 'Was steht diese Woche an?', 'Welche Termine habe ich?'",
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
      name: "vault_suchen",
      description: "Sucht nach einem Begriff in allen Notizen. Verwenden wenn jemand etwas sucht oder nach Informationen fragt.",
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
      description: "Zeigt Informationen zu einem bestimmten Projekt (Anzahl Notizen, Aufgaben, Termine).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name des Projekts" },
        },
        required: ["name"],
      },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────
// Führt den Tool-Aufruf des LLM tatsächlich aus
async function executeTool(name: string, args: Record<string, string | number>): Promise<string> {
  try {
    switch (name) {
      case "notiz_speichern": {
        const filepath = saveNote(String(args.text), args.projekt ? String(args.projekt) : undefined);
        const filename = filepath.split(/[\\/]/).pop();
        return `Notiz gespeichert: ${filename}`;
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
      default:
        return `Unbekanntes Tool: ${name}`;
    }
  } catch (err) {
    return `Fehler bei ${name}: ${err}`;
  }
}

// ─── Haupt-Funktion ───────────────────────────────────────────────────────────
export async function processMessage(userMessage: string): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  // Agentic Loop: LLM → Tool aufrufen → Ergebnis zurück → LLM → ...
  // Maximal 5 Runden damit es nicht endlos läuft
  for (let i = 0; i < 5; i++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const reply = response.choices[0].message;
    messages.push(reply);

    // Kein Tool-Aufruf → LLM ist fertig, Antwort zurückgeben
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      return reply.content ?? "Erledigt.";
    }

    // Tools ausführen und Ergebnisse zurück an LLM schicken
    for (const toolCall of reply.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments) as Record<string, string | number>;
      const result = await executeTool(toolCall.function.name, args);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  return "Ich konnte deine Anfrage nicht vollständig bearbeiten.";
}
