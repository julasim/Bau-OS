/**
 * Dynamisches Tool-System.
 *
 * Jedes Tool ist ein Ordner unter tools/:
 *   tools/
 *     mein-tool/
 *       tool.json   — Schema (name, description, parameters, required)
 *       run.js      — Node.js Script (bekommt `args`, gibt String zurueck)
 *       run.sh      — ODER Shell-Script (args als Env-Variablen)
 *       *.md, *.txt — Beliebige Zusatzdateien (Templates, Daten)
 *
 * Tools werden bei Bedarf geladen (nicht gecacht) → Aenderungen sofort aktiv.
 */

import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { runInNewContext } from "vm";
import { TOOLS_DIR } from "./config.js";
import { logInfo, logError } from "./logger.js";
import type OpenAI from "openai";

// ---- Types ----

export interface DynamicToolDef {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  required: string[];
}

// ---- Laden ----

function ensureToolsDir(): void {
  if (!fs.existsSync(TOOLS_DIR)) {
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
  }
}

/** Liest tool.json eines einzelnen Tools */
function loadToolDef(toolDir: string): DynamicToolDef | null {
  const defPath = path.join(toolDir, "tool.json");
  if (!fs.existsSync(defPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(defPath, "utf-8"));
    if (!raw.name || !raw.description) return null;
    return {
      name: raw.name,
      description: raw.description,
      parameters: raw.parameters || {},
      required: raw.required || [],
    };
  } catch {
    logError("DynamicTools", `Fehler beim Laden von ${defPath}`);
    return null;
  }
}

/** Alle dynamischen Tools auflisten */
export function listDynamicTools(): DynamicToolDef[] {
  ensureToolsDir();
  const entries = fs.readdirSync(TOOLS_DIR, { withFileTypes: true });
  const tools: DynamicToolDef[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const def = loadToolDef(path.join(TOOLS_DIR, entry.name));
    if (def) tools.push(def);
  }

  return tools;
}

/** Dynamische Tools als OpenAI Tool-Schema (fuer LLM) */
export function getDynamicToolSchemas(): OpenAI.Chat.ChatCompletionTool[] {
  return listDynamicTools().map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([key, val]) => [key, val])
        ),
        required: t.required,
      },
    },
  }));
}

// ---- Ausfuehren ----

/** Prueft ob ein Tool-Name ein dynamisches Tool ist */
export function isDynamicTool(name: string): boolean {
  ensureToolsDir();
  const entries = fs.readdirSync(TOOLS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const def = loadToolDef(path.join(TOOLS_DIR, entry.name));
    if (def?.name === name) return true;
  }
  return false;
}

/** Fuehrt ein dynamisches Tool aus */
export async function executeDynamicTool(
  name: string,
  args: Record<string, string | number>
): Promise<string> {
  ensureToolsDir();

  // Tool-Ordner finden
  const entries = fs.readdirSync(TOOLS_DIR, { withFileTypes: true });
  let toolDir: string | null = null;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(TOOLS_DIR, entry.name);
    const def = loadToolDef(dir);
    if (def?.name === name) { toolDir = dir; break; }
  }

  if (!toolDir) return `Dynamisches Tool "${name}" nicht gefunden.`;

  const jsPath = path.join(toolDir, "run.js");
  const shPath = path.join(toolDir, "run.sh");

  // ── run.js ausfuehren (Node.js Sandbox) ──
  if (fs.existsSync(jsPath)) {
    const code = fs.readFileSync(jsPath, "utf-8");
    try {
      // Hilfsfunktionen die das Script nutzen kann
      const toolFiles = (): Record<string, string> => {
        const files: Record<string, string> = {};
        for (const f of fs.readdirSync(toolDir!)) {
          if (f === "tool.json" || f === "run.js" || f === "run.sh") continue;
          const fp = path.join(toolDir!, f);
          if (fs.statSync(fp).isFile()) {
            files[f] = fs.readFileSync(fp, "utf-8");
          }
        }
        return files;
      };

      const sandbox = {
        args,
        files: toolFiles,
        Math, Date, JSON, parseInt, parseFloat, String, Number, Boolean, Array, Object,
        RegExp, Map, Set, Error,
        console: { log: (...a: unknown[]) => logs.push(a.map(String).join(" ")) },
        fetch: globalThis.fetch,  // Netzwerk erlaubt fuer dynamische Tools
      };

      const logs: string[] = [];

      // Async-Wrapper damit await im Script funktioniert
      const wrappedCode = `(async () => { ${code} })()`;
      const result = await runInNewContext(wrappedCode, sandbox, { timeout: 30_000 });

      const output = logs.length ? logs.join("\n") + "\n" : "";
      const resultStr = result !== undefined ? String(result) : "";
      const full = (output + resultStr).trim();

      logInfo(`[Tool] ${name} ausgefuehrt`);
      return full.length > 8000
        ? full.slice(0, 8000) + `\n\n[... gekuerzt]`
        : full || "(kein Ergebnis)";

    } catch (err) {
      logError(`Tool/${name}`, err);
      return `Fehler in ${name}: ${err}`;
    }
  }

  // ── run.sh ausfuehren (Shell) ──
  if (fs.existsSync(shPath)) {
    return new Promise<string>((resolve) => {
      // Args als Umgebungsvariablen uebergeben (TOOL_ARG_name=wert)
      const env: Record<string, string> = { ...process.env as Record<string, string>, LANG: "de_AT.UTF-8" };
      for (const [key, val] of Object.entries(args)) {
        env[`TOOL_ARG_${key.toUpperCase()}`] = String(val);
      }

      exec(`bash "${shPath}"`, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        cwd: toolDir!,
        env,
      }, (error, stdout, stderr) => {
        if (error) {
          if (error.killed) resolve(`Tool-Timeout nach 30s: ${name}`);
          else resolve(`Fehler: ${stderr || error.message}`);
          return;
        }
        const output = (stdout + (stderr ? `\n[stderr] ${stderr}` : "")).trim();
        resolve(output.length > 8000 ? output.slice(0, 8000) + "\n[... gekuerzt]" : output || "(kein Output)");
      });
    });
  }

  return `Tool "${name}" hat weder run.js noch run.sh.`;
}

// ---- Meta: Tool erstellen/loeschen ----

/** Erstellt ein neues dynamisches Tool */
export function createTool(
  folderName: string,
  toolJson: DynamicToolDef,
  runCode: string,
  type: "js" | "sh" = "js",
  extraFiles?: Record<string, string>
): string {
  ensureToolsDir();
  const toolDir = path.join(TOOLS_DIR, folderName);

  if (fs.existsSync(toolDir)) {
    // Update — Ordner existiert schon
    fs.writeFileSync(path.join(toolDir, "tool.json"), JSON.stringify(toolJson, null, 2), "utf-8");
    fs.writeFileSync(path.join(toolDir, type === "js" ? "run.js" : "run.sh"), runCode, "utf-8");
  } else {
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(path.join(toolDir, "tool.json"), JSON.stringify(toolJson, null, 2), "utf-8");
    fs.writeFileSync(path.join(toolDir, type === "js" ? "run.js" : "run.sh"), runCode, "utf-8");
  }

  // Zusatzdateien (Templates etc.)
  if (extraFiles) {
    for (const [name, content] of Object.entries(extraFiles)) {
      fs.writeFileSync(path.join(toolDir, name), content, "utf-8");
    }
  }

  logInfo(`[Tool] "${toolJson.name}" erstellt in tools/${folderName}/`);
  return toolDir;
}

/** Loescht ein dynamisches Tool */
export function deleteTool(folderName: string): boolean {
  const toolDir = path.join(TOOLS_DIR, folderName);
  if (!fs.existsSync(toolDir)) return false;
  fs.rmSync(toolDir, { recursive: true });
  logInfo(`[Tool] tools/${folderName}/ geloescht`);
  return true;
}
