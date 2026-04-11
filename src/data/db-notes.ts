// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { embedNote } from "../db/embeddings.js";
import { logError } from "../logger.js";
import type { NoteRepository } from "./types.js";

export const dbNotes: NoteRepository = {
  async save(content, project) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title =
      content
        .split("\n")[0]
        .replace(/^#+\s*/, "")
        .slice(0, 100) || "Notiz";

    let projectId: string | null = null;
    if (project) {
      const [p] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      projectId = p?.id ?? null;
    }

    await db`
      INSERT INTO notes (id, title, content, project_id, source, created_at, updated_at)
      VALUES (${id}, ${title}, ${content}, ${projectId}, 'bot', ${now}, ${now})
    `;

    // Auto-Embed im Hintergrund (fire-and-forget)
    embedNote(id, content).catch((err) => logError("[Embedding]", err));

    return id;
  },

  async list(limit = 10) {
    const db = getDb();
    const rows = await db`
      SELECT title, created_at FROM notes
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => String(r.title));
  },

  async listDetailed(limit = 50) {
    const db = getDb();
    const rows = await db`
      SELECT n.title, p.name as project_name, n.created_at, n.updated_at, length(n.content) as size
      FROM notes n
      LEFT JOIN projects p ON n.project_id = p.id
      ORDER BY n.updated_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      title: String(r.title),
      project: r.project_name ? String(r.project_name) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      size: Number(r.size || 0),
    }));
  },

  async read(nameOrPath) {
    const db = getDb();
    // Versuche ID, dann Titel
    const [row] = await db`
      SELECT content FROM notes
      WHERE id = ${nameOrPath} OR title = ${nameOrPath} OR title LIKE ${nameOrPath + "%"}
      ORDER BY created_at DESC LIMIT 1
    `;
    return row ? String(row.content) : null;
  },

  async append(nameOrPath, content) {
    const db = getDb();
    const now = new Date();
    const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
    const appendText = `\n**Nachtrag ${time}:** ${content}\n`;

    const result = await db`
      UPDATE notes SET
        content = content || ${appendText},
        updated_at = ${now.toISOString()}
      WHERE id = ${nameOrPath} OR title = ${nameOrPath} OR title LIKE ${nameOrPath + "%"}
    `;
    return result.count > 0;
  },

  async update(nameOrPath, content) {
    const db = getDb();
    const now = new Date().toISOString();
    const [row] = await db`
      UPDATE notes SET content = ${content}, updated_at = ${now}
      WHERE id = ${nameOrPath} OR title = ${nameOrPath} OR title LIKE ${nameOrPath + "%"}
      RETURNING id
    `;
    if (row) {
      // Re-embed mit neuem Content (fire-and-forget)
      embedNote(String(row.id), content).catch((err) => logError("[Embedding]", err));
    }
    return !!row;
  },

  async delete(nameOrPath) {
    const db = getDb();
    const [row] = await db`
      DELETE FROM notes
      WHERE id = ${nameOrPath} OR title = ${nameOrPath} OR title LIKE ${nameOrPath + "%"}
      RETURNING title
    `;
    return row ? String(row.title) : null;
  },
};
