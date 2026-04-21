import type OpenAI from "openai";
import { client, buildDateLine } from "./client.js";
import { TOOLS } from "./tools.js";
import { buildToolWhitelist } from "./whitelist.js";
import { getDynamicToolSchemas } from "../tools.js";
import { getMcpToolSchemas } from "../mcp.js";
import { executeTool, setCurrentDepth, registerProcessAgent } from "./executor.js";
import { runCompaction } from "./compaction.js";
import { isActionRequest, ACTION_HINT, TOOL_SKIP_CORRECTION, MAX_TOOL_SKIP_RETRIES } from "./actions.js";
import { loadAgentWorkspace, appendAgentConversation, loadAgentHistory, shouldCompact } from "../workspace/index.js";
import {
  MAX_HISTORY_CHARS,
  MAX_TOOL_ROUNDS,
  MAX_SPAWN_DEPTH,
  SUBAGENT_MODEL,
  getAgentModel,
  MESSAGE_PREVIEW_LENGTH,
  KEPT_TOOL_MESSAGES,
  TOOL_PRUNE_MAX_CHARS,
  HISTORY_LOAD_LIMIT,
} from "../config.js";
import { logInfo, logError } from "../logger.js";

// ---- Agent Runtime ----

export async function processAgent(
  agentName: string,
  userMessage: string,
  mode: "full" | "minimal" = "full",
  depth = 0,
): Promise<string> {
  if (depth > MAX_SPAWN_DEPTH) return `[${agentName}] Maximale Spawn-Tiefe erreicht (depth=${depth}).`;
  setCurrentDepth(depth);
  const preview =
    userMessage.length > MESSAGE_PREVIEW_LENGTH ? userMessage.slice(0, MESSAGE_PREVIEW_LENGTH) + "\u2026" : userMessage;
  logInfo(`[${agentName}] Start — "${preview}"`);

  const workspaceContext = loadAgentWorkspace(agentName, mode);
  const dateLine = buildDateLine();
  const toolWhitelist = buildToolWhitelist();
  const baseSystemPrompt = workspaceContext
    ? `${dateLine}\n\n${workspaceContext}\n\n${toolWhitelist}`
    : `${dateLine}\n\n${toolWhitelist}`;

  // Halluzinations-Schutz (parity mit api/routes/chat.ts): bei klaren
  // Aktions-Anfragen einen Zusatz-Hint in den System-Prompt haengen und in
  // Runde 1 das antworten-Tool rausfiltern, damit das Modell die echte Aktion
  // aufrufen muss statt Erfolg zu faken.
  const isAction = isActionRequest(userMessage);
  const systemPrompt = isAction ? baseSystemPrompt + ACTION_HINT : baseSystemPrompt;

  const history = mode === "full" ? loadAgentHistory(agentName, HISTORY_LOAD_LIMIT) : [];

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.flatMap((h) => [
      { role: "user" as const, content: h.user },
      { role: "assistant" as const, content: h.assistant },
    ]),
    { role: "user", content: userMessage },
  ];

  const activeModel = mode === "minimal" ? SUBAGENT_MODEL : getAgentModel(agentName);
  const allTools = [...TOOLS, ...getDynamicToolSchemas(), ...getMcpToolSchemas()];
  const toolsWithoutAntworten = allTools.filter((t) => !(t.type === "function" && t.function.name === "antworten"));

  let actionToolSkipRetries = 0;

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const forceActionInRound1 = isAction && i === 0;
    const effectiveTools = forceActionInRound1 ? toolsWithoutAntworten : allTools;

    const response = await client.chat.completions.create({
      model: activeModel,
      messages,
      tools: effectiveTools,
      tool_choice: "required",
    });

    const reply = response.choices[0].message;
    messages.push(reply);

    // Fallback: Modell hat keinen Tool-Call gemacht (sollte bei "required" nicht passieren)
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      // Hartes Halluzinations-Netz fuer Aktions-Anfragen in Runde 1: Retry mit
      // verstaerktem System-Hint, nach MAX_TOOL_SKIP_RETRIES ehrlicher Fehler.
      if (isAction && i === 0) {
        if (actionToolSkipRetries < MAX_TOOL_SKIP_RETRIES) {
          actionToolSkipRetries++;
          messages.push({ role: "user", content: TOOL_SKIP_CORRECTION });
          logInfo(
            `[${agentName}] Tool-Skip Retry ${actionToolSkipRetries}/${MAX_TOOL_SKIP_RETRIES} ` +
              `(Modell: ${activeModel})`,
          );
          i--;
          continue;
        }
        const warnung =
          `\u26A0\uFE0F Das Modell hat ${MAX_TOOL_SKIP_RETRIES + 1}x behauptet, die Aktion ausgefuehrt zu haben, ` +
          `aber keinen Tool-Call gemacht — es wurde also NICHTS gespeichert. ` +
          `Das Modell "${activeModel}" ignoriert tool_choice=required hartnaeckig. ` +
          `Probiere ein groesseres Modell (/model) oder formuliere die Anfrage anders.`;
        appendAgentConversation(agentName, userMessage, warnung);
        logError(
          "[Runtime] Modell hat tool_choice=required nach Retries ignoriert",
          new Error(`Action-Request ohne tool_calls nach ${MAX_TOOL_SKIP_RETRIES} Retries. Modell: ${activeModel}.`),
        );
        return warnung;
      }

      const antwort = reply.content ?? "Erledigt.";
      appendAgentConversation(agentName, userMessage, antwort);
      logInfo(`[${agentName}] Antwort ohne Tool (Runde ${i + 1}, ${antwort.length} Z)`);
      if (shouldCompact(agentName)) runCompaction(agentName).catch((err) => logError("Compaction", err));
      return antwort;
    }

    const allCalls = reply.tool_calls.map((tc) => tc as { id: string; function: { name: string; arguments: string } });
    const toolNames = allCalls.map((tc) => tc.function.name).join(", ");
    logInfo(`[${agentName}] Tools (Runde ${i + 1}): ${toolNames}`);

    // Pruefen ob "antworten" dabei ist
    const antwortCall = allCalls.find((tc) => tc.function.name === "antworten");
    const otherCalls = allCalls.filter((tc) => tc.function.name !== "antworten");

    // Zuerst alle anderen Tools ausfuehren (Seiteneffekte wie Speichern)
    const toolResults = await Promise.all(
      otherCalls.map(async (tc) => {
        let args: Record<string, string | number>;
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, string | number>;
        } catch {
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: `Fehler: Ungueltige Tool-Argumente fuer ${tc.function.name}.`,
          };
        }
        const result = await executeTool(tc.function.name, args);
        return { role: "tool" as const, tool_call_id: tc.id, content: result };
      }),
    );

    // Wenn "antworten" aufgerufen wurde → finale Antwort zurueckgeben
    if (antwortCall) {
      let antwortText = "Erledigt.";
      try {
        const antwortArgs = JSON.parse(antwortCall.function.arguments) as Record<string, string>;
        antwortText = antwortArgs.text || "Erledigt.";
      } catch {
        // Fallback bei fehlerhaften Argumenten
      }
      appendAgentConversation(agentName, userMessage, antwortText);
      logInfo(`[${agentName}] Antwort via antworten-Tool (Runde ${i + 1}, ${antwortText.length} Z)`);
      if (shouldCompact(agentName)) runCompaction(agentName).catch((err) => logError("Compaction", err));
      return antwortText;
    }

    messages.push(...toolResults);

    // Pruning — inkrementelle Berechnung statt O(n²) JSON.stringify pro Iteration
    let totalChars = 0;
    for (const m of messages) totalChars += typeof m.content === "string" ? m.content.length : 200;
    if (totalChars > MAX_HISTORY_CHARS) {
      // 1. Große Tool-Ergebnisse kuerzen (behalten aber Kontext)
      for (const m of messages) {
        if (m.role === "tool" && typeof m.content === "string" && m.content.length > TOOL_PRUNE_MAX_CHARS) {
          m.content = m.content.slice(0, TOOL_PRUNE_MAX_CHARS) + "\n[... gekuerzt]";
        }
      }
      // 2. Wenn immer noch zu groß: aelteste Tool-Messages entfernen
      const systemMsg = messages[0];
      const toolMsgs = messages.filter((m) => m.role === "tool");
      const nonToolMsgs = messages.filter((m) => m.role !== "tool");
      const keptTools = toolMsgs.slice(-KEPT_TOOL_MESSAGES);
      messages.splice(0, messages.length, systemMsg, ...nonToolMsgs.slice(1), ...keptTools);
    }
  }

  const fallback = "Ich konnte deine Anfrage nicht vollstaendig bearbeiten.";
  appendAgentConversation(agentName, userMessage, fallback);
  logInfo(`[${agentName}] Fallback nach ${MAX_TOOL_ROUNDS} Runden`);
  if (shouldCompact(agentName)) runCompaction(agentName).catch((err) => logError("Compaction", err));
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
