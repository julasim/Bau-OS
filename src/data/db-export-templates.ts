// ============================================================
// PATIO — Export-Templates-Repository (Phase 6d)
// ============================================================
// CRUD fuer .docx-Templates die fuer Word-Exports verwendet werden.
// Blob wird in der DB gespeichert (BYTEA) — Backup-sicher, kein
// Filesystem-Pfad-Management.
// ============================================================

import crypto from "crypto";
import { getDb } from "../db/client.js";
import { alsIso } from "./zeitstempel.js";

export type ExportKind = "meeting" | "bautagebuch" | "time-entry" | "project-summary";

export interface ExportTemplatePublic {
  id: string;
  kind: ExportKind;
  name: string;
  description: string | null;
  filename: string;
  isDefault: boolean;
  createdById: string | null;
  uploadedAt: string;
  /** Groesse des .docx in Bytes — UI zeigt das fuer "ist die Datei valide". */
  sizeBytes: number;
}

function rowToPublic(row: Record<string, unknown>): ExportTemplatePublic {
  return {
    id: String(row.id),
    kind: row.kind as ExportKind,
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    filename: String(row.filename),
    isDefault: row.is_default === true,
    createdById: row.created_by_id ? String(row.created_by_id) : null,
    uploadedAt: alsIso(row.uploaded_at),
    sizeBytes: row.size_bytes !== undefined ? Number(row.size_bytes) : 0,
  };
}

export async function listExportTemplates(kind?: ExportKind): Promise<ExportTemplatePublic[]> {
  const db = getDb();
  const rows = kind
    ? await db`
        SELECT id, kind, name, description, filename, is_default,
               created_by_id, uploaded_at, octet_length(docx_blob) as size_bytes
          FROM export_templates WHERE kind = ${kind}
         ORDER BY is_default DESC, name
      `
    : await db`
        SELECT id, kind, name, description, filename, is_default,
               created_by_id, uploaded_at, octet_length(docx_blob) as size_bytes
          FROM export_templates ORDER BY kind, is_default DESC, name
      `;
  return rows.map(rowToPublic);
}

export async function getExportTemplate(id: string): Promise<ExportTemplatePublic | null> {
  const db = getDb();
  const [row] = await db`
    SELECT id, kind, name, description, filename, is_default,
           created_by_id, uploaded_at, octet_length(docx_blob) as size_bytes
      FROM export_templates WHERE id = ${id}
  `;
  return row ? rowToPublic(row) : null;
}

/** Liefert das Default-Template fuer eine Kategorie. NULL wenn keines
 *  existiert — Caller muss dann freundlich abbrechen. */
export async function getDefaultExportTemplate(kind: ExportKind): Promise<ExportTemplatePublic | null> {
  const db = getDb();
  const [row] = await db`
    SELECT id, kind, name, description, filename, is_default,
           created_by_id, uploaded_at, octet_length(docx_blob) as size_bytes
      FROM export_templates WHERE kind = ${kind} AND is_default = true LIMIT 1
  `;
  return row ? rowToPublic(row) : null;
}

/** Internal — laedt den .docx-Blob fuer Render-Pipeline. */
export async function loadExportTemplateBlob(id: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const db = getDb();
  const [row] = await db`SELECT docx_blob, filename FROM export_templates WHERE id = ${id}`;
  if (!row) return null;
  const buffer = Buffer.isBuffer(row.docx_blob) ? row.docx_blob : Buffer.from(row.docx_blob as Uint8Array);
  return { buffer, filename: String(row.filename) };
}

export interface CreateExportTemplateInput {
  kind: ExportKind;
  name: string;
  description?: string | null;
  filename: string;
  blob: Buffer;
  isDefault?: boolean;
  createdById?: string | null;
}

export async function createExportTemplate(input: CreateExportTemplateInput): Promise<ExportTemplatePublic> {
  const db = getDb();
  const id = crypto.randomUUID();
  if (input.isDefault) {
    await db`UPDATE export_templates SET is_default = false WHERE kind = ${input.kind}`;
  }
  await db`
    INSERT INTO export_templates (
      id, kind, name, description, docx_blob, filename, is_default, created_by_id
    ) VALUES (
      ${id}, ${input.kind}, ${input.name}, ${input.description ?? null},
      ${input.blob}, ${input.filename}, ${input.isDefault ?? false}, ${input.createdById ?? null}
    )
  `;
  const out = await getExportTemplate(id);
  if (!out) throw new Error("Template nach INSERT nicht lesbar");
  return out;
}

export async function setDefaultExportTemplate(id: string): Promise<ExportTemplatePublic | null> {
  const db = getDb();
  const [current] = await db`SELECT kind FROM export_templates WHERE id = ${id}`;
  if (!current) return null;
  await db`UPDATE export_templates SET is_default = false WHERE kind = ${current.kind} AND id <> ${id}`;
  await db`UPDATE export_templates SET is_default = true WHERE id = ${id}`;
  return getExportTemplate(id);
}

export async function deleteExportTemplate(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db`DELETE FROM export_templates WHERE id = ${id}`;
  return result.count > 0;
}
