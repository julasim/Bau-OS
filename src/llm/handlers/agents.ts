import type OpenAI from "openai";
import fs from "fs";
import path from "path";
import {
  loadAgentHistory,
  appendAgentMemory,
  createAgentWorkspace,
  listAgents,
  getAgentPath,
  isProtectedAgent,
  readAgentFile,
  writeAgentFile,
} from "../../workspace/index.js";
import { WORKSPACE_LOGS_DIR } from "../../config.js";
import { getReplyFn, getCurrentDepth, getProcessAgentFn } from "../context.js";
import type { HandlerMap } from "./types.js";

export const agentSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "memory_speichern",
      description:
        "Speichert eine wichtige Information dauerhaft in der MEMORY.md des Agenten. Verwenden wenn: (1) Julius explizit sagt 'merk dir', 'vergiss nicht', 'speicher dauerhaft' o.ae., (2) eine Information fuer zukuenftige Gespraeche wichtig ist (Praeferenzen, Projektdetails, Entscheidungen, Kontakte).",
      parameters: {
        type: "object",
        properties: {
          eintrag: {
            type: "string",
            description: "Die zu speichernde Information – praegnant formuliert (1-2 Saetze)",
          },
        },
        required: ["eintrag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_verlauf",
      description:
        "Liest den heutigen Gespraechsverlauf eines Agenten (User-Nachrichten und Agent-Antworten). Zeigt die letzten 20 Eintraege. Nuetzlich um zu sehen was ein Sub-Agent heute bereits bearbeitet hat.",
      parameters: {
        type: "object",
        properties: { agent: { type: "string", description: "Name des Agenten (z.B. 'Protokoll')" } },
        required: ["agent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_aktiv",
      description:
        "Listet alle Agenten auf die heute aktiv waren (mindestens einen Tageslog-Eintrag haben). Zeigt nur die Namen — fuer Details agent_verlauf verwenden.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_spawnen_async",
      description:
        "Startet einen Sub-Agenten non-blocking im Hintergrund. Du bekommst sofort eine Bestaetigung — das Ergebnis kommt als separate Telegram-Nachricht. Ideal fuer laengere Aufgaben (Recherche, Analyse). Der Sub-Agent hat eigenen Workspace aber die gleichen Tools.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Sub-Agenten" },
          aufgabe: { type: "string", description: "Aufgabenbeschreibung fuer den Sub-Agenten" },
        },
        required: ["agent", "aufgabe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_spawnen",
      description:
        "Startet einen Sub-Agenten und wartet auf das Ergebnis (blocking). Das Ergebnis wird direkt zurueckgegeben. Fuer kurze Aufgaben die in wenigen Sekunden fertig sind. Fuer laengere Aufgaben agent_spawnen_async verwenden.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Sub-Agenten (z.B. 'Protokoll', 'Recherche')" },
          aufgabe: { type: "string", description: "Detaillierte Aufgabenbeschreibung fuer den Sub-Agenten" },
        },
        required: ["agent", "aufgabe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_erstellen",
      description:
        "Erstellt einen neuen Sub-Agenten mit eigenem Workspace (SOUL.md, BOOT.md, TOOLS.md etc.). Die Beschreibung wird zu SOUL.md — definiere hier Rolle, Aufgabenbereich und Verhalten. Geschuetzte Agenten (z.B. Main) koennen nicht ueberschrieben werden.",
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
      description:
        "Listet alle verfuegbaren Agenten auf (Ordner unter Agents/). Zeigt sowohl geschuetzte Agenten (Main) als auch selbst erstellte Sub-Agenten.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "agent_datei_lesen",
      description:
        "Liest eine Konfigurationsdatei eines Agenten (SOUL.md, BOOT.md, HEARTBEAT.md, TOOLS.md, MEMORY.md etc.). Damit kannst du die Konfiguration und Persoenlichkeit eines Agenten einsehen.",
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
      description:
        "Ueberschreibt eine Konfigurationsdatei eines Agenten vollstaendig. Erlaubte Dateien: SOUL.md, BOOT.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, USER.md, IDENTITY.md, MEMORY.md. Bei HEARTBEAT.md wird der Cron-Job sofort aktualisiert — kein Neustart noetig.",
      parameters: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Name des Agenten" },
          datei: { type: "string", description: "Dateiname (muss in der Whitelist sein)" },
          inhalt: { type: "string", description: "Neuer vollstaendiger Inhalt der Datei" },
        },
        required: ["agent", "datei", "inhalt"],
      },
    },
  },
];

export const agentHandlers: HandlerMap = {
  memory_speichern: async (args) => {
    appendAgentMemory("Main", String(args.eintrag));
    return `In MEMORY.md gespeichert: ${args.eintrag}`;
  },

  agent_verlauf: async (args) => {
    const history = loadAgentHistory(String(args.agent), 20);
    if (!history.length)
      return `Kein Verlauf fuer Agent "${args.agent}" heute. Nutze agenten_auflisten um aktive Agenten zu sehen, oder agent_aktiv fuer heute aktive.`;
    return history.map((h) => `User: ${h.user}\n${args.agent}: ${h.assistant}`).join("\n\n---\n\n");
  },

  agent_aktiv: async () => {
    const today = new Date().toISOString().slice(0, 10);
    const active = listAgents().filter((agentName) => {
      const logPath = path.join(getAgentPath(agentName), WORKSPACE_LOGS_DIR, `${today}.md`);
      return fs.existsSync(logPath);
    });
    return active.length
      ? `Heute aktive Agenten:\n${active.map((a) => `\u2022 ${a}`).join("\n")}`
      : "Heute war noch kein Agent aktiv.";
  },

  agent_spawnen_async: async (args) => {
    const agentName = String(args.agent);
    const aufgabe = String(args.aufgabe);
    const reply = getReplyFn();
    const spawnDepth = getCurrentDepth() + 1;
    const processAgent = getProcessAgentFn()!;

    setImmediate(async () => {
      try {
        const result = await processAgent(agentName, aufgabe, "minimal", spawnDepth);
        if (reply) await reply(`\u26A1 ${agentName}:\n\n${result}`);
      } catch (err) {
        if (reply) await reply(`\u26A0\uFE0F ${agentName} Fehler: ${err}`);
      }
    });

    return `${agentName}-Agent gestartet \u26A1 – Ergebnis kommt gleich.`;
  },

  agent_spawnen: async (args) => {
    const processAgent = getProcessAgentFn()!;
    const result = await processAgent(String(args.agent), String(args.aufgabe), "minimal", getCurrentDepth() + 1);
    return `[${args.agent}]: ${result}`;
  },

  agent_erstellen: async (args) => {
    if (isProtectedAgent(String(args.name))) {
      return `"${args.name}" ist ein geschuetzter Agent und kann nicht ueberschrieben werden.`;
    }
    const soul = `# ${args.name}\n\n## Rolle\n${args.beschreibung}\n\n## Regeln\n- Antworte immer auf Deutsch\n- Sei praezise und fokussiert auf deine Aufgabe\n- Halte Antworten kurz\n`;
    createAgentWorkspace(String(args.name), soul);
    return `Agent "${args.name}" erstellt mit eigenem Workspace in Agents/${args.name}/`;
  },

  agenten_auflisten: async () => {
    const agents = listAgents();
    return agents.length ? agents.join("\n") : "Keine Sub-Agenten vorhanden.";
  },

  agent_datei_lesen: async (args) => {
    const content = readAgentFile(String(args.agent), String(args.datei));
    return content ?? `Datei "${args.datei}" fuer Agent "${args.agent}" nicht gefunden.`;
  },

  agent_datei_schreiben: async (args) => {
    const ok = writeAgentFile(String(args.agent), String(args.datei), String(args.inhalt));
    if (!ok) return `Fehler: "${args.datei}" nicht erlaubt oder Agent-Ordner nicht vorhanden.`;

    if (String(args.datei).toUpperCase() === "HEARTBEAT.MD") {
      const { reloadHeartbeat } = await import("../../heartbeat.js");
      const reload = reloadHeartbeat(String(args.agent));
      return `\u2705 ${args.agent}/${args.datei} gespeichert. ${reload}`;
    }

    return `\u2705 ${args.agent}/${args.datei} gespeichert.`;
  },
};
