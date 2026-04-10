import type OpenAI from "openai";
import {
  noteSchemas, taskSchemas, terminSchemas,
  fileSchemas, projectSchemas, agentSchemas,
  systemSchemas, webSchemas, dyntoolSchemas, mcpSchemas,
} from "./handlers/index.js";

// Antwort-Tool — nicht in Handlern, wird direkt von runtime.ts ausgewertet
const antwortenSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "antworten",
    description: "Sendet eine Antwort an den Benutzer. JEDE Antwort MUSS ueber dieses Tool gesendet werden — du kannst NICHT direkt Text ausgeben. Wenn du Informationen aus dem Vault, dem Internet oder anderen Quellen brauchst, nutze ZUERST die entsprechenden Tools (web_suchen, vault_suchen, termine_auflisten etc.) und rufe antworten DANACH mit den echten Ergebnissen auf. Erfinde NIEMALS Daten — wenn du etwas nicht weisst und kein passendes Tool hast, sage es ehrlich ueber dieses Tool.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Die Antwort an den Benutzer (Markdown erlaubt)" },
      },
      required: ["text"],
    },
  },
};

export const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  antwortenSchema,
  ...noteSchemas,
  ...taskSchemas,
  ...terminSchemas,
  ...fileSchemas,
  ...projectSchemas,
  ...agentSchemas,
  ...systemSchemas,
  ...webSchemas,
  ...dyntoolSchemas,
  ...mcpSchemas,
];
