// Datenbank-Implementation: Agent-Logs (nur DB, kein Filesystem-Equivalent)
import crypto from "crypto";
import { getDb } from "../db/client.js";
import type { AgentLog, AgentLogRepository } from "./types.js";

function rowToLog(row: Record<string, unknown>): AgentLog {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    agentName: String(row.agent_name),
    eventType: String(row.event_type),
    toolName: row.tool_name ? String(row.tool_name) : undefined,
    parameters: row.parameters as Record<string, unknown> | undefined,
    resultSummary: row.result_summary ? String(row.result_summary) : undefined,
    thought: row.thought ? String(row.thought) : undefined,
    error: row.error ? String(row.error) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    durationMs: row.duration_ms ? Number(row.duration_ms) : undefined,
    createdAt: String(row.created_at),
  };
}

export const dbAgentLogs: AgentLogRepository = {
  async create(log) {
    const db = getDb();
    const id = crypto.randomUUID();
    const [row] = await db`
      INSERT INTO agent_logs (id, session_id, agent_name, event_type, tool_name, parameters, result_summary, thought, error, project_id, duration_ms)
      VALUES (${id}, ${log.sessionId}, ${log.agentName}, ${log.eventType}, ${log.toolName ?? null}, ${log.parameters ? JSON.stringify(log.parameters) : null}::jsonb, ${log.resultSummary ?? null}, ${log.thought ?? null}, ${log.error ?? null}, ${log.projectId ?? null}, ${log.durationMs ?? null})
      RETURNING *
    `;
    return rowToLog(row);
  },

  async listBySession(sessionId, limit = 100) {
    const db = getDb();
    return (
      await db`
      SELECT * FROM agent_logs WHERE session_id = ${sessionId}
      ORDER BY created_at ASC LIMIT ${limit}
    `
    ).map(rowToLog);
  },

  async listRecent(limit = 50, offset = 0) {
    const db = getDb();
    return (
      await db`
      SELECT * FROM agent_logs ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    ).map(rowToLog);
  },

  async query(filters) {
    const db = getDb();
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Dynamische Filter zusammenbauen
    return (
      await db`
      SELECT * FROM agent_logs
      WHERE
        (${filters.sessionId ?? null}::text IS NULL OR session_id = ${filters.sessionId ?? ""})
        AND (${filters.agentName ?? null}::text IS NULL OR agent_name = ${filters.agentName ?? ""})
        AND (${filters.toolName ?? null}::text IS NULL OR tool_name = ${filters.toolName ?? ""})
        AND (${filters.projectId ?? null}::text IS NULL OR project_id = ${filters.projectId ?? ""}::uuid)
        AND (${filters.from ?? null}::timestamptz IS NULL OR created_at >= ${filters.from ?? "1970-01-01"}::timestamptz)
        AND (${filters.to ?? null}::timestamptz IS NULL OR created_at <= ${filters.to ?? "2099-01-01"}::timestamptz)
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    ).map(rowToLog);
  },
};
