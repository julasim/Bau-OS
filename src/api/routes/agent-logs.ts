// ============================================================
// Bau-OS — Agent-Logs API
// Liefert die Tool-/Thought-/Event-Logs des Agent-Laufs.
// Quelle: logs/agent-logs.jsonl (immer FS, unabhaengig von DB_ENABLED).
// ============================================================

import { Hono } from "hono";
import { agentLogRepo } from "../../data/index.js";
import type { AppEnv } from "../server.js";

export const agentLogsRoutes = new Hono<AppEnv>();

// ── Liste (zuletzt / gefiltert) ─────────────────────────────────────────────
agentLogsRoutes.get("/agent-logs", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 500);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const sessionId = c.req.query("session") ?? undefined;
  const agentName = c.req.query("agent") ?? undefined;
  const toolName = c.req.query("tool") ?? undefined;
  const projectId = c.req.query("projectId") ?? undefined;
  const from = c.req.query("from") ?? undefined;
  const to = c.req.query("to") ?? undefined;

  if (sessionId || agentName || toolName || projectId || from || to) {
    const items = await agentLogRepo.query({
      sessionId,
      agentName,
      toolName,
      projectId,
      from,
      to,
      limit,
      offset,
    });
    return c.json({ enabled: true, items });
  }

  const items = await agentLogRepo.listRecent(limit, offset);
  return c.json({ enabled: true, items });
});

// ── Session-Detail ──────────────────────────────────────────────────────────
agentLogsRoutes.get("/agent-logs/session/:id", async (c) => {
  const id = c.req.param("id");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "200", 10) || 200, 1000);
  const items = await agentLogRepo.listBySession(id, limit);
  return c.json({ enabled: true, items });
});
