import fs from "fs";
import path from "path";
import { logInfo } from "../logger.js";
import { VAULT_LOGS_DIR } from "../config.js";
import {
  saveNote, listNotes, readNote, appendToNote, deleteNote,
  saveTask, listTasks, completeTask,
  saveTermin, listTermine, deleteTermin,
  listProjects, getProjectInfo,
  readFile, createFile, listFolder,
  searchVault,
  loadAgentHistory, appendAgentMemory,
  createAgentWorkspace, listAgents, getAgentPath, isProtectedAgent,
  readAgentFile, writeAgentFile,
} from "../vault/index.js";

// ---- Reply Context (set by bot.ts before each processMessage) ----

let _replyFn: ((text: string) => Promise<void>) | null = null;

export function setReplyContext(fn: (text: string) => Promise<void>): void {
  _replyFn = fn;
}

export function getReplyFn(): ((text: string) => Promise<void>) | null {
  return _replyFn;
}

// ---- Spawn Depth (set by runtime before each agent run) ----

let _currentDepth = 0;

export function setCurrentDepth(depth: number): void {
  _currentDepth = depth;
}

export function getCurrentDepth(): number {
  return _currentDepth;
}

// ---- Late-bound processAgent (avoids circular import with runtime) ----

let _processAgentFn: ((name: string, msg: string, mode: "full" | "minimal", depth: number) => Promise<string>) | null = null;

export function registerProcessAgent(fn: typeof _processAgentFn): void {
  _processAgentFn = fn;
}

// ---- Tool Executor ----

export async function executeTool(name: string, args: Record<string, string | number>): Promise<string> {
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
      case "notiz_loeschen": {
        const deleted = deleteNote(String(args.dateiname));
        return deleted ? `Notiz geloescht: ${deleted}` : "Notiz nicht gefunden.";
      }
      case "notiz_bearbeiten": {
        const ok = appendToNote(String(args.dateiname), String(args.text));
        return ok ? `Nachtrag gespeichert in: ${args.dateiname}` : "Notiz nicht gefunden.";
      }
      case "aufgabe_speichern": {
        saveTask(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return `Aufgabe gespeichert: ${args.text}`;
      }
      case "aufgaben_auflisten": {
        const tasks = listTasks(args.projekt ? String(args.projekt) : undefined);
        return tasks.length ? tasks.map(t => `\u2022 ${t}`).join("\n") : "Keine offenen Aufgaben.";
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
        return termine.length ? termine.map(t => `\u{1F4C5} ${t}`).join("\n") : "Keine Termine.";
      }
      case "termin_loeschen": {
        const ok = deleteTermin(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return ok ? `Termin geloescht: ${args.text}` : "Termin nicht gefunden.";
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
      case "vault_suchen": {
        const results = searchVault(String(args.suchbegriff), args.projekt ? String(args.projekt) : undefined);
        if (!results.length) return `Keine Treffer fuer "${args.suchbegriff}".`;
        return results.map(r => `\u{1F4C4} ${r.file}\n   ${r.line}`).join("\n\n");
      }
      case "projekte_auflisten": {
        const projects = listProjects();
        return projects.length ? projects.join("\n") : "Keine Projekte vorhanden.";
      }
      case "projekt_info": {
        const info = getProjectInfo(String(args.name));
        return info ?? "Projekt nicht gefunden.";
      }
      case "memory_speichern": {
        appendAgentMemory("Main", String(args.eintrag));
        return `In MEMORY.md gespeichert: ${args.eintrag}`;
      }
      case "agent_verlauf": {
        const history = loadAgentHistory(String(args.agent), 20);
        if (!history.length) return `Kein Verlauf fuer Agent "${args.agent}" heute.`;
        return history.map(h => `User: ${h.user}\n${args.agent}: ${h.assistant}`).join("\n\n---\n\n");
      }
      case "agent_aktiv": {
        const today = new Date().toISOString().slice(0, 10);
        const active = listAgents().filter(agentName => {
          const logPath = path.join(getAgentPath(agentName), VAULT_LOGS_DIR, `${today}.md`);
          return fs.existsSync(logPath);
        });
        return active.length
          ? `Heute aktive Agenten:\n${active.map(a => `\u2022 ${a}`).join("\n")}`
          : "Heute war noch kein Agent aktiv.";
      }
      case "agent_spawnen_async": {
        const agentName = String(args.agent);
        const aufgabe = String(args.aufgabe);
        const reply = _replyFn;
        const spawnDepth = _currentDepth + 1;

        setImmediate(async () => {
          try {
            const result = await _processAgentFn!(agentName, aufgabe, "minimal", spawnDepth);
            if (reply) await reply(`\u26A1 ${agentName}:\n\n${result}`);
          } catch (err) {
            if (reply) await reply(`\u26A0\uFE0F ${agentName} Fehler: ${err}`);
          }
        });

        return `${agentName}-Agent gestartet \u26A1 – Ergebnis kommt gleich.`;
      }
      case "agent_spawnen": {
        const result = await _processAgentFn!(String(args.agent), String(args.aufgabe), "minimal", _currentDepth + 1);
        return `[${args.agent}]: ${result}`;
      }
      case "agent_erstellen": {
        if (isProtectedAgent(String(args.name))) {
          return `"${args.name}" ist ein geschuetzter Agent und kann nicht ueberschrieben werden.`;
        }
        const soul = `# ${args.name}\n\n## Rolle\n${args.beschreibung}\n\n## Regeln\n- Antworte immer auf Deutsch\n- Sei praezise und fokussiert auf deine Aufgabe\n- Halte Antworten kurz\n`;
        createAgentWorkspace(String(args.name), soul);
        return `Agent "${args.name}" erstellt mit eigenem Workspace in Agents/${args.name}/`;
      }
      case "agenten_auflisten": {
        const agents = listAgents();
        return agents.length ? agents.join("\n") : "Keine Sub-Agenten vorhanden.";
      }
      case "agent_datei_lesen": {
        const content = readAgentFile(String(args.agent), String(args.datei));
        return content ?? `Datei "${args.datei}" fuer Agent "${args.agent}" nicht gefunden.`;
      }
      case "agent_datei_schreiben": {
        const ok = writeAgentFile(String(args.agent), String(args.datei), String(args.inhalt));
        return ok
          ? `\u2705 ${args.agent}/${args.datei} gespeichert.`
          : `Fehler: "${args.datei}" nicht erlaubt oder Agent-Ordner nicht vorhanden.`;
      }
      default:
        return `Unbekanntes Tool: ${name}`;
    }
  } catch (err) {
    return `Fehler bei ${name}: ${err}`;
  }
}
