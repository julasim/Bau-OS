import type OpenAI from "openai";
import type { HandlerMap } from "./types.js";

export const dyntoolSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "tool_erstellen", description: "Erstellt ein neues wiederverwendbares Tool als Script. Das Tool wird sofort verfuegbar — kein Neustart noetig. Schreibe den Code so, dass er `args.paramName` nutzt und mit `return 'ergebnis'` das Resultat zurueckgibt. Fuer Templates: nutze `files()` um Zusatzdateien im Tool-Ordner zu lesen.", parameters: { type: "object", properties: { ordner: { type: "string", description: "Ordnername (z.B. 'kalkulation', 'bauprotokoll', 'preischeck')" }, name: { type: "string", description: "Tool-Name fuer LLM (z.B. 'kalkulation_berechnen')" }, beschreibung: { type: "string", description: "Was das Tool tut — wird dem LLM gezeigt" }, parameter: { type: "string", description: "Parameter als JSON: {\"flaeche\": {\"type\": \"number\", \"description\": \"m²\"}, ...}" }, pflichtfelder: { type: "string", description: "Komma-separierte Pflichtfelder (z.B. 'flaeche,typ')" }, code: { type: "string", description: "JavaScript-Code des Tools. Zugriff auf args.*, files(), Math, Date, JSON, fetch. Ergebnis via return." }, typ: { type: "string", description: "Script-Typ: 'js' (Standard) oder 'sh' (Shell)" }, zusatzdateien: { type: "string", description: "Optionale Zusatzdateien als JSON: {\"vorlage.md\": \"# Template\\n...\"}" } }, required: ["ordner", "name", "beschreibung", "code"] } } },
  { type: "function", function: { name: "tools_auflisten", description: "Listet alle selbst erstellten dynamischen Tools auf (aus dem tools/ Verzeichnis). Zeigt Name, Beschreibung und Parameter jedes Tools.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "tool_loeschen", description: "Loescht ein dynamisches Tool dauerhaft (gesamter Ordner). Nicht rueckgaengig machbar. Nutze tools_auflisten um den Ordnernamen zu finden.", parameters: { type: "object", properties: { ordner: { type: "string", description: "Ordnername des Tools (z.B. 'kalkulation')" } }, required: ["ordner"] } } },
];

export const dyntoolHandlers: HandlerMap = {
  tool_erstellen: async (args) => {
    const { createTool } = await import("../../tools.js");
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
  },

  tools_auflisten: async () => {
    const { listDynamicTools } = await import("../../tools.js");
    const tools = listDynamicTools();
    if (!tools.length) return "Keine dynamischen Tools vorhanden. Erstelle eins mit tool_erstellen.";
    return tools.map(t => `\u2022 **${t.name}** — ${t.description}\n  Parameter: ${Object.keys(t.parameters).join(", ") || "keine"}`).join("\n\n");
  },

  tool_loeschen: async (args) => {
    const { deleteTool } = await import("../../tools.js");
    return deleteTool(String(args.ordner))
      ? `\u2705 Tool "tools/${args.ordner}/" geloescht.`
      : `Tool-Ordner "tools/${args.ordner}/" nicht gefunden.`;
  },
};
