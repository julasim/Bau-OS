/**
 * MCP-Client Manager — verbindet externe MCP-Server als Tool-Konnektoren.
 *
 * Config: mcp.json im Projekt-Root.
 * Server laufen als Kindprozesse (stdio-Transport).
 * Tools werden automatisch ins LLM-Tool-Array gemerged.
 */

import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type OpenAI from "openai";
import { logInfo, logError } from "./logger.js";
import { TOOLS } from "./llm/tools.js";

// ---- Types ----

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface McpToolEntry {
  serverName: string;
  originalName: string;
  prefixedName: string;
  schema: OpenAI.Chat.ChatCompletionTool;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolEntry[];
}

// ---- State ----

const _servers = new Map<string, ConnectedServer>();
const MCP_CONFIG_PATH = path.join(process.cwd(), "mcp.json");

// ---- Config ----

export function loadMcpConfig(): McpConfig | null {
  if (!fs.existsSync(MCP_CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"));
    if (!raw.mcpServers || typeof raw.mcpServers !== "object") return null;
    return raw as McpConfig;
  } catch (err) {
    logError("MCP", `mcp.json Parse-Fehler: ${err}`);
    return null;
  }
}

// ---- Schema Conversion ----

function mcpToolToOpenAI(serverName: string, tool: { name: string; description?: string; inputSchema?: unknown }): McpToolEntry {
  const prefixedName = `mcp_${serverName}_${tool.name}`;
  const inputSchema = (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {}, required: [] };

  return {
    serverName,
    originalName: tool.name,
    prefixedName,
    schema: {
      type: "function",
      function: {
        name: prefixedName,
        description: tool.description ?? `MCP Tool: ${tool.name} (${serverName})`,
        parameters: inputSchema as Record<string, unknown>,
      },
    },
  };
}

// ---- Collision Check ----

function isNameTaken(name: string): boolean {
  // Statische Tools
  if (TOOLS.some(t => (t as { function: { name: string } }).function.name === name)) return true;
  // Bereits registrierte MCP-Tools
  for (const server of _servers.values()) {
    if (server.tools.some(t => t.prefixedName === name)) return true;
  }
  return false;
}

// ---- Connect / Disconnect ----

export async function connectServer(name: string, config: McpServerConfig): Promise<boolean> {
  // Bereits verbunden?
  if (_servers.has(name)) {
    logInfo(`[MCP] ${name} ist bereits verbunden.`);
    return true;
  }

  try {
    const client = new Client({ name: "bau-os", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env as Record<string, string>, ...(config.env ?? {}) },
    });

    await client.connect(transport);

    // Tools laden
    const { tools: mcpTools } = await client.listTools();
    const entries: McpToolEntry[] = [];

    for (const tool of mcpTools) {
      const entry = mcpToolToOpenAI(name, tool);
      if (isNameTaken(entry.prefixedName)) {
        logInfo(`[MCP] Tool-Kollision: ${entry.prefixedName} uebersprungen`);
        continue;
      }
      entries.push(entry);
    }

    _servers.set(name, { name, client, transport, tools: entries });
    logInfo(`[MCP] ${name} verbunden — ${entries.length} Tool(s): ${entries.map(t => t.originalName).join(", ")}`);
    return true;
  } catch (err) {
    logError(`MCP/${name}`, err);
    return false;
  }
}

export async function disconnectServer(name: string): Promise<boolean> {
  const server = _servers.get(name);
  if (!server) return false;

  try { await server.client.close(); } catch { /* ignore */ }
  _servers.delete(name);
  logInfo(`[MCP] ${name} getrennt.`);
  return true;
}

export async function disconnectAll(): Promise<void> {
  for (const name of [..._servers.keys()]) {
    await disconnectServer(name);
  }
}

// ---- Startup ----

export async function initMcp(): Promise<void> {
  const config = loadMcpConfig();
  if (!config) return;

  const entries = Object.entries(config.mcpServers);
  if (!entries.length) return;

  let connected = 0;
  const failed: string[] = [];

  for (const [name, serverConfig] of entries) {
    if (serverConfig.enabled === false) continue;
    const ok = await connectServer(name, serverConfig);
    if (ok) connected++;
    else failed.push(name);
  }

  const total = entries.filter(([, c]) => c.enabled !== false).length;
  const summary = `MCP: ${connected}/${total} Server verbunden`;
  if (failed.length) logInfo(`${summary} (fehlgeschlagen: ${failed.join(", ")})`);
  else if (connected > 0) logInfo(summary);
}

// ---- Tool Schemas (for runtime.ts) ----

export function getMcpToolSchemas(): OpenAI.Chat.ChatCompletionTool[] {
  const schemas: OpenAI.Chat.ChatCompletionTool[] = [];
  for (const server of _servers.values()) {
    for (const tool of server.tools) {
      schemas.push(tool.schema);
    }
  }
  return schemas;
}

// ---- Tool Dispatch (for executor.ts) ----

export function isMcpTool(name: string): boolean {
  if (!name.startsWith("mcp_")) return false;
  for (const server of _servers.values()) {
    if (server.tools.some(t => t.prefixedName === name)) return true;
  }
  return false;
}

export async function executeMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  // Find the right server and tool
  for (const server of _servers.values()) {
    const tool = server.tools.find(t => t.prefixedName === name);
    if (!tool) continue;

    try {
      const result = await server.client.callTool({
        name: tool.originalName,
        arguments: args,
      });

      // Extract text from content array
      if (!result.content || !Array.isArray(result.content)) {
        return result.isError ? `MCP-Fehler: ${JSON.stringify(result)}` : "(kein Ergebnis)";
      }

      const text = (result.content as Array<{ type: string; text?: string }>)
        .filter(c => c.type === "text" && c.text)
        .map(c => c.text!)
        .join("\n");

      if (result.isError) {
        return `MCP-Fehler bei ${tool.originalName}: ${text || "Unbekannter Fehler"}`;
      }

      // Truncate
      if (text.length > 8000) {
        return text.slice(0, 8000) + "\n[... gekuerzt]";
      }
      return text || "(kein Ergebnis)";
    } catch (err) {
      return `MCP-Fehler bei "${tool.originalName}" (${server.name}): ${err}. Nutze mcp_server_verbinden um den Server neu zu starten.`;
    }
  }

  return `MCP-Tool "${name}" nicht gefunden. Nutze mcp_server_auflisten um verfuegbare Tools zu sehen.`;
}

// ---- Meta: Server Info ----

export function listMcpServers(): Array<{ name: string; connected: boolean; tools: string[] }> {
  const config = loadMcpConfig();
  const result: Array<{ name: string; connected: boolean; tools: string[] }> = [];

  // Alle konfigurierten Server
  if (config) {
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      const server = _servers.get(name);
      result.push({
        name: `${name}${serverConfig.enabled === false ? " (deaktiviert)" : ""}`,
        connected: !!server,
        tools: server?.tools.map(t => t.originalName) ?? [],
      });
    }
  }

  // Laufende Server die nicht mehr in Config sind (manuell verbunden)
  for (const [name, server] of _servers) {
    if (!result.some(r => r.name === name || r.name.startsWith(name + " "))) {
      result.push({
        name,
        connected: true,
        tools: server.tools.map(t => t.originalName),
      });
    }
  }

  return result;
}
