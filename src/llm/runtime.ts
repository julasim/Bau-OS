import type OpenAI from "openai";
import { client, buildDateLine } from "./client.js";
import { TOOLS } from "./tools.js";
import { getDynamicToolSchemas } from "../tools.js";
import { getMcpToolSchemas } from "../mcp.js";
import { executeTool, setCurrentDepth, registerProcessAgent } from "./executor.js";
import { runCompaction } from "./compaction.js";
import { loadAgentWorkspace, appendAgentConversation, loadAgentHistory, shouldCompact } from "../vault/index.js";
import { MAX_HISTORY_CHARS, MAX_TOOL_ROUNDS, MAX_SPAWN_DEPTH, SUBAGENT_MODEL, getAgentModel } from "../config.js";
import { logInfo, logError } from "../logger.js";

// ---- Agent Runtime ----

export async function processAgent(agentName: string, userMessage: string, mode: "full" | "minimal" = "full", depth = 0): Promise<string> {
  if (depth > MAX_SPAWN_DEPTH) return `[${agentName}] Maximale Spawn-Tiefe erreicht (depth=${depth}).`;
  setCurrentDepth(depth);
  const preview = userMessage.length > 80 ? userMessage.slice(0, 80) + "\u2026" : userMessage;
  logInfo(`[${agentName}] Start — "${preview}"`);

  const workspaceContext = loadAgentWorkspace(agentName, mode);
  const dateLine = buildDateLine();
  const systemPrompt = workspaceContext
    ? `${dateLine}\n\n${workspaceContext}`
    : dateLine;

  const history = mode === "full" ? loadAgentHistory(agentName, 10) : [];

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.flatMap(h => [
      { role: "user" as const, content: h.user },
      { role: "assistant" as const, content: h.assistant },
    ]),
    { role: "user", content: userMessage },
  ];

  const activeModel = mode === "minimal" ? SUBAGENT_MODEL : getAgentModel(agentName);

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const response = await client.chat.completions.create({
      model: activeModel,
      messages,
      tools: [...TOOLS, ...getDynamicToolSchemas(), ...getMcpToolSchemas()],
      tool_choice: "auto",
    });

    const reply = response.choices[0].message;
    messages.push(reply);

    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      const antwort = reply.content ?? "Erledigt.";
      appendAgentConversation(agentName, userMessage, antwort);
      logInfo(`[${agentName}] Antwort (Runde ${i + 1}, ${antwort.length} Z)`);
      if (shouldCompact(agentName)) runCompaction(agentName).catch(err => logError("Compaction", err));
      return antwort;
    }

    const toolNames = reply.tool_calls.map(tc => (tc as { function: { name: string } }).function.name).join(", ");
    logInfo(`[${agentName}] Tools (Runde ${i + 1}): ${toolNames}`);
    const toolResults = await Promise.all(
      reply.tool_calls.map(async (toolCall) => {
        const tc = toolCall as { id: string; function: { name: string; arguments: string } };
        let args: Record<string, string | number>;
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, string | number>;
        } catch {
          return { role: "tool" as const, tool_call_id: tc.id, content: `Fehler: Ungueltige Tool-Argumente fuer ${tc.function.name}.` };
        }
        const result = await executeTool(tc.function.name, args);
        return { role: "tool" as const, tool_call_id: tc.id, content: result };
      })
    );

    messages.push(...toolResults);

    // Pruning
    const totalChars = messages.reduce((s, m) => s + JSON.stringify(m).length, 0);
    if (totalChars > MAX_HISTORY_CHARS) {
      const systemMsg = messages[0];
      const toolMsgs = messages.filter(m => m.role === "tool");
      const nonToolMsgs = messages.filter(m => m.role !== "tool");
      const keptTools = toolMsgs.slice(-3);
      messages.splice(0, messages.length,
        systemMsg,
        ...nonToolMsgs.slice(1),
        ...keptTools
      );
    }
  }

  const fallback = "Ich konnte deine Anfrage nicht vollstaendig bearbeiten.";
  appendAgentConversation(agentName, userMessage, fallback);
  logInfo(`[${agentName}] Fallback nach ${MAX_TOOL_ROUNDS} Runden`);
  if (shouldCompact(agentName)) runCompaction(agentName).catch(err => logError("Compaction", err));
  return fallback;
}

// btw-Modus: direkte Antwort ohne Tools und ohne Log
export async function processBtw(userMessage: string): Promise<string> {
  const workspaceContext = loadAgentWorkspace("Main", "minimal");
  const dateLine = buildDateLine();
  const systemPrompt = workspaceContext ? `${dateLine}\n\n${workspaceContext}` : dateLine;

  const response = await client.chat.completions.create({
    model: (await import("./client.js")).getModel(),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices[0].message.content ?? "Erledigt.";
}

export const processMessage = (msg: string) => processAgent("Main", msg);

// Register processAgent in executor to break circular dependency
registerProcessAgent(processAgent);
