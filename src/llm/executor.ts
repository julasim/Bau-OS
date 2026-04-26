import {
  noteHandlers,
  taskHandlers,
  terminHandlers,
  fileHandlers,
  projectHandlers,
  teamHandlers,
  bautagebuchHandlers,
  agentHandlers,
  systemHandlers,
  webHandlers,
  dyntoolHandlers,
  mcpHandlers,
  chatHandlers,
} from "./handlers/index.js";
import type { ToolHandler } from "./handlers/index.js";

// Re-export context functions (consumer-facing API bleibt gleich)
export {
  setReplyContext,
  getReplyFn,
  setCurrentDepth,
  getCurrentDepth,
  registerProcessAgent,
  getProcessAgentFn,
  setSendFileContext,
  sendFile,
  setSendBufferContext,
  sendBuffer,
} from "./context.js";

// ---- Handler Registry ----

const registry = new Map<string, ToolHandler>();

for (const map of [
  noteHandlers,
  taskHandlers,
  terminHandlers,
  fileHandlers,
  projectHandlers,
  teamHandlers,
  bautagebuchHandlers,
  agentHandlers,
  systemHandlers,
  webHandlers,
  dyntoolHandlers,
  mcpHandlers,
  chatHandlers,
]) {
  for (const [name, handler] of Object.entries(map)) {
    registry.set(name, handler);
  }
}

// ---- Tool Executor ----

export async function executeTool(name: string, args: Record<string, string | number>): Promise<string> {
  try {
    // 1. Statische Handler (Registry)
    const handler = registry.get(name);
    if (handler) return await handler(args);

    // 2. Dynamische Tools
    const { isDynamicTool, executeDynamicTool } = await import("../tools.js");
    if (isDynamicTool(name)) return await executeDynamicTool(name, args);

    // 3. MCP Tools
    const { isMcpTool, executeMcpTool } = await import("../mcp.js");
    if (isMcpTool(name)) return await executeMcpTool(name, args);

    // Deutliche Fehlermeldung, damit das Modell nicht einfach "erledigt" antwortet.
    return `FEHLER: Tool "${name}" existiert nicht. Die Aktion wurde NICHT ausgefuehrt. Pruefe die Liste der verfuegbaren Tools und nutze den korrekten Namen — oder melde dem Benutzer ehrlich, dass das Feature fehlt.`;
  } catch (err) {
    return `FEHLER bei ${name} (Aktion NICHT ausgefuehrt): ${err}`;
  }
}
