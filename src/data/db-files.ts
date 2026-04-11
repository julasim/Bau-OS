// Datenbank-Implementation: files Tabelle (PostgreSQL)
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { embedFile } from "../db/embeddings.js";
import type { FileEntry, FileRepository } from "./types.js";

function rowToFile(row: Record<string, unknown>): FileEntry {
  return {
    id: String(row.id),
    filename: String(row.filename),
    filepath: String(row.filepath),
    filetype: row.filetype ? String(row.filetype) : null,
    filesize: Number(row.filesize || 0),
    mimeType: row.mime_type ? String(row.mime_type) : null,
    contentText: row.content_text ? String(row.content_text) : null,
    summary: row.summary ? String(row.summary) : null,
    project: row.project_name ? String(row.project_name) : null,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    analyzed: !!row.analyzed,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const dbFiles: FileRepository = {
  async save(file) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const ext = file.filename.split(".").pop()?.toLowerCase() || "";

    let projectId: string | null = null;
    if (file.project) {
      const [p] = await db`SELECT id FROM projects WHERE name = ${file.project} LIMIT 1`;
      projectId = p?.id ?? null;
    }

    const [row] = await db`
      INSERT INTO files (id, filename, filepath, filetype, filesize, mime_type, content_text, project_id, created_at, updated_at)
      VALUES (${id}, ${file.filename}, ${file.filepath}, ${ext}, ${file.filesize}, ${file.mimeType ?? null}, ${file.contentText ?? null}, ${projectId}, ${now}, ${now})
      RETURNING *, (SELECT name FROM projects WHERE id = project_id) as project_name
    `;

    // Auto-Embed wenn Text vorhanden (fire-and-forget)
    if (file.contentText) {
      embedFile(id, file.contentText).catch(() => {});
    }

    return rowToFile(row);
  },

  async list(project, limit = 50) {
    const db = getDb();
    if (project) {
      return (
        await db`
        SELECT f.*, p.name as project_name FROM files f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE p.name = ${project}
        ORDER BY f.created_at DESC
        LIMIT ${limit}
      `
      ).map(rowToFile);
    }
    return (
      await db`
      SELECT f.*, p.name as project_name FROM files f
      LEFT JOIN projects p ON f.project_id = p.id
      ORDER BY f.created_at DESC
      LIMIT ${limit}
    `
    ).map(rowToFile);
  },

  async get(id) {
    const db = getDb();
    const [row] = await db`
      SELECT f.*, p.name as project_name FROM files f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.id = ${id} OR f.filename = ${id} OR f.filepath = ${id}
      LIMIT 1
    `;
    return row ? rowToFile(row) : null;
  },

  async search(query, limit = 20) {
    const db = getDb();
    const like = `%${query}%`;
    return (
      await db`
      SELECT f.*, p.name as project_name FROM files f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.filename ILIKE ${like}
        OR f.content_text ILIKE ${like}
        OR f.filepath ILIKE ${like}
      ORDER BY f.updated_at DESC
      LIMIT ${limit}
    `
    ).map(rowToFile);
  },

  async delete(id) {
    const db = getDb();
    const result = await db`
      DELETE FROM files WHERE id = ${id} OR filename = ${id} OR filepath = ${id}
    `;
    return result.count > 0;
  },

  async updateContent(id, contentText) {
    const db = getDb();
    const now = new Date().toISOString();
    const result = await db`
      UPDATE files SET content_text = ${contentText}, analyzed = true, updated_at = ${now}
      WHERE id = ${id}
    `;
    if (result.count > 0) {
      embedFile(id, contentText).catch(() => {});
    }
    return result.count > 0;
  },
};
