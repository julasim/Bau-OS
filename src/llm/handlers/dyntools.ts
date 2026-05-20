import type OpenAI from "openai";
import type { HandlerMap } from "./types.js";

// tool_erstellen / tool_loeschen wurden bewusst entfernt: der Bot darf keine
// neuen Tools anlegen oder loeschen. Das read-only Listing bleibt erhalten.
export const dyntoolSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "tools_auflisten",
      description:
        "Listet alle selbst erstellten dynamischen Tools auf (aus dem tools/ Verzeichnis). Zeigt Name, Beschreibung und Parameter jedes Tools.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export const dyntoolHandlers: HandlerMap = {
  tools_auflisten: async () => {
    const { listDynamicTools } = await import("../../tools.js");
    const tools = listDynamicTools();
    if (!tools.length) return "Keine dynamischen Tools vorhanden.";
    return tools
      .map((t) => `• **${t.name}** — ${t.description}\n  Parameter: ${Object.keys(t.parameters).join(", ") || "keine"}`)
      .join("\n\n");
  },
};
