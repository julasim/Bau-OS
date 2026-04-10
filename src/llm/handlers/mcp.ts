import type OpenAI from "openai";
import type { HandlerMap } from "./types.js";

export const mcpSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "mcp_server_auflisten", description: "Listet alle konfigurierten MCP-Server auf mit Status (verbunden/getrennt) und verfuegbaren Tools. MCP-Server erweitern Bau-OS um externe Faehigkeiten (z.B. GitHub, Dateisystem, Datenbanken, APIs).", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "mcp_server_verbinden", description: "Verbindet einen MCP-Server aus der mcp.json Konfiguration. Der Server wird als Kindprozess gestartet und seine Tools werden sofort verfuegbar. Nutze mcp_server_auflisten um verfuegbare Server zu sehen.", parameters: { type: "object", properties: { name: { type: "string", description: "Name des MCP-Servers (z.B. 'github', 'filesystem')" } }, required: ["name"] } } },
  { type: "function", function: { name: "mcp_server_trennen", description: "Trennt die Verbindung zu einem laufenden MCP-Server und entfernt seine Tools. Der Server kann spaeter ueber mcp_server_verbinden wieder gestartet werden.", parameters: { type: "object", properties: { name: { type: "string", description: "Name des MCP-Servers" } }, required: ["name"] } } },
];

export const mcpHandlers: HandlerMap = {
  mcp_server_auflisten: async () => {
    const { listMcpServers } = await import("../../mcp.js");
    const servers = listMcpServers();
    if (!servers.length) return "Keine MCP-Server konfiguriert. Erstelle eine mcp.json im Projekt-Root.";
    return servers.map(s =>
      `${s.connected ? "\u2705" : "\u274C"} **${s.name}** — ${s.connected ? `${s.tools.length} Tool(s): ${s.tools.join(", ")}` : "nicht verbunden"}`
    ).join("\n");
  },

  mcp_server_verbinden: async (args) => {
    const { connectServer, loadMcpConfig } = await import("../../mcp.js");
    const config = loadMcpConfig();
    const serverConfig = config?.mcpServers?.[String(args.name)];
    if (!serverConfig) return `MCP-Server "${args.name}" nicht in mcp.json gefunden. Nutze mcp_server_auflisten um verfuegbare Server zu sehen.`;
    const ok = await connectServer(String(args.name), serverConfig);
    return ok ? `\u2705 MCP-Server "${args.name}" verbunden.` : `Fehler beim Verbinden von "${args.name}" — siehe Logs.`;
  },

  mcp_server_trennen: async (args) => {
    const { disconnectServer } = await import("../../mcp.js");
    const ok = await disconnectServer(String(args.name));
    return ok ? `MCP-Server "${args.name}" getrennt.` : `MCP-Server "${args.name}" war nicht verbunden.`;
  },
};
