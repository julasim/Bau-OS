import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type OpenAI from "openai";
import { client, buildDateLine } from "../../llm/client.js";
import { TOOLS } from "../../llm/tools.js";
import { buildToolWhitelist } from "../../llm/whitelist.js";
import { getDynamicToolSchemas } from "../../tools.js";
import { getMcpToolSchemas } from "../../mcp.js";
import { executeTool } from "../../llm/executor.js";
import { loadAgentWorkspace, shouldCompact } from "../../workspace/index.js";
import { runCompaction } from "../../llm/compaction.js";
import { isActionRequest, ACTION_HINT, TOOL_SKIP_CORRECTION, MAX_TOOL_SKIP_RETRIES } from "../../llm/actions.js";
import { chatRepo } from "../../data/index.js";
import {
  MAX_HISTORY_CHARS,
  MAX_TOOL_ROUNDS,
  KEPT_TOOL_MESSAGES,
  HISTORY_LOAD_LIMIT,
  getAgentModel,
} from "../../config.js";
import { logInfo, logError } from "../../logger.js";
import type { AppEnv } from "../server.js";

export const chatRoutes = new Hono<AppEnv>();

// Rate-Limit: max 30 Anfragen pro Minute pro User
const chatAttempts = new Map<string, { count: number; resetAt: number }>();
const CHAT_RATE_LIMIT = 30;
const CHAT_RATE_WINDOW_MS = 60_000;

function chatRateLimit(username: string): boolean {
  const now = Date.now();
  const entry = chatAttempts.get(username);
  if (entry && now < entry.resetAt) {
    if (entry.count >= CHAT_RATE_LIMIT) return false;
    entry.count++;
  } else {
    chatAttempts.set(username, { count: 1, resetAt: now + CHAT_RATE_WINDOW_MS });
  }
  return true;
}

// ── Sessions auflisten ──────────────────────────────────────────────────────
chatRoutes.get("/chat/sessions", async (c) => {
  const jwtUser = c.get("user") as { username: string; role: string };
  const userId = c.get("userId") as string | null | undefined;
  // Admins sehen alle Sessions (inkl. Legacy-Sessions ohne userId).
  // Non-Admins sehen nur ihre eigenen Sessions.
  // undefined → Admin-Ansicht (alles), string → eigene + geteilte, null → anonym
  const filterUserId: string | null | undefined = jwtUser.role === "admin" ? undefined : (userId ?? null);
  const sessions = await chatRepo.listSessions("Main", 50, filterUserId);
  return c.json(sessions);
});

// ── Neue Session erstellen ──────────────────────────────────────────────────
chatRoutes.post("/chat/sessions", async (c) => {
  const userId = c.get("userId") as string | null | undefined;
  const session = await chatRepo.createSession("Main", "Neuer Chat", "web", userId ?? null);
  return c.json(session);
});

// ── Session loeschen ────────────────────────────────────────────────────────
chatRoutes.delete("/chat/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId") as string | null | undefined;
  const userRole = c.get("userRole") as string | undefined;

  if (userRole !== "admin") {
    // Auch ohne userId (null) keinen Zugriff auf fremde Sessions gewähren
    const sessions = await chatRepo.listSessions("Main", 200, userId ?? null);
    const hasAccess = sessions.some((s) => s.id === id);
    if (!hasAccess) return c.json({ error: "Kein Zugriff" }, 403);
  }

  await chatRepo.deleteSession(id);
  return c.json({ success: true });
});

// ── Session-Zugriffe auflisten ───────────────────────────────────────────────
chatRoutes.get("/chat/sessions/:id/shares", async (c) => {
  const id = c.req.param("id");
  if (!chatRepo.listSessionShares) return c.json([]);
  const shares = await chatRepo.listSessionShares(id);
  return c.json(shares);
});

// ── Session teilen ───────────────────────────────────────────────────────────
chatRoutes.post("/chat/sessions/:id/shares", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ userId: string }>();
  if (!body.userId) return c.json({ error: "userId erforderlich" }, 400);
  if (!chatRepo.shareSession) return c.json({ error: "Nur im DB-Modus verfügbar" }, 503);
  const ok = await chatRepo.shareSession(id, body.userId);
  return c.json({ ok });
});

// ── Session-Zugriff entziehen ────────────────────────────────────────────────
chatRoutes.delete("/chat/sessions/:id/shares/:userId", async (c) => {
  const id = c.req.param("id");
  const userId = c.req.param("userId");
  if (!chatRepo.unshareSession) return c.json({ error: "Nur im DB-Modus verfügbar" }, 503);
  const ok = await chatRepo.unshareSession(id, userId);
  return c.json({ ok });
});

// ── Nachrichten einer Session laden ─────────────────────────────────────────
chatRoutes.get("/chat/sessions/:id/messages", async (c) => {
  const id = c.req.param("id");
  const userId = c.get("userId") as string | null | undefined;
  const userRole = c.get("userRole") as string | undefined;

  // Ownership/share check: admin sees all, others check ownership or share
  if (userRole !== "admin") {
    // Auch ohne userId (null) keinen Zugriff auf fremde Sessions gewähren
    const sessions = await chatRepo.listSessions("Main", 200, userId ?? null);
    const hasAccess = sessions.some((s) => s.id === id);
    if (!hasAccess) return c.json({ error: "Kein Zugriff" }, 403);
  }

  const messages = await chatRepo.getMessages(id);
  return c.json(messages);
});

// ── Chat-Nachricht senden ───────────────────────────────────────────────────
chatRoutes.post("/chat", (c) => {
  return streamSSE(c, async (stream) => {
    let body: { message: string; sessionId?: string; searchMode?: boolean; projectFilter?: string | null };
    try {
      body = await c.req.json<{
        message: string;
        sessionId?: string;
        searchMode?: boolean;
        projectFilter?: string | null;
      }>();
    } catch {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "Ungueltiger Request" }) });
      return;
    }

    if (!body.message?.trim()) {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "Nachricht erforderlich" }) });
      return;
    }

    const jwtUser = c.get("user") as { username: string; role: string };
    const userId = c.get("userId") as string | null | undefined;
    if (!chatRateLimit(jwtUser.username)) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: "Zu viele Anfragen. Bitte kurz warten." }),
      });
      return;
    }

    const agentName = "Main";
    const userMessage = body.message.trim();
    const searchMode = body.searchMode === true;
    const projectFilter = body.projectFilter ? String(body.projectFilter) : null;

    logInfo(`[Chat] ${userMessage.slice(0, 80)}${searchMode ? " [Dateisuche an]" : ""}`);

    // Session bestimmen: explizit uebergeben oder neue erstellen
    let sessionId = body.sessionId;
    if (!sessionId) {
      const session = await chatRepo.createSession(agentName, "Neuer Chat", "web", userId ?? null);
      sessionId = session.id;
    }
    try {
      await chatRepo.addMessage(sessionId, "user", userMessage);
    } catch (e) {
      logError("[Chat]", e);
    }
    await stream.writeSSE({ event: "session", data: JSON.stringify({ sessionId }) });

    const workspaceContext = loadAgentWorkspace(agentName, "full");
    const dateLine = buildDateLine();
    const toolWhitelist = buildToolWhitelist();
    const baseSystemPrompt = workspaceContext
      ? `${dateLine}\n\n${workspaceContext}\n\n${toolWhitelist}`
      : `${dateLine}\n\n${toolWhitelist}`;

    const isAction = isActionRequest(userMessage);

    // Wenn Dateisuche aktiv: LLM zwingen das Tool 'semantisch_suchen' zu nutzen
    const searchHint = searchMode
      ? `\n\nWICHTIG: Der Benutzer hat die Dateisuche aktiviert. Du MUSST das Tool \`semantisch_suchen\` aufrufen, bevor du antwortest. Nutze die Suchergebnisse als Grundlage fuer deine Antwort und verweise auf die gefundenen Quellen.${
          projectFilter
            ? ` Beschraenke die Suche auf das Projekt "${projectFilter}" (Parameter projekt="${projectFilter}").`
            : ""
        }`
      : "";
    // Bei Aktions-Anfragen zusaetzlich in-message-Hint — tool_choice: "required"
    // reicht bei kleineren Modellen (Ollama) nicht, die schummeln sich mit
    // leerem tool_calls-Array durch. Ein expliziter deutscher Befehl im
    // System-Prompt erhoeht die Erfolgsrate messbar.
    const actionHint = isAction ? ACTION_HINT : "";
    const systemPrompt = baseSystemPrompt + searchHint + actionHint;

    const history = await chatRepo.getRecentHistory(agentName, HISTORY_LOAD_LIMIT);

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

    // Retry-Counter fuer Modelle, die tool_choice=required ignorieren.
    // Konstanten aus ../../llm/actions.js (shared mit runtime.ts).
    let actionToolSkipRetries = 0;

    try {
      const allTools = [...TOOLS, ...getDynamicToolSchemas(), ...getMcpToolSchemas()];
      // Bei klaren Aktions-Anfragen in Runde 1: antworten-Tool rausfiltern,
      // damit der LLM gezwungen ist, die echte Aktion aufzurufen (projekt_anlegen,
      // notiz_speichern, ...). Ab Runde 2 wieder alle Tools verfuegbar, damit
      // das Modell nach der Aktion auch antworten kann.
      const toolsWithoutAntworten = allTools.filter((t) => !(t.type === "function" && t.function.name === "antworten"));

      for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
        const forceActionInRound1 = isAction && i === 0;
        const effectiveTools = forceActionInRound1 ? toolsWithoutAntworten : allTools;
        // Tool-Choice-Strategie:
        // - Runde 1 mit aktiver Dateisuche: 'semantisch_suchen' erzwingen.
        // - Runde 1 bei Aktions-Anfrage: 'required' + antworten rausgefiltert.
        // - Sonst IMMER 'required' — damit das Modell keine Antwort halluzinieren
        //   kann ohne vorher die noetige Aktion (z.B. projekt_anlegen) auszufuehren.
        const toolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption =
          searchMode && i === 0 ? { type: "function", function: { name: "semantisch_suchen" } } : "required";
        let response: Awaited<ReturnType<typeof client.chat.completions.create>>;
        try {
          response = await client.chat.completions.create({
            model: activeModel,
            messages,
            tools: effectiveTools,
            tool_choice: toolChoice,
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
          // Hartes Halluzinations-Netz: Bei Aktions-Anfragen in Runde 1 IGNORIEREN
          // wir die reine Text-Antwort und geben stattdessen einen ehrlichen Fehler.
          // Grund: Das Modell ignoriert in diesem Fall tool_choice: "required"
          // (bekanntes Ollama-Problem bei kleineren Modellen) und faked Erfolg
          // ("Alle Termine gespeichert") ohne irgendetwas getan zu haben.
          if (isAction && i === 0) {
            // Retry-Zweig: Dem Modell einen verstaerkten Hint geben und die
            // gleiche Runde nochmal spielen lassen. Die fehlerhafte Assistant-
            // Reply bleibt in `messages` — das Modell sieht seinen eigenen Fehler
            // und die Korrektur-User-Message direkt dahinter. Das hilft messbar
            // gegen das "Erledigt"-ohne-Tool-Call Problem bei Kimi-K2.5 & Co.
            if (actionToolSkipRetries < MAX_TOOL_SKIP_RETRIES) {
              actionToolSkipRetries++;
              messages.push({ role: "user", content: TOOL_SKIP_CORRECTION });
              logInfo(
                `[Chat] Tool-Skip Retry ${actionToolSkipRetries}/${MAX_TOOL_SKIP_RETRIES} ` +
                  `fuer "${userMessage.slice(0, 60)}" (Modell: ${activeModel})`,
              );
              await stream.writeSSE({
                event: "status",
                data: JSON.stringify({ status: "retry", attempt: actionToolSkipRetries }),
              });
              i--; // Runde 0 wiederholen — Retry zaehlt nicht als Tool-Round
              continue;
            }

            // Retries erschoepft → User-sichtbare Warnung
            const warnung =
              `\u26A0\uFE0F Das Modell hat ${MAX_TOOL_SKIP_RETRIES + 1}x behauptet, die Aktion ausgefuehrt zu haben, ` +
              `aber keinen Tool-Call gemacht — es wurde also NICHTS gespeichert. ` +
              `Das Modell "${activeModel}" ignoriert tool_choice=required hartnaeckig. ` +
              `Probiere ein groesseres Modell (z.B. ueber /model) oder formuliere die Anfrage anders.`;
            logError(
              "[Chat] Modell hat tool_choice=required nach Retries ignoriert",
              new Error(
                `Action-Request ohne tool_calls nach ${MAX_TOOL_SKIP_RETRIES} Retries. Modell: ${activeModel}. Letzte Antwort: ${(reply.content ?? "").slice(0, 200)}`,
              ),
            );
            if (sessionId) {
              try {
                await chatRepo.addMessage(sessionId, "assistant", warnung, collectedTools);
              } catch (e) {
                logError("[Chat]", e);
              }
            }
            await stream.writeSSE({ event: "response", data: JSON.stringify({ text: warnung }) });
            return;
          }

          const antwort = reply.content ?? "Erledigt.";
          if (sessionId) {
            try {
              await chatRepo.addMessage(sessionId, "assistant", antwort, collectedTools);
            } catch (e) {
              logError("[Chat]", e);
            }
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
          if (sessionId) {
            try {
              await chatRepo.addMessage(sessionId, "assistant", antwortText, collectedTools);
            } catch (e) {
              logError("[Chat]", e);
            }
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

      // Tool-Loop ist ohne 'antworten'-Call ausgelaufen — gib dem User wenigstens
      // einen Hinweis was passiert ist (welche Tools wurden versucht). Bewusst
      // keine Zahl nennen: aus User-Sicht ist das EINE Anfrage, nicht X Schritte.
      const toolSummary = collectedTools.length ? collectedTools.join(", ") : "(keine)";
      const fallback =
        `Ich konnte deine Anfrage nicht vollstaendig abschliessen. ` +
        `Ausgefuehrte Tools: ${toolSummary}. ` +
        `Bitte formuliere die Anfrage praeziser oder zerlege sie in Teilschritte.`;
      if (sessionId) {
        try {
          await chatRepo.addMessage(sessionId, "assistant", fallback, collectedTools);
        } catch (e) {
          logError("[Chat]", e);
        }
      }
      await stream.writeSSE({ event: "response", data: JSON.stringify({ text: fallback }) });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError("[Chat] Error", err);
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: `LLM-Fehler: ${errMsg}` }) });
    }
  });
});
