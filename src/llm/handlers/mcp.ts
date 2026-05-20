import type OpenAI from "openai";
import type { HandlerMap } from "./types.js";

// mcp_server_verbinden / mcp_server_trennen wurden bewusst entfernt: der Bot
// darf keine MCP-Server starten oder stoppen. Das read-only Listing bleibt.
export const mcpSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "mcp_server_auflisten",
      description: "Listet alle konfigurierten MCP-Server auf mit Status (verbunden/getrennt) und verfuegbaren Tools.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export const mcpHandlers: HandlerMap = {
  mcp_server_auflisten: async () => {
    const { listMcpServers } = await import("../../mcp.js");
    const servers = listMcpServers();
    if (!servers.length) return "Keine MCP-Server konfiguriert.";
    return servers
      .map(
        (s) =>
          `${s.connected ? "✅" : "❌"} **${s.name}** — ${s.connected ? `${s.tools.length} Tool(s): ${s.tools.join(", ")}` : "nicht verbunden"}`,
      )
      .join("\n");
  },
};
