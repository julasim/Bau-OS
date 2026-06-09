// ============================================================
// PATIO — Leistungsphasen-Repository (DB-Backend)
// ============================================================
// Migration 035 setzt die Tabelle project_phases. Der Fortschritt einer
// Phase wird NICHT gespeichert, sondern aus den verknuepften Aufgaben
// abgeleitet (COUNT done / COUNT *). progress_manual ueberschreibt das,
// wenn gesetzt — fuer Phasen ohne verknuepfte Aufgaben.
// DB-only, kein FS-Fallback (wie Bautagebuch/Meetings).
// ============================================================

import { getDb } from "../db/client.js";
import type { ProjectPhase, ProjectPhaseUpsert, PhaseRepository } from "./types.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function rowToPhase(row: Record<string, unknown>): ProjectPhase {
  const taskTotal = row.task_total === null || row.task_total === undefined ? 0 : Number(row.task_total);
  const taskDone = row.task_done === null || row.task_done === undefined ? 0 : Number(row.task_done);
  const progressManual =
    row.progress_manual === null || row.progress_manual === undefined ? null : Number(row.progress_manual);
  // Effektiver Fortschritt: manuelles Override > aus Aufgaben > 0.
  let progress = 0;
  if (progressManual !== null) progress = progressManual;
  else if (taskTotal > 0) progress = Math.round((taskDone / taskTotal) * 100);
  // Phase 'fertig' ohne Aufgaben → 100 %, damit der Status nicht widerspricht.
  if (progressManual === null && taskTotal === 0 && row.status === "fertig") progress = 100;

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: row.project_name ? String(row.project_name) : null,
    name: String(row.name),
    sortOrder: Number(row.sort_order ?? 0),
    status: row.status as ProjectPhase["status"],
    progressManual,
    feeShare: Number(row.fee_share ?? 0),
    sollStart: dateStr(row.soll_start),
    sollEnde: dateStr(row.soll_ende),
    istStart: dateStr(row.ist_start),
    istEnde: dateStr(row.ist_ende),
    progress,
    taskTotal,
    taskDone,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

// SELECT mit korrelierten Subqueries fuer den abgeleiteten Fortschritt.
const SELECT = `
  SELECT ph.*,
         p.name AS project_name,
         (SELECT COUNT(*) FROM tasks t WHERE t.phase_id = ph.id) AS task_total,
         (SELECT COUNT(*) FROM tasks t WHERE t.phase_id = ph.id AND t.status = 'done') AS task_done
    FROM project_phases ph
    LEFT JOIN projects p ON p.id = ph.project_id
`;

export const dbPhases: PhaseRepository = {
  async list(projectId) {
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE ph.project_id = $1 ORDER BY ph.sort_order, ph.created_at`, [
      projectId,
    ]);
    return rows.map((r) => rowToPhase(r as Record<string, unknown>));
  },

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE ph.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToPhase(rows[0] as Record<string, unknown>) : null;
  },

  async create(projectId, input) {
    const db = getDb();
    const name = (input.name ?? "").trim();
    if (!name) return "Phasenname fehlt";
    for (const f of ["sollStart", "sollEnde", "istStart", "istEnde"] as const) {
      const v = input[f];
      if (v && !ISO_DATE.test(v)) return `Datum ${f} muss YYYY-MM-DD sein`;
    }
    // sort_order ans Ende, wenn nicht explizit gesetzt.
    let sort = input.sortOrder;
    if (sort === undefined) {
      const [mx] =
        await db`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM project_phases WHERE project_id = ${projectId}`;
      sort = Number(mx?.next ?? 0);
    }
    const [created] = await db`
      INSERT INTO project_phases (project_id, name, sort_order, status, progress_manual, fee_share,
                                  soll_start, soll_ende, ist_start, ist_ende)
      VALUES (
        ${projectId}, ${name}, ${sort}, ${input.status ?? "offen"},
        ${input.progressManual ?? null}, ${input.feeShare ?? 0},
        ${input.sollStart ?? null}, ${input.sollEnde ?? null},
        ${input.istStart ?? null}, ${input.istEnde ?? null}
      )
      RETURNING id
    `;
    const phase = await this.get(String(created.id));
    if (!phase) throw new Error("Phase nach INSERT nicht lesbar");
    return phase;
  },

  async update(id, input) {
    const db = getDb();
    const [current] = await db`SELECT * FROM project_phases WHERE id = ${id}`;
    if (!current) return null;
    for (const f of ["sollStart", "sollEnde", "istStart", "istEnde"] as const) {
      const v = input[f];
      if (v && !ISO_DATE.test(v)) return `Datum ${f} muss YYYY-MM-DD sein`;
    }

    const name = "name" in input ? (input.name ?? current.name) : current.name;
    const status = "status" in input ? (input.status ?? current.status) : current.status;
    const progressManual = "progressManual" in input ? (input.progressManual ?? null) : current.progress_manual;
    const feeShare = "feeShare" in input ? (input.feeShare ?? 0) : current.fee_share;
    const sollStart = "sollStart" in input ? (input.sollStart ?? null) : current.soll_start;
    const sollEnde = "sollEnde" in input ? (input.sollEnde ?? null) : current.soll_ende;
    const istStart = "istStart" in input ? (input.istStart ?? null) : current.ist_start;
    const istEnde = "istEnde" in input ? (input.istEnde ?? null) : current.ist_ende;
    const sortOrder = "sortOrder" in input ? (input.sortOrder ?? current.sort_order) : current.sort_order;

    // Auto-Stempel der Ist-Termine bei Statuswechsel, wenn nicht explizit gesetzt.
    let istStartFinal = istStart;
    let istEndeFinal = istEnde;
    if (status === "aktiv" && !current.ist_start && !("istStart" in input)) {
      istStartFinal = new Date().toISOString().slice(0, 10);
    }
    if (status === "fertig" && !current.ist_ende && !("istEnde" in input)) {
      istEndeFinal = new Date().toISOString().slice(0, 10);
    }

    try {
      await db`
        UPDATE project_phases SET
          name = ${name}, status = ${status}, progress_manual = ${progressManual},
          fee_share = ${feeShare}, soll_start = ${sollStart}, soll_ende = ${sollEnde},
          ist_start = ${istStartFinal}, ist_ende = ${istEndeFinal}, sort_order = ${sortOrder}
        WHERE id = ${id}
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("check") || msg.toLowerCase().includes("violates")) {
        return `Ungueltige Eingabe: ${msg}`;
      }
      throw err;
    }
    return this.get(id);
  },

  async delete(id) {
    const db = getDb();
    const result = await db`DELETE FROM project_phases WHERE id = ${id}`;
    return result.count > 0;
  },

  async reorder(projectId, orderedIds) {
    if (orderedIds.length === 0) return false;
    const db = getDb();
    await db.begin(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx`UPDATE project_phases SET sort_order = ${i} WHERE id = ${orderedIds[i]} AND project_id = ${projectId}`;
      }
    });
    return true;
  },

  async projectProgress(projectId) {
    const phases = await this.list(projectId);
    if (phases.length === 0) return 0;
    const totalShare = phases.reduce((s, p) => s + p.feeShare, 0);
    if (totalShare > 0) {
      // Honorargewichtet.
      const weighted = phases.reduce((s, p) => s + p.feeShare * p.progress, 0);
      return Math.round(weighted / totalShare);
    }
    // Kein Honoraranteil gepflegt → einfacher Mittelwert.
    return Math.round(phases.reduce((s, p) => s + p.progress, 0) / phases.length);
  },
};
