// Datenbank-Implementation: files Tabelle (PostgreSQL)
import crypto from "crypto";
import { getDb } from "../db/client.js";
import type { FileEntry, FileRepository, FileShareEntry } from "./types.js";

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

/** Postgres' TEXT-Spalte erlaubt KEINE NUL-Bytes (\x00). Text-Extraktion
 *  aus binaeren Formaten (PDF, DOCX, Bildern mit OCR) hinterlaesst hin und
 *  wieder NULs aus Binaer-Header-Metadaten — der INSERT crasht dann mit:
 *    "invalid byte sequence for encoding "UTF8": 0x00"
 *
 *  Wir strippen NULs defensiv hier in der Save-Schicht. Zusaetzlich
 *  ungueltige Surrogate (lone high/low) werden ersetzt, damit auch
 *  kaputtes Unicode (haeufig aus DWG-Metadaten) durchgeht. */
function sanitizeTextForPg(s: string | null | undefined): string | null {
  if (!s) return null;
  // NUL-Bytes raus. eslint-disable: control-character im Pattern ist hier
  // genau der Punkt — postgres TEXT lehnt sie ab.
  // eslint-disable-next-line no-control-regex
  let out = s.replace(/\x00/g, "");
  // Lone Surrogates — postgres.js encodet UTF-16 → UTF-8, lone surrogates
  // brechen die Konvertierung. Replacement-Char einsetzen.
  out = out.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  return out;
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

    // contentText defensiv durchputzen — NUL-Bytes aus Text-Extraktion
    // killen sonst den INSERT (Postgres TEXT akzeptiert keine NUL).
    const safeContentText = sanitizeTextForPg(file.contentText);

    // blob: Buffer → bytea. postgres.js serialisiert Buffer automatisch,
    //                wir muessen nichts encoden. NULL, wenn kein Blob
    //                uebergeben wurde (Legacy/Metadaten-only).
    const [row] = await db`
      INSERT INTO files (id, filename, filepath, filetype, filesize, mime_type, content_text, project_id, blob, uploaded_by, created_at, updated_at)
      VALUES (${id}, ${file.filename}, ${file.filepath}, ${ext}, ${file.filesize}, ${file.mimeType ?? null}, ${safeContentText}, ${projectId}, ${file.blob ?? null}, ${file.uploadedById ?? null}, ${now}, ${now})
      RETURNING id, filename, filepath, filetype, filesize, mime_type, content_text, summary, tags, analyzed, created_at, updated_at, (SELECT name FROM projects WHERE id = project_id) as project_name
    `;

    if (!row) throw new Error("Datei konnte nicht gespeichert werden");

    return rowToFile(row);
  },

  async list(project, limit = 50, visibleProjectIds) {
    const db = getDb();
    if (project) {
      // ACL-Scoping: wenn visibleProjectIds gesetzt ist (Non-Admin), pruefen ob
      // das angefragte Projekt in der Sichtbarkeitsliste liegt. Ein leeres Array
      // bedeutet "kein Zugriff auf irgendein Projekt" — sofort leer zurueck.
      if (visibleProjectIds !== undefined) {
        if (visibleProjectIds.length === 0) return [];
        // Projekt-ID fuer diesen Namen nachschlagen und ACL pruefen.
        const [proj] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
        if (!proj || !visibleProjectIds.includes(String(proj.id))) return [];
      }
      return (
        await db`
        SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize, f.mime_type, f.content_text, f.summary, f.tags, f.analyzed, f.created_at, f.updated_at, p.name as project_name FROM files f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE p.name = ${project}
        ORDER BY f.created_at DESC
        LIMIT ${limit}
      `
      ).map(rowToFile);
    }
    // Non-Admin-Scoping: nur Dateien aus sichtbaren Projekten.
    // Dateien ohne Projekt-Zuordnung (project_id IS NULL) werden nicht
    // gezeigt — ohne Projekt-Kontext gibt es keinen ACL-Anhaltspunkt.
    if (visibleProjectIds !== undefined && visibleProjectIds.length > 0) {
      return (
        await db`
        SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize, f.mime_type, f.content_text, f.summary, f.tags, f.analyzed, f.created_at, f.updated_at, p.name as project_name FROM files f
        LEFT JOIN projects p ON f.project_id = p.id
        -- ::uuid[] ist Pflicht: project_id ist uuid, die Scope-IDs kommen als
        -- JS-Strings. Ohne Cast wirft Postgres "operator does not exist:
        -- uuid = text" und die Route endet in einem 500. Der Fehler traf nur
        -- Non-Admins mit NICHT-leerem Scope — bei leerem Scope greift der
        -- Short-Circuit unten und die Query laeuft nie.
        WHERE f.project_id = ANY(${db.array(visibleProjectIds)}::uuid[])
        ORDER BY f.created_at DESC
        LIMIT ${limit}
      `
      ).map(rowToFile);
    }
    if (visibleProjectIds !== undefined && visibleProjectIds.length === 0) {
      // User hat Zugriff auf kein Projekt → keine Dateien
      return [];
    }
    return (
      await db`
      SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize, f.mime_type, f.content_text, f.summary, f.tags, f.analyzed, f.created_at, f.updated_at, p.name as project_name FROM files f
      LEFT JOIN projects p ON f.project_id = p.id
      ORDER BY f.created_at DESC
      LIMIT ${limit}
    `
    ).map(rowToFile);
  },

  async get(id) {
    const db = getDb();
    // f.id::text verhindert "invalid input syntax for type uuid" wenn filename
    // oder filepath statt einer UUID uebergeben wird.
    const [row] = await db`
      SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize, f.mime_type, f.content_text, f.summary, f.tags, f.analyzed, f.created_at, f.updated_at, p.name as project_name FROM files f
      LEFT JOIN projects p ON f.project_id = p.id
      WHERE f.id::text = ${id} OR f.filename = ${id} OR f.filepath = ${id}
      LIMIT 1
    `;
    return row ? rowToFile(row) : null;
  },

  async readBlob(id) {
    const db = getDb();
    // id::text verhindert "invalid input syntax for type uuid" wenn filename
    // oder filepath statt einer UUID uebergeben wird.
    const [row] = await db`
      SELECT blob, mime_type, filename FROM files
      WHERE id::text = ${id} OR filename = ${id} OR filepath = ${id}
      LIMIT 1
    `;
    if (!row || !row.blob) return null;
    // postgres.js gibt bytea als Buffer zurueck (Node-native)
    const blob = row.blob as Buffer;
    return {
      blob,
      mimeType: row.mime_type ? String(row.mime_type) : null,
      filename: String(row.filename),
    };
  },

  async search(query, limit = 20, visibleProjectIds) {
    const db = getDb();
    const like = `%${query}%`;
    // ACL-Scoping analog zu list(): ohne diesen Filter lieferte die Suche
    // fremde Dateien samt vollem content_text aus — mit ?q=% den gesamten
    // Bestand. Die Methode kannte den Scope schlicht nicht.
    // Dateien ohne project_id bleiben fuer Non-Admins ausgeblendet: ohne
    // Projekt-Kontext gibt es keinen ACL-Anhaltspunkt (gleiche Regel wie list()).
    if (visibleProjectIds !== undefined) {
      // Kein Zugriff auf irgendein Projekt → keine Treffer.
      if (visibleProjectIds.length === 0) return [];
      // ::uuid[] ist Pflicht: project_id ist uuid, die Scope-IDs kommen als
      // JS-Strings herein. Ohne Cast wirft Postgres
      // "operator does not exist: uuid = text" — und zwar nur bei Non-Admins.
      return (
        await db`
        SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize, f.mime_type, f.content_text, f.summary, f.tags, f.analyzed, f.created_at, f.updated_at, p.name as project_name FROM files f
        LEFT JOIN projects p ON f.project_id = p.id
        WHERE f.project_id = ANY(${db.array(visibleProjectIds)}::uuid[])
          AND (
            f.filename ILIKE ${like}
            OR f.content_text ILIKE ${like}
            OR f.filepath ILIKE ${like}
          )
        ORDER BY f.updated_at DESC
        LIMIT ${limit}
      `
      ).map(rowToFile);
    }
    return (
      await db`
      SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize, f.mime_type, f.content_text, f.summary, f.tags, f.analyzed, f.created_at, f.updated_at, p.name as project_name FROM files f
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
    // id::text verhindert "invalid input syntax for type uuid" wenn filename
    // oder filepath statt einer UUID uebergeben wird — sonst crasht die
    // gesamte Query, bevor die OR-Klauseln ueberhaupt ausgewertet werden.
    const result = await db`
      DELETE FROM files WHERE id::text = ${id} OR filename = ${id} OR filepath = ${id}
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
    return result.count > 0;
  },

  async linkProject(fileIdOrName, projectName) {
    const db = getDb();
    const [p] = await db`SELECT id FROM projects WHERE name = ${projectName} LIMIT 1`;
    if (!p) return false;
    const now = new Date().toISOString();
    // id::text verhindert UUID-Cast-Crash, wenn ein filename uebergeben wird.
    const result = await db`
      UPDATE files SET project_id = ${p.id}, updated_at = ${now}
      WHERE id::text = ${fileIdOrName} OR filename = ${fileIdOrName} OR filepath = ${fileIdOrName}
    `;
    return result.count > 0;
  },

  // ── File-Sharing (Phase 3) ──────────────────────────────────

  async listShares(fileId): Promise<FileShareEntry[]> {
    const db = getDb();
    const rows = await db`
      SELECT u.id, u.username, u.display_name, fs.can_edit, fs.added_at
      FROM file_shares fs
      JOIN users u ON u.id = fs.user_id
      WHERE fs.file_id = ${fileId}
      ORDER BY u.username
    `;
    return rows.map((r) => ({
      fileId,
      userId: String(r.id),
      username: String(r.username),
      displayName: r.display_name ? String(r.display_name) : null,
      canEdit: r.can_edit === true,
      addedAt: String(r.added_at),
    }));
  },

  async addShare(fileId, userId, canEdit) {
    const db = getDb();
    await db`
      INSERT INTO file_shares (file_id, user_id, can_edit)
      VALUES (${fileId}, ${userId}, ${canEdit})
      ON CONFLICT (file_id, user_id)
        DO UPDATE SET can_edit = EXCLUDED.can_edit
    `;
    return true;
  },

  async removeShare(fileId, userId) {
    const db = getDb();
    const result = await db`
      DELETE FROM file_shares WHERE file_id = ${fileId} AND user_id = ${userId}
    `;
    return result.count > 0;
  },
};
