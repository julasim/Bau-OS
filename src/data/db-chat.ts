// Datenbank-Implementation: Chat-Sessions + Messages (PostgreSQL)
//
// Replaces fs-chat.ts when DB_ENABLED=true. Persists to the chat_sessions
// and chat_messages tables created by migrations 001/002/033.
import { getDb } from "../db/client.js";
import type { ChatRepository, ChatSession, ChatMessage } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): ChatSession {
  return {
    id: String(row.id),
    agent: String(row.agent),
    title: String(row.title),
    source: String(row.source),
    userId: row.user_id ? String(row.user_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    messageCount: row.message_count !== undefined ? Number(row.message_count) : undefined,
    lastMessage: row.last_message ? String(row.last_message) : undefined,
  };
}

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: String(row.role),
    content: String(row.content),
    tools: Array.isArray(row.tools) ? (row.tools as string[]) : [],
    source: String(row.source ?? "web"),
    createdAt: String(row.created_at),
  };
}

// ── Repository ───────────────────────────────────────────────────────────────

export const dbChat: ChatRepository = {
  // ── createSession ───────────────────────────────────────────
  async createSession(agent = "Main", title = "Neuer Chat", source = "web", userId = null) {
    const db = getDb();
    const [row] = await db`
      INSERT INTO chat_sessions (agent, title, source, user_id)
      VALUES (${agent}, ${title}, ${source}, ${userId ?? null})
      RETURNING id, agent, title, source, user_id, created_at, updated_at
    `;
    return rowToSession(row);
  },

  // ── listSessions ────────────────────────────────────────────
  // Only web-source sessions, newest-first. Includes messageCount and
  // lastMessage (first user message in session) via window functions.
  async listSessions(agent, limit = 50, userId) {
    const db = getDb();

    // Subquery: first user message per session (for "lastMessage" preview)
    // Subquery: message count per session
    const base = db`
      SELECT
        s.id, s.agent, s.title, s.source, s.user_id, s.created_at, s.updated_at,
        COUNT(m.id)::int                                       AS message_count,
        (
          SELECT m2.content FROM chat_messages m2
          WHERE m2.session_id = s.id AND m2.role = 'user'
          ORDER BY m2.created_at ASC
          LIMIT 1
        )                                                      AS last_message
      FROM chat_sessions s
      LEFT JOIN chat_messages m ON m.session_id = s.id
      WHERE s.source = 'web'
        ${agent ? db`AND s.agent = ${agent}` : db``}
        ${
          userId !== undefined && userId !== null
            ? db`AND (
                s.user_id = ${userId}
                OR s.id IN (
                  SELECT session_id FROM chat_session_shares WHERE user_id = ${userId}
                )
              )`
            : db``
        }
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      LIMIT ${limit}
    `;

    const rows = await base;
    return rows.map(rowToSession);
  },

  // ── deleteSession ────────────────────────────────────────────
  async deleteSession(id) {
    const db = getDb();
    const result = await db`
      DELETE FROM chat_sessions WHERE id = ${id}
    `;
    return result.count > 0;
  },

  // ── addMessage ───────────────────────────────────────────────
  async addMessage(sessionId, role, content, tools, source = "web") {
    const db = getDb();
    const toolsArr = tools ?? [];

    const [row] = await db`
      INSERT INTO chat_messages (session_id, role, content, tools, source)
      VALUES (${sessionId}, ${role}, ${content}, ${db.array(toolsArr)}, ${source})
      RETURNING id, session_id, role, content, tools, source, created_at
    `;

    // Bump updated_at on parent session + auto-title on first user message
    if (role === "user") {
      // Check if this is the first user message and the title is still default
      const [first] = await db`
        SELECT s.title, COUNT(m.id)::int AS cnt
        FROM chat_sessions s
        LEFT JOIN chat_messages m ON m.session_id = s.id AND m.role = 'user'
        WHERE s.id = ${sessionId}
        GROUP BY s.title
        LIMIT 1
      `;
      if (first && first.title === "Neuer Chat" && Number(first.cnt) === 1) {
        const autoTitle = content.slice(0, 60);
        await db`
          UPDATE chat_sessions SET title = ${autoTitle}, updated_at = now()
          WHERE id = ${sessionId}
        `;
      } else {
        await db`UPDATE chat_sessions SET updated_at = now() WHERE id = ${sessionId}`;
      }
    } else {
      await db`UPDATE chat_sessions SET updated_at = now() WHERE id = ${sessionId}`;
    }

    return rowToMessage(row);
  },

  // ── getMessages ──────────────────────────────────────────────
  async getMessages(sessionId, limit = 100) {
    const db = getDb();
    const rows = await db`
      SELECT id, session_id, role, content, tools, source, created_at
      FROM chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows.map(rowToMessage);
  },

  // ── getRecentHistory ─────────────────────────────────────────
  // Returns user+assistant pairs from the most recent web session for agent.
  async getRecentHistory(agent = "Main", limit = 10) {
    const db = getDb();

    // Newest web session for this agent
    const [session] = await db`
      SELECT id FROM chat_sessions
      WHERE agent = ${agent} AND source = 'web'
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (!session) return [];

    const rows = await db`
      SELECT role, content FROM chat_messages
      WHERE session_id = ${session.id}
        AND role IN ('user', 'assistant')
      ORDER BY created_at ASC
    `;

    const pairs: { user: string; assistant: string }[] = [];
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i].role === "user" && rows[i + 1].role === "assistant") {
        pairs.push({ user: String(rows[i].content), assistant: String(rows[i + 1].content) });
        i++;
      }
    }
    return pairs.slice(-limit);
  },

  // ── getOrCreateTodaySession ──────────────────────────────────
  async getOrCreateTodaySession(agent, source = "telegram") {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const [existing] = await db`
      SELECT id FROM chat_sessions
      WHERE agent = ${agent}
        AND source = ${source}
        AND created_at::date = ${today}::date
      ORDER BY created_at ASC
      LIMIT 1
    `;
    if (existing) return String(existing.id);

    const [created] = await db`
      INSERT INTO chat_sessions (agent, title, source)
      VALUES (${agent}, ${"Chat " + today}, ${source})
      RETURNING id
    `;
    return String(created.id);
  },

  // ── searchMessages ───────────────────────────────────────────
  async searchMessages(query, limit = 10) {
    const db = getDb();
    const like = `%${query}%`;
    const rows = await db`
      SELECT id, session_id, role, content, tools, source, created_at
      FROM chat_messages
      WHERE content ILIKE ${like}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(rowToMessage);
  },

  // ── shareSession ─────────────────────────────────────────────
  async shareSession(sessionId, userId) {
    return dbChatShareSession(sessionId, userId);
  },

  // ── unshareSession ───────────────────────────────────────────
  async unshareSession(sessionId, userId) {
    return dbChatUnshareSession(sessionId, userId);
  },

  // ── listSessionShares ────────────────────────────────────────
  async listSessionShares(sessionId) {
    return dbChatListShares(sessionId);
  },
};

// ── Standalone sharing functions (DB-only, not part of interface) ─────────────

/** Gibt einer Person Leserecht auf eine Chat-Session. Idempotent. */
export async function dbChatShareSession(sessionId: string, userId: string): Promise<boolean> {
  const db = getDb();
  await db`
    INSERT INTO chat_session_shares (session_id, user_id)
    VALUES (${sessionId}, ${userId})
    ON CONFLICT DO NOTHING
  `;
  return true;
}

/** Entzieht den Zugriff einer Person auf eine Chat-Session. */
export async function dbChatUnshareSession(sessionId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db`
    DELETE FROM chat_session_shares
    WHERE session_id = ${sessionId} AND user_id = ${userId}
  `;
  return result.count > 0;
}

/** Liste aller Personen, mit denen eine Session geteilt wurde. */
export async function dbChatListShares(
  sessionId: string,
): Promise<{ userId: string; username: string; displayName: string | null; addedAt: string }[]> {
  const db = getDb();
  const rows = await db`
    SELECT u.id, u.username, u.display_name, css.added_at
    FROM chat_session_shares css
    JOIN users u ON u.id = css.user_id
    WHERE css.session_id = ${sessionId}
    ORDER BY u.username
  `;
  return rows.map((r) => ({
    userId: String(r.id),
    username: String(r.username),
    displayName: r.display_name ? String(r.display_name) : null,
    addedAt: String(r.added_at),
  }));
}
