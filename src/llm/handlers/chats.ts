// ============================================================
// Bau-OS — Chat-Such-Tool
// Ermoeglicht dem Agenten chat-uebergreifende Kontext-Suche. Wenn ein Nutzer
// in Chat C auf etwas aus Chat A verweist ("der Termin den ich gestern angelegt
// habe"), kann der Agent hier gezielt suchen ohne die komplette Historie
// in den Prompt laden zu muessen.
// ============================================================

import type OpenAI from "openai";
import { chatRepo } from "../../data/index.js";
import { TOOL_OUTPUT_MAX_CHARS } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const chatSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "chat_suchen",
      description:
        "Durchsucht aeltere Chat-Nachrichten (ueber ALLE Sessions, Telegram + Web) nach einem Stichwort. Unverzichtbar wenn der Nutzer sich auf Vergangenes bezieht: 'der Termin den ich angelegt habe', 'das Projekt worueber wir geredet haben', 'die Datei die ich gestern erwaehnt habe'. Liefert die Treffer mit Datum, Rolle (user/assistant) und Inhalt — neueste zuerst. Bei Unsicherheit IMMER zuerst suchen, bevor du den Nutzer nach Details fragst.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Suchbegriff oder Stichwort, z.B. 'CCV', 'Termin Voelkendorf', 'Aufgabe Mueller'",
          },
          limit: {
            type: "number",
            description: "Maximale Anzahl Treffer (Standard: 10, Max: 30)",
          },
        },
        required: ["query"],
      },
    },
  },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export const chatHandlers: HandlerMap = {
  chat_suchen: async (args) => {
    const query = String(args.query ?? "").trim();
    if (!query) return "Fehler: Suchbegriff ist leer.";
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);

    const hits = await chatRepo.searchMessages(query, limit);
    if (hits.length === 0) {
      return `Keine Chat-Nachrichten mit "${query}" gefunden. Pruefe die Schreibweise oder suche mit einem kuerzeren Stichwort.`;
    }

    const lines = hits.map((m) => {
      const date = formatDate(m.createdAt);
      // Inhalt auf ~200 Zeichen kuerzen damit der Output-Budget nicht
      // explodiert. Der Agent kann bei Bedarf einen zweiten Suchlauf starten.
      const snippet = m.content.length > 200 ? m.content.slice(0, 200) + "…" : m.content;
      const role = m.role === "user" ? "Du" : m.role === "assistant" ? "Agent" : m.role;
      const source = m.source === "telegram" ? " (Telegram)" : "";
      return `[${date}]${source} ${role}: ${snippet}`;
    });

    const out = `${hits.length} Treffer fuer "${query}" (neueste zuerst):\n\n${lines.join("\n\n")}`;
    return out.length > TOOL_OUTPUT_MAX_CHARS ? out.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n[... gekuerzt]" : out;
  },
};
