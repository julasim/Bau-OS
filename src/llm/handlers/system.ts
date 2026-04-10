import type OpenAI from "openai";
import { exec } from "child_process";
import {
  COMMAND_TIMEOUT_SEC,
  COMMAND_TIMEOUT_MAX_SEC,
  COMMAND_BUFFER_SIZE,
  TOOL_OUTPUT_MAX_CHARS,
  VM_TIMEOUT_MS,
  CODE_OUTPUT_MAX_CHARS,
} from "../../config.js";
import type { HandlerMap } from "./types.js";

export const systemSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "befehl_ausfuehren",
      description:
        "Fuehrt einen Shell-Befehl auf dem Server aus. Fuer: Systeminfo (df -h, uptime, free -h, top -bn1), Dateien (ls, cat, wc, head, tail, grep, find), Services (systemctl status), Netzwerk (curl, ping, dig), Pakete (apt list), Prozesse (ps aux), Logs (journalctl -u bau-os -n 50). Befehle koennen mit | verkettet werden. Destruktive Befehle (rm -rf, shutdown, reboot) sind blockiert.",
      parameters: {
        type: "object",
        properties: {
          befehl: {
            type: "string",
            description: "Shell-Befehl (z.B. 'df -h', 'cat /etc/hostname', 'ps aux | grep node')",
          },
          verzeichnis: { type: "string", description: "Optionales Arbeitsverzeichnis (Standard: /opt/bau-os)" },
          timeout: { type: "number", description: "Timeout in Sekunden (Standard: 15, max: 60)" },
        },
        required: ["befehl"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "code_ausfuehren",
      description:
        "Fuehrt JavaScript-Code direkt auf dem Server aus. Fuer: Berechnungen (Flaechen, Kosten, Prozent), Daten transformieren (JSON parsen, CSV verarbeiten, Datumsberechnungen), Text verarbeiten (Regex, Split, Format). Der Code laeuft in Node.js — alle eingebauten Module verfuegbar (fs, path, crypto etc.). Letzter Ausdruck wird als Ergebnis zurueckgegeben.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "JavaScript-Code (z.B. 'Math.round(125.5 * 0.2 * 100) / 100' oder mehrzeiliger Code)",
          },
        },
        required: ["code"],
      },
    },
  },
];

const ALLOWED_COMMANDS = [
  "ls",
  "dir",
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "find",
  "wc",
  "sort",
  "uniq",
  "df",
  "du",
  "free",
  "uptime",
  "uname",
  "whoami",
  "hostname",
  "date",
  "cal",
  "ps",
  "top",
  "htop",
  "systemctl",
  "journalctl",
  "service",
  "curl",
  "wget",
  "ping",
  "dig",
  "nslookup",
  "ip",
  "ss",
  "netstat",
  "pwd",
  "which",
  "whereis",
  "file",
  "stat",
  "lsblk",
  "lscpu",
  "echo",
  "printf",
  "tr",
  "cut",
  "awk",
  "sed",
  "jq",
  "xargs",
  "git",
  "npm",
  "node",
  "npx",
  "tsc",
  "tar",
  "zip",
  "unzip",
  "gzip",
  "gunzip",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "ln",
  "chmod",
  "chown",
  "docker",
  "docker-compose",
  "ollama",
];

export const systemHandlers: HandlerMap = {
  befehl_ausfuehren: async (args) => {
    const cmd = String(args.befehl).trim();
    const baseCmd = cmd.split(/[\s|;&]/)[0].replace(/^.*\//, "");
    if (!ALLOWED_COMMANDS.includes(baseCmd))
      return `Befehl "${baseCmd}" nicht erlaubt. Erlaubte Befehle: ${ALLOWED_COMMANDS.slice(0, 15).join(", ")}...`;

    const cwd = args.verzeichnis ? String(args.verzeichnis) : process.cwd();
    const timeoutMs = Math.min(Number(args.timeout) || COMMAND_TIMEOUT_SEC, COMMAND_TIMEOUT_MAX_SEC) * 1000;

    return new Promise<string>((resolve) => {
      exec(
        cmd,
        { timeout: timeoutMs, maxBuffer: COMMAND_BUFFER_SIZE, cwd, env: { ...process.env, LANG: "de_AT.UTF-8" } },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed) resolve(`Befehl abgebrochen (Timeout nach ${timeoutMs / 1000}s): ${cmd}`);
            else resolve(`Fehler: ${stderr || error.message}`);
            return;
          }
          const output = (stdout + (stderr ? `\n[stderr] ${stderr}` : "")).trim();
          resolve(
            output.length > TOOL_OUTPUT_MAX_CHARS
              ? output.slice(0, TOOL_OUTPUT_MAX_CHARS) +
                  `\n\n[... gekuerzt, ${output.length - TOOL_OUTPUT_MAX_CHARS} Zeichen entfernt]`
              : output || "(kein Output)",
          );
        },
      );
    });
  },

  code_ausfuehren: async (args) => {
    const code = String(args.code);
    const { runInNewContext } = await import("vm");
    try {
      const logs: string[] = [];
      const sandbox = {
        Math,
        Date,
        JSON,
        parseInt,
        parseFloat,
        String,
        Number,
        Boolean,
        Array,
        Object,
        RegExp,
        Map,
        Set,
        console: { log: (...a: unknown[]) => logs.push(a.map(String).join(" ")) },
        setTimeout: undefined,
        setInterval: undefined,
        fetch: undefined,
        require: undefined,
        process: undefined,
      };
      const result = runInNewContext(code, sandbox, { timeout: VM_TIMEOUT_MS });
      const output = logs.length ? logs.join("\n") + "\n" : "";
      const resultStr = result !== undefined ? String(result) : "";
      const full = (output + resultStr).trim();
      return full.length > CODE_OUTPUT_MAX_CHARS
        ? full.slice(0, CODE_OUTPUT_MAX_CHARS) + "\n[... gekuerzt]"
        : full || "(kein Ergebnis)";
    } catch (err) {
      return `Code-Fehler: ${err}`;
    }
  },
};
