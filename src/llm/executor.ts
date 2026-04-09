import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { logInfo, logError } from "../logger.js";
import { VAULT_LOGS_DIR } from "../config.js";
import {
  saveNote, listNotes, readNote, appendToNote, deleteNote,
  saveTask, listTasks, completeTask,
  saveTermin, listTermine, deleteTermin,
  listProjects, getProjectInfo,
  readFile, createFile, listFolder,
  editFile, globFiles, grepFiles,
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
        return content ?? `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
      }
      case "notiz_loeschen": {
        const deleted = deleteNote(String(args.dateiname));
        return deleted ? `Notiz geloescht: ${deleted}` : `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
      }
      case "notiz_bearbeiten": {
        const ok = appendToNote(String(args.dateiname), String(args.text));
        return ok ? `Nachtrag gespeichert in: ${args.dateiname}` : `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
      }
      case "aufgabe_speichern": {
        saveTask(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return `Aufgabe gespeichert: ${args.text}`;
      }
      case "aufgaben_auflisten": {
        const tasks = listTasks(args.projekt ? String(args.projekt) : undefined);
        const open = tasks.filter(t => t.status !== "done");
        return open.length
          ? open.map(t => `\u2022 ${t.text}${t.assignee ? ` (@${t.assignee})` : ""}${t.date ? ` [${t.date}]` : ""}`).join("\n")
          : "Keine offenen Aufgaben.";
      }
      case "aufgabe_erledigen": {
        const ok = completeTask(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return ok ? `Erledigt: ${args.text}` : `Aufgabe nicht gefunden: "${args.text}". Der Text muss exakt uebereinstimmen — nutze aufgaben_auflisten um den genauen Text zu sehen.`;
      }
      case "termin_speichern": {
        saveTermin(String(args.datum), String(args.text), args.uhrzeit ? String(args.uhrzeit) : undefined, args.projekt ? String(args.projekt) : undefined);
        return `Termin gespeichert: ${args.datum} – ${args.text}`;
      }
      case "termine_auflisten": {
        const termine = listTermine(args.projekt ? String(args.projekt) : undefined);
        return termine.length
          ? termine.map(t => `\u{1F4C5} ${t.datum}${t.uhrzeit ? ` ${t.uhrzeit}` : ""} – ${t.text}${t.location ? ` (${t.location})` : ""}`).join("\n")
          : "Keine Termine.";
      }
      case "termin_loeschen": {
        const ok = deleteTermin(String(args.text), args.projekt ? String(args.projekt) : undefined);
        return ok ? `Termin geloescht: ${args.text}` : `Termin "${args.text}" nicht gefunden. Nutze termine_auflisten um den genauen Text zu sehen.`;
      }
      case "datei_lesen": {
        const content = readFile(String(args.pfad));
        return content ?? `Datei nicht gefunden: ${args.pfad}. Nutze dateien_suchen oder ordner_auflisten um den richtigen Pfad zu finden.`;
      }
      case "datei_erstellen": {
        const fp = createFile(String(args.pfad), String(args.inhalt));
        return `Datei erstellt: ${fp.split(/[\\/]/).pop()}`;
      }
      case "ordner_auflisten": {
        const entries = listFolder(args.pfad ? String(args.pfad) : "");
        return entries.length ? entries.join("\n") : `Ordner "${args.pfad || '/'}" leer oder nicht gefunden. Nutze ordner_auflisten ohne Pfad fuer die Vault-Wurzel.`;
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
        if (!info) return `Projekt "${args.name}" nicht gefunden. Nutze projekte_auflisten um alle verfuegbaren Projektnamen zu sehen.`;
        return `Projekt: ${info.name}\n\nNotizen: ${info.notes}\nOffene Aufgaben: ${info.openTasks}\nTermine: ${info.termine}`;
      }
      case "memory_speichern": {
        appendAgentMemory("Main", String(args.eintrag));
        return `In MEMORY.md gespeichert: ${args.eintrag}`;
      }
      case "agent_verlauf": {
        const history = loadAgentHistory(String(args.agent), 20);
        if (!history.length) return `Kein Verlauf fuer Agent "${args.agent}" heute. Nutze agenten_auflisten um aktive Agenten zu sehen, oder agent_aktiv fuer heute aktive.`;
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
      case "befehl_ausfuehren": {
        const cmd = String(args.befehl).trim();
        // Sicherheit: destruktive Befehle blockieren
        const blocked = /(\brm\s+-rf\b|\bshutdown\b|\breboot\b|\bpoweroff\b|\bmkfs\b|\bdd\s+if=|\b>\s*\/dev\/|\bsudo\s+(rm|shutdown|reboot|mkfs|dd|poweroff))/i;
        if (blocked.test(cmd)) return "Befehl blockiert — destruktive Befehle sind nicht erlaubt.";

        const cwd = args.verzeichnis ? String(args.verzeichnis) : process.cwd();
        const timeoutMs = Math.min((Number(args.timeout) || 15), 60) * 1000;

        return new Promise<string>((resolve) => {
          exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024, cwd, env: { ...process.env, LANG: "de_AT.UTF-8" } }, (error, stdout, stderr) => {
            if (error) {
              if (error.killed) resolve(`Befehl abgebrochen (Timeout nach ${timeoutMs / 1000}s): ${cmd}`);
              else resolve(`Fehler: ${stderr || error.message}`);
              return;
            }
            const output = (stdout + (stderr ? `\n[stderr] ${stderr}` : "")).trim();
            resolve(output.length > 8000 ? output.slice(0, 8000) + `\n\n[... gekuerzt, ${output.length - 8000} Zeichen entfernt]` : output || "(kein Output)");
          });
        });
      }
      case "code_ausfuehren": {
        const code = String(args.code);
        const { runInNewContext } = await import("vm");
        try {
          const sandbox = {
            Math, Date, JSON, parseInt, parseFloat, String, Number, Boolean, Array, Object,
            RegExp, Map, Set, console: { log: (...a: unknown[]) => logs.push(a.map(String).join(" ")) },
            setTimeout: undefined, setInterval: undefined, fetch: undefined,
            require: undefined, process: undefined,
          };
          const logs: string[] = [];
          const result = runInNewContext(code, sandbox, { timeout: 10_000 });
          const output = logs.length ? logs.join("\n") + "\n" : "";
          const resultStr = result !== undefined ? String(result) : "";
          const full = (output + resultStr).trim();
          return full.length > 4000 ? full.slice(0, 4000) + "\n[... gekuerzt]" : full || "(kein Ergebnis)";
        } catch (err) {
          return `Code-Fehler: ${err}`;
        }
      }
      case "http_anfrage": {
        const url = String(args.url);
        const method = (args.methode ? String(args.methode) : "GET").toUpperCase();
        const timeoutMs = 15_000;

        const options: RequestInit = {
          method,
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "User-Agent": "Bau-OS/1.0" },
        };

        if (args.headers) {
          try { Object.assign(options.headers!, JSON.parse(String(args.headers))); }
          catch { return "Fehler: headers ist kein gueltiges JSON."; }
        }

        if (args.body && ["POST", "PUT", "PATCH"].includes(method)) {
          options.body = String(args.body);
          (options.headers as Record<string, string>)["Content-Type"] ??= "application/json";
        }

        try {
          const resp = await fetch(url, options);
          const contentType = resp.headers.get("content-type") || "";
          const text = await resp.text();
          const status = `HTTP ${resp.status} ${resp.statusText}`;

          if (text.length > 6000) {
            return `${status}\n\n${text.slice(0, 6000)}\n\n[... gekuerzt, ${text.length - 6000} Zeichen entfernt]`;
          }
          return `${status}\n\n${text}`;
        } catch (err) {
          return `HTTP-Fehler: ${err}`;
        }
      }
      case "web_suchen": {
        const { webSearch } = await import("../web.js");
        const results = await webSearch(String(args.suchbegriff), Number(args.anzahl) || 5);
        if (!results.length) return `Keine Ergebnisse fuer "${args.suchbegriff}".`;
        return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
      }
      case "webseite_lesen": {
        const { fetchPage } = await import("../web.js");
        return await fetchPage(String(args.url));
      }
      case "agent_datei_lesen": {
        const content = readAgentFile(String(args.agent), String(args.datei));
        return content ?? `Datei "${args.datei}" fuer Agent "${args.agent}" nicht gefunden.`;
      }
      case "agent_datei_schreiben": {
        const ok = writeAgentFile(String(args.agent), String(args.datei), String(args.inhalt));
        if (!ok) return `Fehler: "${args.datei}" nicht erlaubt oder Agent-Ordner nicht vorhanden.`;

        // HEARTBEAT.md geschrieben → Cron-Job sofort aktualisieren
        if (String(args.datei).toUpperCase() === "HEARTBEAT.MD") {
          const { reloadHeartbeat } = await import("../heartbeat.js");
          const reload = reloadHeartbeat(String(args.agent));
          return `\u2705 ${args.agent}/${args.datei} gespeichert. ${reload}`;
        }

        return `\u2705 ${args.agent}/${args.datei} gespeichert.`;
      }
      case "tool_erstellen": {
        const { createTool } = await import("../tools.js");
        let params: Record<string, { type: string; description: string }> = {};
        if (args.parameter) {
          try { params = JSON.parse(String(args.parameter)); } catch { return "Fehler: parameter ist kein gueltiges JSON."; }
        }
        const required = args.pflichtfelder ? String(args.pflichtfelder).split(",").map(s => s.trim()) : [];
        let extraFiles: Record<string, string> | undefined;
        if (args.zusatzdateien) {
          try { extraFiles = JSON.parse(String(args.zusatzdateien)); } catch { return "Fehler: zusatzdateien ist kein gueltiges JSON."; }
        }
        const typ = (args.typ === "sh" ? "sh" : "js") as "js" | "sh";
        const dir = createTool(
          String(args.ordner),
          { name: String(args.name), description: String(args.beschreibung), parameters: params, required },
          String(args.code),
          typ,
          extraFiles,
        );
        return `\u2705 Tool "${args.name}" erstellt in ${dir}\nSofort verfuegbar — kein Neustart noetig.`;
      }
      case "tools_auflisten": {
        const { listDynamicTools } = await import("../tools.js");
        const tools = listDynamicTools();
        if (!tools.length) return "Keine dynamischen Tools vorhanden. Erstelle eins mit tool_erstellen.";
        return tools.map(t => `\u2022 **${t.name}** — ${t.description}\n  Parameter: ${Object.keys(t.parameters).join(", ") || "keine"}`).join("\n\n");
      }
      case "tool_loeschen": {
        const { deleteTool } = await import("../tools.js");
        return deleteTool(String(args.ordner))
          ? `\u2705 Tool "tools/${args.ordner}/" geloescht.`
          : `Tool-Ordner "tools/${args.ordner}/" nicht gefunden.`;
      }
      case "datei_bearbeiten": {
        const result = editFile(
          String(args.pfad),
          String(args.suchen),
          String(args.ersetzen),
          {
            regex: String(args.regex) === "true",
            all: String(args.alle) === "true",
          },
        );
        if (!result) return `Datei nicht gefunden oder Pfad ungueltig: ${args.pfad}. Nutze dateien_suchen um den richtigen Pfad zu finden.`;
        if (result.count === 0) return `Kein Treffer fuer "${args.suchen}" in ${args.pfad}. Nutze datei_lesen um den aktuellen Inhalt zu pruefen, oder regex_suchen um den Text im Vault zu finden.`;
        return `${result.count} Ersetzung(en) in ${args.pfad}.\n${result.preview}`;
      }
      case "dateien_suchen": {
        const files = globFiles(String(args.muster), {
          limit: Number(args.limit) || 50,
          subdir: args.ordner ? String(args.ordner) : undefined,
        });
        if (!files.length) return `Keine Dateien gefunden fuer "${args.muster}".`;
        return files.join("\n") + `\n\n[${files.length} Datei(en)]`;
      }
      case "regex_suchen": {
        const result = grepFiles(String(args.muster), {
          subdir: args.ordner ? String(args.ordner) : undefined,
          context: Number(args.kontext) || 0,
          maxMatches: Number(args.limit) || 20,
          fileGlob: args.dateifilter ? String(args.dateifilter) : undefined,
        });
        if (!result.matches.length) return `Keine Treffer fuer "${args.muster}".`;

        // Nach Datei gruppieren
        const grouped = new Map<string, Array<{ line: number; text: string }>>();
        for (const m of result.matches) {
          const arr = grouped.get(m.file) || [];
          arr.push({ line: m.line, text: m.text });
          grouped.set(m.file, arr);
        }

        const parts: string[] = [];
        for (const [file, matches] of grouped) {
          const lines = matches.map(m => `${m.line}: ${m.text}`).join("\n");
          parts.push(`=== ${file} ===\n${lines}`);
        }

        let output = parts.join("\n\n");
        const summary = `[${result.matches.length} Treffer in ${result.totalFiles} Datei(en)]`;
        output += result.truncated ? `\n\n${summary} (gekuerzt)` : `\n\n${summary}`;

        return output.length > 6000 ? output.slice(0, 6000) + "\n[... gekuerzt]" : output;
      }
      case "mcp_server_auflisten": {
        const { listMcpServers } = await import("../mcp.js");
        const servers = listMcpServers();
        if (!servers.length) return "Keine MCP-Server konfiguriert. Erstelle eine mcp.json im Projekt-Root.";
        return servers.map(s =>
          `${s.connected ? "\u2705" : "\u274C"} **${s.name}** — ${s.connected ? `${s.tools.length} Tool(s): ${s.tools.join(", ")}` : "nicht verbunden"}`
        ).join("\n");
      }
      case "mcp_server_verbinden": {
        const { connectServer, loadMcpConfig } = await import("../mcp.js");
        const config = loadMcpConfig();
        const serverConfig = config?.mcpServers?.[String(args.name)];
        if (!serverConfig) return `MCP-Server "${args.name}" nicht in mcp.json gefunden. Nutze mcp_server_auflisten um verfuegbare Server zu sehen.`;
        const ok = await connectServer(String(args.name), serverConfig);
        return ok ? `\u2705 MCP-Server "${args.name}" verbunden.` : `Fehler beim Verbinden von "${args.name}" — siehe Logs.`;
      }
      case "mcp_server_trennen": {
        const { disconnectServer } = await import("../mcp.js");
        const ok = await disconnectServer(String(args.name));
        return ok ? `MCP-Server "${args.name}" getrennt.` : `MCP-Server "${args.name}" war nicht verbunden.`;
      }
      default: {
        // Dynamische Tools pruefen
        const { isDynamicTool, executeDynamicTool } = await import("../tools.js");
        if (isDynamicTool(name)) {
          return await executeDynamicTool(name, args);
        }
        // MCP Tools pruefen
        const { isMcpTool, executeMcpTool } = await import("../mcp.js");
        if (isMcpTool(name)) {
          return await executeMcpTool(name, args);
        }
        return `Unbekanntes Tool: ${name}`;
      }
    }
  } catch (err) {
    return `Fehler bei ${name}: ${err}`;
  }
}
