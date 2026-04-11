import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type OpenAI from "openai";
import { client, buildDateLine } from "../../llm/client.js";
import { TOOLS } from "../../llm/tools.js";
import { getDynamicToolSchemas } from "../../tools.js";
import { getMcpToolSchemas } from "../../mcp.js";
import { executeTool } from "../../llm/executor.js";
import { loadAgentWorkspace, shouldCompact } from "../../workspace/index.js";
import { runCompaction } from "../../llm/compaction.js";
import { chatRepo } from "../../data/index.js";
import {
  MAX_HISTORY_CHARS,
  MAX_TOOL_ROUNDS,
  DB_ENABLED,
  KEPT_TOOL_MESSAGES,
  HISTORY_LOAD_LIMIT,
  getAgentModel,
} from "../../config.js";
import { logInfo, logError } from "../../logger.js";

export const chatRoutes = new Hono();

// ── Sessions auflisten ──────────────────────────────────────────────────────
chatRoutes.get("/chat/sessions", async (c) => {
  if (!DB_ENABLED || !chatRepo) return c.json([]);
  const sessions = await chatRepo.listSessions("Main");
  return c.json(sessions);
});

// ── Neue Session erstellen ──────────────────────────────────────────────────
chatRoutes.post("/chat/sessions", async (c) => {
  if (!DB_ENABLED || !chatRepo) return c.json({ error: "DB nicht aktiv" }, 500);
  const session = await chatRepo.createSession("Main");
  return c.json(session);
});

// ── Session loeschen ────────────────────────────────────────────────────────
chatRoutes.delete("/chat/sessions/:id", async (c) => {
  if (!DB_ENABLED || !chatRepo) return c.json({ error: "DB nicht aktiv" }, 500);
  const id = c.req.param("id");
  await chatRepo.deleteSession(id);
  return c.json({ success: true });
});

// ── Nachrichten einer Session laden ─────────────────────────────────────────
chatRoutes.get("/chat/sessions/:id/messages", async (c) => {
  if (!DB_ENABLED || !chatRepo) return c.json([]);
  const id = c.req.param("id");
  const messages = await chatRepo.getMessages(id);
  return c.json(messages);
});

// ── Chat-Nachricht senden ───────────────────────────────────────────────────
chatRoutes.post("/chat", (c) => {
  return streamSSE(c, async (stream) => {
    let body: { message: string; sessionId?: string };
    try {
      body = await c.req.json<{ message: string; sessionId?: string }>();
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

    // Session bestimmen: explizit uebergeben oder neue erstellen
    let sessionId = body.sessionId;
    if (DB_ENABLED && chatRepo) {
      if (!sessionId) {
        const session = await chatRepo.createSession(agentName);
        sessionId = session.id;
      }
      // User-Nachricht in DB speichern
      await chatRepo.addMessage(sessionId, "user", userMessage);
      // Session-ID an Client senden
      await stream.writeSSE({ event: "session", data: JSON.stringify({ sessionId }) });
    }

    const workspaceContext = loadAgentWorkspace(agentName, "full");
    const dateLine = buildDateLine();
    const systemPrompt = workspaceContext ? `${dateLine}\n\n${workspaceContext}` : dateLine;

    // History aus DB oder leer
    let history: { user: string; assistant: string }[] = [];
    if (DB_ENABLED && chatRepo) {
      history = await chatRepo.getRecentHistory(agentName, HISTORY_LOAD_LIMIT);
    }

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

    const collectedTools: string[] = [];

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
          // In DB speichern
          if (DB_ENABLED && chatRepo && sessionId) {
            await chatRepo.addMessage(sessionId, "assistant", antwort, collectedTools);
          }
          await stream.writeSSE({ event: "response", data: JSON.stringify({ text: antwort }) });
          if (shouldCompact(agentName)) runCompaction(agentName).catch((err) => logError("Compaction", err));
          return;
        }

        const allCalls = reply.tool_calls.map(
          (tc) => tc as { id: string; function: { name: string; arguments: string } },
        );
        const antwortCall = allCalls.find((tc) => tc.function.name === "antworten");
        const otherCalls = allCalls.filter((tc) => tc.function.name !== "antworten");

        for (const tc of otherCalls) {
          collectedTools.push(tc.function.name);
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
          // In DB speichern
          if (DB_ENABLED && chatRepo && sessionId) {
            await chatRepo.addMessage(sessionId, "assistant", antwortText, collectedTools);
          }
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
      if (DB_ENABLED && chatRepo && sessionId) {
        await chatRepo.addMessage(sessionId, "assistant", fallback, collectedTools);
      }
      await stream.writeSSE({ event: "response", data: JSON.stringify({ text: fallback }) });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError("[Chat] Error", err);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: `LLM-Fehler: ${errMsg}` }) });
    }
  });
});
