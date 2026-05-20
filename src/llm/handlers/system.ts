import type OpenAI from "openai";
import type { HandlerMap } from "./types.js";

// Shell- und Code-Ausfuehrung wurden bewusst entfernt: der Bot darf Daten
// nur befuellen, nicht den Server steuern. Die Exporte bleiben (leer)
// bestehen, damit tools.ts / executor.ts / handlers/index.ts importieren koennen.
export const systemSchemas: OpenAI.Chat.ChatCompletionTool[] = [];

export const systemHandlers: HandlerMap = {};
