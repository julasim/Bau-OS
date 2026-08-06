// ============================================================
// PATIO — Teilrechnungen-Repository (DB-Backend)
// ============================================================
// Migration 035 setzt project_invoices. Honorarsumme bleibt projects.budget;
// je-Phase-Betrag = budget * fee_share. Hier nur die fakturierten Betraege.
// DB-only.
// ============================================================

import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { ProjectInvoice, InvoicePosition, InvoiceRepository } from "./types.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Liest die Positionen aus der JSONB-Spalte. Je nach Treiberpfad kommt
 *  entweder ein fertiges Objekt oder ein String zurueck. */
function rowToPositionen(roh: unknown): InvoicePosition[] {
  let wert = roh;
  if (typeof wert === "string") {
    try {
      wert = JSON.parse(wert);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(wert)) return [];
  return wert
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      text: String(p.text ?? ""),
      menge: Number(p.menge ?? 0),
      einheit: p.einheit ? String(p.einheit) : null,
      einzelpreis: Number(p.einzelpreis ?? 0),
      ustSatz: Number(p.ustSatz ?? 20),
    }));
}

/** Der Netto-Gesamtbetrag ergibt sich aus den Positionen, sobald es welche
 *  gibt. Ohne Positionen gilt der eingetragene Wert — so behalten
 *  Bestandsrechnungen (Migration 035, nur `betrag`) ihre Summe.
 *
 *  Die Ableitung ist bewusst nicht umkehrbar: waere `betrag` neben
 *  Positionen frei setzbar, koennte die Rechnung eine andere Summe behaupten
 *  als sie auflistet. */
function berechneBetrag(positionen: InvoicePosition[], fallback: number): number {
  if (positionen.length === 0) return fallback;
  const summe = positionen.reduce((s, p) => s + Number(p.menge) * Number(p.einzelpreis), 0);
  return Math.round(summe * 100) / 100;
}

/** Prueft die Positionen und liefert im Fehlerfall den Text fuer den Benutzer. */
function pruefePositionen(positionen: InvoicePosition[]): string | null {
  for (const [i, p] of positionen.entries()) {
    if (!p.text || !String(p.text).trim()) return `Position ${i + 1}: Text fehlt`;
    if (!Number.isFinite(p.menge) || p.menge < 0) return `Position ${i + 1}: Menge muss eine Zahl >= 0 sein`;
    if (!Number.isFinite(p.einzelpreis)) return `Position ${i + 1}: Einzelpreis muss eine Zahl sein`;
    if (!Number.isFinite(p.ustSatz) || p.ustSatz < 0 || p.ustSatz > 100) {
      return `Position ${i + 1}: Steuersatz muss zwischen 0 und 100 liegen`;
    }
  }
  return null;
}

function rowToInvoice(row: Record<string, unknown>): ProjectInvoice {
  return {
    id: String(row.id),
    rev: Number(row.rev ?? 1),
    projectId: String(row.project_id),
    phaseId: row.phase_id ? String(row.phase_id) : null,
    phaseName: row.phase_name ? String(row.phase_name) : null,
    nummer: row.nummer ? String(row.nummer) : null,
    betrag: Number(row.betrag ?? 0),
    positionen: rowToPositionen(row.positionen),
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

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE i.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToInvoice(rows[0] as Record<string, unknown>) : null;
  },

  async create(projectId, input) {
    const db = getDb();
    if (input.datum && !ISO_DATE.test(input.datum)) return "Datum muss YYYY-MM-DD sein";
    if (typeof input.betrag === "number" && input.betrag < 0) return "Betrag darf nicht negativ sein";

    const positionen = input.positionen ?? [];
    const positionsFehler = pruefePositionen(positionen);
    if (positionsFehler) return positionsFehler;
    const betrag = berechneBetrag(positionen, input.betrag ?? 0);

    try {
      const [created] = await db`
        INSERT INTO project_invoices (project_id, phase_id, nummer, betrag, positionen, datum, status, note)
        VALUES (
          ${projectId}, ${input.phaseId ?? null}, ${input.nummer ?? null},
          ${betrag}, ${JSON.stringify(positionen)}::jsonb,
          ${input.datum ?? null}, ${input.status ?? "gestellt"}, ${input.note ?? null}
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

    // Konfliktschutz (Migration 042): schickt der Aufrufer einen Zaehler mit,
    // muss er noch stimmen — sonst hat in der Zwischenzeit jemand anderes
    // gespeichert. Ohne Zaehler gilt weiterhin „zuletzt gewinnt".
    pruefeRev(rowToInvoice(current), current.rev, (input as { rev?: number }).rev);
    if (input.datum && !ISO_DATE.test(input.datum)) return "Datum muss YYYY-MM-DD sein";

    const phaseId = "phaseId" in input ? (input.phaseId ?? null) : current.phase_id;
    const nummer = "nummer" in input ? (input.nummer ?? null) : current.nummer;
    const betrag = "betrag" in input ? (input.betrag ?? 0) : current.betrag;
    const datum = "datum" in input ? (input.datum ?? null) : current.datum;
    const status = "status" in input ? (input.status ?? "gestellt") : current.status;
    const note = "note" in input ? (input.note ?? null) : current.note;

    const positionen = "positionen" in input ? (input.positionen ?? []) : rowToPositionen(current.positionen);
    const positionsFehler = pruefePositionen(positionen);
    if (positionsFehler) return positionsFehler;
    // Der Betrag folgt den Positionen. `betrag` aus dem Body zaehlt nur,
    // solange es keine gibt.
    const betragEffektiv = berechneBetrag(positionen, betrag);

    let betroffen: readonly unknown[] = [];
    try {
      betroffen = await db`
        UPDATE project_invoices SET
          phase_id = ${phaseId}, nummer = ${nummer}, betrag = ${betragEffektiv},
          positionen = ${JSON.stringify(positionen)}::jsonb,
          datum = ${datum}, status = ${status}, note = ${note},
          rev = rev + 1
        WHERE id = ${id} AND rev = ${current.rev}
        RETURNING id
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("check") || msg.toLowerCase().includes("violates")) {
        return `Ungueltige Eingabe: ${msg}`;
      }
      throw err;
    }
    // Keine Zeile getroffen heisst: zwischen Lesen und Schreiben hat jemand
    // anderes gespeichert. Ohne diese Pruefung taete die Anweisung STILL
    // nichts und meldete trotzdem Erfolg.
    if (betroffen.length === 0) {
      const [jetzt] = await db`SELECT * FROM project_invoices WHERE id = ${id}`;
      if (!jetzt) return null; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(rowToInvoice(jetzt), Number(current.rev), Number(jetzt.rev));
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
