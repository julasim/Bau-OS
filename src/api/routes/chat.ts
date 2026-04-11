import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type OpenAI from "openai";
import { client, buildDateLine } from "../../llm/client.js";
import { TOOLS } from "../../llm/tools.js";
import { getDynamicToolSchemas } from "../../tools.js";
import { getMcpToolSchemas } from "../../mcp.js";
import { executeTool } from "../../llm/executor.js";
import {
  loadAgentWorkspace,
  appendAgentConversation,
  loadAgentHistory,
  loadAgentHistoryByDate,
  listAgentSessions,
  shouldCompact,
} from "../../workspace/index.js";
import { runCompaction } from "../../llm/compaction.js";
import {
  MAX_HISTORY_CHARS,
  MAX_TOOL_ROUNDS,
  KEPT_TOOL_MESSAGES,
  HISTORY_LOAD_LIMIT,
  getAgentModel,
} from "../../config.js";
import { logInfo, logError } from "../../logger.js";

export const chatRoutes = new Hono();

// ── Chat-Sessions auflisten ──────────────────────────────────────────────────
chatRoutes.get("/chat/sessions", (c) => {
  const sessions = listAgentSessions("Main");
  return c.json(sessions);
});

// ── Chatverlauf laden ────────────────────────────────────────────────────────
chatRoutes.get("/chat/history", (c) => {
  const date = c.req.query("date");
  if (date) {
    return c.json(loadAgentHistoryByDate("Main", date));
  }
  return c.json(loadAgentHistory("Main", HISTORY_LOAD_LIMIT));
});

chatRoutes.post("/chat", (c) => {
  return streamSSE(c, async (stream) => {
    let body: { message: string };
    try {
      body = await c.req.json<{ message: string }>();
    } catch {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "Ungueltiger Request" }) });
      return;
    }

    if (!body.message?.trim()) {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "Nachricht erforderlich" }) });
      return;
    }

    const agentName = "Main";
    const userMessage = body.message.trim();

    logInfo(`[Chat] ${userMessage.slice(0, 80)}`);

    const workspaceContext = loadAgentWorkspace(agentName, "full");
    const dateLine = buildDateLine();
    const systemPrompt = workspaceContext ? `${dateLine}\n\n${workspaceContext}` : dateLine;
    const history = loadAgentHistory(agentName, HISTORY_LOAD_LIMIT);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.flatMap((h) => [
        { role: "user" as const, content: h.user },
        { role: "assistant" as const, content: h.assistant },
      ]),
      { role: "user", content: userMessage },
    ];

    const activeModel = getAgentModel(agentName);

    await stream.writeSSE({ event: "status", data: JSON.stringify({ status: "thinking" }) });

    try {
      const allTools = [...TOOLS, ...getDynamicToolSchemas(), ...getMcpToolSchemas()];

      for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
        let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
        try {
          response = await client.chat.completions.create({
            model: activeModel,
            messages,
            tools: allTools,
            tool_choice: "auto",
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logError("[Chat] LLM-Aufruf fehlgeschlagen", err);
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: `LLM-Fehler: ${errMsg}` }) });
          return;
        }

        const reply = response.choices[0].message;
        messages.push(reply);

        if (!reply.tool_calls || reply.tool_calls.length === 0) {
          const antwort = reply.content ?? "Erledigt.";
          appendAgentConversation(agentName, userMessage, antwort);
          await stream.writeSSE({ event: "response", data: JSON.stringify({ text: antwort }) });
          if (shouldCompact(agentName)) runCompaction(agentName).catch((err) => logError("Compaction", err));
          return;
        }

        const allCalls = reply.tool_calls.map(
          (tc) => tc as { id: string; function: { name: string; arguments: string } },
        );
        const antwortCall = allCalls.find((tc) => tc.function.name === "antworten");
        const otherCalls = allCalls.filter((tc) => tc.function.name !== "antworten");

        // Tool-Calls an Client senden
        for (const tc of otherCalls) {
          await stream.writeSSE({
            event: "tool_call",
            data: JSON.stringify({ tool: tc.function.name, args: tc.function.arguments }),
          });
        }

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

        if (antwortCall) {
          let antwortText = "Erledigt.";
          try {
            const antwortArgs = JSON.parse(antwortCall.function.arguments) as Record<string, string>;
            antwortText = antwortArgs.text || "Erledigt.";
          } catch {
            // Fallback
          }
          appendAgentConversation(agentName, userMessage, antwortText);
          await stream.writeSSE({ event: "response", data: JSON.stringify({ text: antwortText }) });
          if (shouldCompact(agentName)) runCompaction(agentName).catch((err) => logError("Compaction", err));
          return;
        }

        messages.push(...toolResults);

        // Pruning
        const totalChars = messages.reduce((s, m) => s + JSON.stringify(m).length, 0);
        if (totalChars > MAX_HISTORY_CHARS) {
          const systemMsg = messages[0];
          const toolMsgs = messages.filter((m) => m.role === "tool");
          const nonToolMsgs = messages.filter((m) => m.role !== "tool");
          const keptTools = toolMsgs.slice(-KEPT_TOOL_MESSAGES);
          messages.splice(0, messages.length, systemMsg, ...nonToolMsgs.slice(1), ...keptTools);
        }

        await stream.writeSSE({ event: "status", data: JSON.stringify({ status: "thinking", round: i + 2 }) });
      }

      const fallback = "Ich konnte deine Anfrage nicht vollstaendig bearbeiten.";
      appendAgentConversation(agentName, userMessage, fallback);
      await stream.writeSSE({ event: "response", data: JSON.stringify({ text: fallback }) });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError("[Chat] Error", err);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: `LLM-Fehler: ${errMsg}` }) });
    }
  });
});
