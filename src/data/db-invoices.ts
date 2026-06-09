// ============================================================
// PATIO — Teilrechnungen-Repository (DB-Backend)
// ============================================================
// Migration 035 setzt project_invoices. Honorarsumme bleibt projects.budget;
// je-Phase-Betrag = budget * fee_share. Hier nur die fakturierten Betraege.
// DB-only.
// ============================================================

import { getDb } from "../db/client.js";
import type { ProjectInvoice, ProjectInvoiceInput, InvoiceRepository } from "./types.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function rowToInvoice(row: Record<string, unknown>): ProjectInvoice {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    phaseId: row.phase_id ? String(row.phase_id) : null,
    phaseName: row.phase_name ? String(row.phase_name) : null,
    nummer: row.nummer ? String(row.nummer) : null,
    betrag: Number(row.betrag ?? 0),
    datum: dateStr(row.datum),
    status: row.status as ProjectInvoice["status"],
    note: row.note ? String(row.note) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

const SELECT = `
  SELECT i.*, ph.name AS phase_name
    FROM project_invoices i
    LEFT JOIN project_phases ph ON ph.id = i.phase_id
`;

export const dbInvoices: InvoiceRepository = {
  async list(projectId) {
    const db = getDb();
    const rows = await db.unsafe(
      `${SELECT} WHERE i.project_id = $1 ORDER BY i.datum DESC NULLS LAST, i.created_at DESC`,
      [projectId],
    );
    return rows.map((r) => rowToInvoice(r as Record<string, unknown>));
  },

  async create(projectId, input) {
    const db = getDb();
    if (input.datum && !ISO_DATE.test(input.datum)) return "Datum muss YYYY-MM-DD sein";
    if (typeof input.betrag === "number" && input.betrag < 0) return "Betrag darf nicht negativ sein";
    try {
      const [created] = await db`
        INSERT INTO project_invoices (project_id, phase_id, nummer, betrag, datum, status, note)
        VALUES (
          ${projectId}, ${input.phaseId ?? null}, ${input.nummer ?? null},
          ${input.betrag ?? 0}, ${input.datum ?? null}, ${input.status ?? "gestellt"}, ${input.note ?? null}
        )
        RETURNING id
      `;
      const rows = await db.unsafe(`${SELECT} WHERE i.id = $1 LIMIT 1`, [String(created.id)]);
      return rowToInvoice(rows[0] as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("check") || msg.toLowerCase().includes("violates")) {
        return `Ungueltige Eingabe: ${msg}`;
      }
      throw err;
    }
  },

  async update(id, input) {
    const db = getDb();
    const [current] = await db`SELECT * FROM project_invoices WHERE id = ${id}`;
    if (!current) return null;
    if (input.datum && !ISO_DATE.test(input.datum)) return "Datum muss YYYY-MM-DD sein";

    const phaseId = "phaseId" in input ? (input.phaseId ?? null) : current.phase_id;
    const nummer = "nummer" in input ? (input.nummer ?? null) : current.nummer;
    const betrag = "betrag" in input ? (input.betrag ?? 0) : current.betrag;
    const datum = "datum" in input ? (input.datum ?? null) : current.datum;
    const status = "status" in input ? (input.status ?? "gestellt") : current.status;
    const note = "note" in input ? (input.note ?? null) : current.note;

    try {
      await db`
        UPDATE project_invoices SET
          phase_id = ${phaseId}, nummer = ${nummer}, betrag = ${betrag},
          datum = ${datum}, status = ${status}, note = ${note}
        WHERE id = ${id}
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("check") || msg.toLowerCase().includes("violates")) {
        return `Ungueltige Eingabe: ${msg}`;
      }
      throw err;
    }
    const rows = await db.unsafe(`${SELECT} WHERE i.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToInvoice(rows[0] as Record<string, unknown>) : null;
  },

  async delete(id) {
    const db = getDb();
    const result = await db`DELETE FROM project_invoices WHERE id = ${id}`;
    return result.count > 0;
  },
};
