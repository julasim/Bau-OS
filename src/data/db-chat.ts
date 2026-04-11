// Datenbank-Implementation: Chat Sessions + Messages
import crypto from "crypto";
import { getDb } from "../db/client.js";
import type { ChatRepository, ChatSession, ChatMessage } from "./types.js";

function rowToSession(r: Record<string, unknown>): ChatSession {
  return {
    id: String(r.id),
    agent: String(r.agent),
    title: String(r.title),
    source: String(r.source),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    messageCount: r.message_count != null ? Number(r.message_count) : undefined,
    lastMessage: r.last_message != null ? String(r.last_message) : undefined,
  };
}

function rowToMessage(r: Record<string, unknown>): ChatMessage {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    role: String(r.role),
    content: String(r.content),
    tools: Array.isArray(r.tools) ? r.tools.map(String) : [],
    source: String(r.source ?? "web"),
    createdAt: String(r.created_at),
  };
}

export const dbChat: ChatRepository = {
  async createSession(agent = "Main", title = "Neuer Chat", source = "web") {
    const db = getDb();
    const id = crypto.randomUUID();
    const [row] = await db`
      INSERT INTO chat_sessions (id, agent, title, source)
      VALUES (${id}, ${agent}, ${title}, ${source})
      RETURNING *
    `;
    return rowToSession(row);
  },

  async listSessions(agent, limit = 50) {
    const db = getDb();
    const rows = agent
      ? await db`
          SELECT s.*,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id::text) AS message_count,
            (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id::text AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) AS last_message
          FROM chat_sessions s
          WHERE s.agent = ${agent}
          ORDER BY s.updated_at DESC
          LIMIT ${limit}
        `
      : await db`
          SELECT s.*,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id::text) AS message_count,
            (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id::text AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) AS last_message
          FROM chat_sessions s
          ORDER BY s.updated_at DESC
          LIMIT ${limit}
        `;
    return rows.map(rowToSession);
  },

  async deleteSession(id) {
    const db = getDb();
    let deleted = false;
    await db.begin(async (tx) => {
      await tx`DELETE FROM chat_messages WHERE session_id = ${id}`;
      const result = await tx`DELETE FROM chat_sessions WHERE id = ${id}`;
      deleted = result.count > 0;
    });
    return deleted;
  },

  async addMessage(sessionId, role, content, tools, source = "web") {
    const db = getDb();
    const id = crypto.randomUUID();
    const [row] = await db`
      INSERT INTO chat_messages (id, session_id, role, content, tools, source)
      VALUES (${id}, ${sessionId}, ${role}, ${content}, ${tools ?? []}, ${source})
      RETURNING *
    `;
    // Session-Titel aktualisieren bei erster User-Nachricht
    if (role === "user") {
      await db`
        UPDATE chat_sessions SET
          title = CASE WHEN title = 'Neuer Chat' THEN ${content.slice(0, 60)} ELSE title END,
          updated_at = now()
        WHERE id = ${sessionId}::uuid
      `;
    }
    return rowToMessage(row);
  },

  async getMessages(sessionId, limit = 100) {
    const db = getDb();
    const rows = await db`
      SELECT * FROM chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToMessage);
  },

  async getRecentHistory(agent = "Main", limit = 10) {
    const db = getDb();
    // Letzte Nachrichten-Paare aus der aktuellsten Session
    const rows = await db`
      SELECT m.role, m.content FROM chat_messages m
      JOIN chat_sessions s ON m.session_id = s.id::text
      WHERE s.agent = ${agent}
        AND m.role IN ('user', 'assistant')
      ORDER BY m.created_at DESC
      LIMIT ${limit * 2}
    `;

    // In Paare umwandeln (neueste zuerst → umkehren)
    const reversed = rows.reverse();
    const pairs: { user: string; assistant: string }[] = [];
    for (let i = 0; i < reversed.length - 1; i++) {
      if (reversed[i].role === "user" && reversed[i + 1]?.role === "assistant") {
        pairs.push({ user: String(reversed[i].content), assistant: String(reversed[i + 1].content) });
        i++;
      }
    }
    return pairs.slice(-limit);
  },

  async getOrCreateTodaySession(agent, source = "telegram") {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    // Heutige Session suchen
    const [existing] = await db`
      SELECT id FROM chat_sessions
      WHERE agent = ${agent}
        AND source = ${source}
        AND created_at::date = ${today}::date
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (existing) return String(existing.id);

    // Neue Session erstellen
    const id = crypto.randomUUID();
    await db`
      INSERT INTO chat_sessions (id, agent, title, source)
      VALUES (${id}, ${agent}, ${"Chat " + today}, ${source})
    `;
    return id;
  },
};
