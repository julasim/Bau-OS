// ============================================================
// PATIO — Stundenerfassung Repository (DB-Backend)
// ============================================================
// Migration 014 setzt die Tabelle, dieser Adapter implementiert
// TimeEntryRepository.
//
// Validierung am Eingang:
//   - Datum YYYY-MM-DD (ISO).
//   - Zeit HH:MM (optional).
//   - hours: 0 < x <= 24 (CHECK in DB, aber wir fangen Frontend-
//     Fehler frueh ab).
// ============================================================

import crypto from "crypto";
import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { TimeEntry, TimeEntryInput, TimeEntryRepository, TimeSummary } from "./types.js";
import { alsIso } from "./zeitstempel.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}(:\d{2})?$/;

function rowToEntry(row: Record<string, unknown>): TimeEntry {
  const dateRaw = row.entry_date;
  const dateStr = dateRaw instanceof Date ? dateRaw.toISOString().slice(0, 10) : String(dateRaw).slice(0, 10);

  const cleanTime = (t: unknown): string | null => {
    if (!t) return null;
    const s = String(t);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: row.project_name ? String(row.project_name) : null,
    phaseId: row.phase_id ? String(row.phase_id) : null,
    hourlyRate: row.hourly_rate != null ? Number(row.hourly_rate) : null,
    memberId: row.member_id ? String(row.member_id) : null,
    memberName: row.member_name ? String(row.member_name) : null,
    date: dateStr,
    // postgres.js liefert DECIMAL als string → mit Number() in Float wandeln.
    hours: Number(row.hours),
    startTime: cleanTime(row.start_time),
    endTime: cleanTime(row.end_time),
    breakMinutes: Number(row.break_minutes ?? 0),
    activity: row.activity ? String(row.activity) : null,
    notes: row.notes ? String(row.notes) : null,
    createdById: row.created_by ? String(row.created_by) : null,
    createdByUsername: row.created_by_username ? String(row.created_by_username) : null,
    createdAt: alsIso(row.created_at),
    updatedAt: alsIso(row.updated_at),
    /** Konflikt-Zaehler (Migration 042) — die Oberflaeche schickt ihn beim
     *  Speichern zurueck. Fehlt er im DTO, ist der Schutz von aussen unerreichbar. */
    rev: Number(row.rev ?? 1),
  };
}

const SELECT = `
  SELECT t.*,
         p.name AS project_name,
         u.username AS created_by_username
    FROM time_entries t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users u ON u.id = t.created_by
`;

function validateInput(input: Partial<TimeEntryInput>):
  | string
  | {
      date?: string;
      hours?: number;
      phaseId?: string | null;
      hourlyRate?: number | null;
      memberId?: string | null;
      memberName?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      breakMinutes?: number;
      activity?: string | null;
      notes?: string | null;
    } {
  if ("date" in input && input.date && !ISO_DATE.test(input.date)) {
    return "Datum muss im Format YYYY-MM-DD sein";
  }
  if ("hours" in input && input.hours !== undefined) {
    const h = Number(input.hours);
    if (!Number.isFinite(h) || h <= 0 || h > 24) {
      return "Stundenanzahl muss zwischen 0 und 24 liegen";
    }
  }
  if ("startTime" in input && input.startTime && !HHMM.test(input.startTime)) {
    return "Startzeit muss im Format HH:MM sein";
  }
  if ("endTime" in input && input.endTime && !HHMM.test(input.endTime)) {
    return "Endzeit muss im Format HH:MM sein";
  }
  if ("breakMinutes" in input && input.breakMinutes !== undefined) {
    const b = Number(input.breakMinutes);
    if (!Number.isFinite(b) || b < 0) return "Pausen-Minuten duerfen nicht negativ sein";
  }
  return input;
}

export const dbTimeEntries: TimeEntryRepository = {
  async list(projectId, opts = {}) {
    const db = getDb();
    const limit = opts.limit ?? 100;
    const from = opts.from && ISO_DATE.test(opts.from) ? opts.from : null;
    const to = opts.to && ISO_DATE.test(opts.to) ? opts.to : null;

    if (from && to) {
      const rows = await db.unsafe(
        `${SELECT} WHERE t.project_id = $1 AND t.entry_date BETWEEN $2 AND $3
         ORDER BY t.entry_date DESC, t.start_time DESC NULLS LAST, t.created_at DESC
         LIMIT $4`,
        [projectId, from, to, limit],
      );
      return rows.map((r) => rowToEntry(r as Record<string, unknown>));
    }
    const rows = await db.unsafe(
      `${SELECT} WHERE t.project_id = $1
       ORDER BY t.entry_date DESC, t.start_time DESC NULLS LAST, t.created_at DESC
       LIMIT $2`,
      [projectId, limit],
    );
    return rows.map((r) => rowToEntry(r as Record<string, unknown>));
  },

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE t.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToEntry(rows[0] as Record<string, unknown>) : null;
  },

  async create(projectId, input, createdById = null) {
    if (!input.date) return "Datum ist erforderlich";
    if (input.hours === undefined || input.hours === null) return "Stundenanzahl ist erforderlich";

    const v = validateInput(input);
    if (typeof v === "string") return v;

    const db = getDb();
    const id = crypto.randomUUID();

    // member_id pruefen (best-effort: ungueltige IDs auf null setzen,
    // damit ein veraltetes Frontend nicht den ganzen Eintrag sprengt).
    let memberId: string | null = input.memberId ?? null;
    if (memberId) {
      const [m] = await db`SELECT id FROM team_members WHERE id = ${memberId}`;
      if (!m) memberId = null;
    }

    try {
      await db`
        INSERT INTO time_entries (
          id, project_id, phase_id, hourly_rate, member_id, member_name,
          entry_date, hours, start_time, end_time, break_minutes,
          activity, notes, created_by
        ) VALUES (
          ${id}, ${projectId}, ${input.phaseId ?? null}, ${input.hourlyRate ?? null}, ${memberId}, ${input.memberName ?? null},
          ${input.date}, ${input.hours}, ${input.startTime ?? null}, ${input.endTime ?? null},
          ${input.breakMinutes ?? 0},
          ${input.activity ?? null}, ${input.notes ?? null}, ${createdById}
        )
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("check") || msg.toLowerCase().includes("violates")) {
        return `Ungueltige Eingabe: ${msg}`;
      }
      throw err;
    }

    const saved = await this.get(id);
    if (!saved) throw new Error("TimeEntry nach INSERT nicht lesbar");
    return saved;
  },

  async update(id, input) {
    const v = validateInput(input);
    if (typeof v === "string") return v;

    const db = getDb();
    const [current] = await db`SELECT * FROM time_entries WHERE id = ${id}`;
    if (!current) return null;

    // Konfliktschutz (Migration 042): schickt der Aufrufer einen Zaehler mit,
    // muss er noch stimmen — sonst hat in der Zwischenzeit jemand anderes
    // gespeichert. Ohne Zaehler gilt weiterhin „zuletzt gewinnt".
    pruefeRev(rowToEntry(current), current.rev, (input as { rev?: number }).rev);

    const date = "date" in input && input.date ? input.date : current.entry_date;
    const hours = "hours" in input && input.hours !== undefined ? input.hours : current.hours;
    const startTime = "startTime" in input ? (input.startTime ?? null) : current.start_time;
    const endTime = "endTime" in input ? (input.endTime ?? null) : current.end_time;
    const breakMinutes = "breakMinutes" in input ? (input.breakMinutes ?? 0) : current.break_minutes;
    const activity = "activity" in input ? (input.activity ?? null) : current.activity;
    const notes = "notes" in input ? (input.notes ?? null) : current.notes;

    let memberId: string | null = "memberId" in input ? (input.memberId ?? null) : (current.member_id as string | null);
    if (memberId && "memberId" in input) {
      const [m] = await db`SELECT id FROM team_members WHERE id = ${memberId}`;
      if (!m) memberId = null;
    }
    const memberName = "memberName" in input ? (input.memberName ?? null) : (current.member_name as string | null);
    const phaseId = "phaseId" in input ? (input.phaseId ?? null) : (current.phase_id as string | null);
    const hourlyRate = "hourlyRate" in input ? (input.hourlyRate ?? null) : (current.hourly_rate as number | null);

    let betroffen: readonly unknown[] = [];
    try {
      betroffen = await db`
        UPDATE time_entries SET
          phase_id = ${phaseId},
          hourly_rate = ${hourlyRate},
          member_id = ${memberId},
          member_name = ${memberName},
          entry_date = ${date as string},
          hours = ${hours as number},
          start_time = ${startTime as string | null},
          end_time = ${endTime as string | null},
          break_minutes = ${breakMinutes as number},
          activity = ${activity as string | null},
          notes = ${notes as string | null},
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
      const [jetzt] = await db`SELECT * FROM time_entries WHERE id = ${id}`;
      if (!jetzt) return null; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(rowToEntry(jetzt), Number(current.rev), Number(jetzt.rev));
    }

    return this.get(id);
  },

  async delete(id) {
    const db = getDb();
    const result = await db`DELETE FROM time_entries WHERE id = ${id}`;
    return result.count > 0;
  },

  async listForMember(memberId, opts = {}) {
    const db = getDb();
    const limit = opts.limit ?? 100;
    const from = opts.from && ISO_DATE.test(opts.from) ? opts.from : null;
    const to = opts.to && ISO_DATE.test(opts.to) ? opts.to : null;
    if (from && to) {
      const rows = await db.unsafe(
        `${SELECT} WHERE t.member_id = $1 AND t.entry_date BETWEEN $2 AND $3
         ORDER BY t.entry_date DESC LIMIT $4`,
        [memberId, from, to, limit],
      );
      return rows.map((r) => rowToEntry(r as Record<string, unknown>));
    }
    const rows = await db.unsafe(`${SELECT} WHERE t.member_id = $1 ORDER BY t.entry_date DESC LIMIT $2`, [
      memberId,
      limit,
    ]);
    return rows.map((r) => rowToEntry(r as Record<string, unknown>));
  },

  async summaryByMember(projectId, from, to) {
    const db = getDb();
    const fromValid = from && ISO_DATE.test(from) ? from : "1900-01-01";
    const toValid = to && ISO_DATE.test(to) ? to : "9999-12-31";
    // member_name als Fallback wenn member_id NULL → COALESCE.
    // Gruppieren auf member_id-Niveau, aber Label aus member_name (oder
    // "Unbekannt" wenn beides leer).
    const rows = await db`
      SELECT
        COALESCE(member_id::text, 'extern:' || COALESCE(member_name, 'unbekannt')) AS key,
        COALESCE(member_name, 'Unbekannt') AS label,
        SUM(hours)::float8 AS total_hours,
        COUNT(*)::int AS entry_count
      FROM time_entries
      WHERE project_id = ${projectId}
        AND entry_date BETWEEN ${fromValid} AND ${toValid}
      GROUP BY key, label
      ORDER BY total_hours DESC
    `;
    return rows.map(
      (r): TimeSummary => ({
        key: String(r.key),
        label: String(r.label),
        hours: Number(r.total_hours),
        entries: Number(r.entry_count),
      }),
    );
  },

  async summaryByDate(projectId, from, to) {
    const db = getDb();
    const fromValid = from && ISO_DATE.test(from) ? from : "1900-01-01";
    const toValid = to && ISO_DATE.test(to) ? to : "9999-12-31";
    const rows = await db`
      SELECT
        TO_CHAR(entry_date, 'YYYY-MM-DD') AS key,
        TO_CHAR(entry_date, 'YYYY-MM-DD') AS label,
        SUM(hours)::float8 AS total_hours,
        COUNT(*)::int AS entry_count
      FROM time_entries
      WHERE project_id = ${projectId}
        AND entry_date BETWEEN ${fromValid} AND ${toValid}
      GROUP BY entry_date
      ORDER BY entry_date DESC
    `;
    return rows.map(
      (r): TimeSummary => ({
        key: String(r.key),
        label: String(r.label),
        hours: Number(r.total_hours),
        entries: Number(r.entry_count),
      }),
    );
  },

  async costsByPhase(projectId) {
    const db = getDb();
    // Effektiver Satz: Eintrag-Override > Mitarbeiter-Standard > 0.
    const rows = await db`
      SELECT te.phase_id AS phase_id,
             SUM(te.hours * COALESCE(te.hourly_rate, tm.hourly_rate, 0))::float8 AS cost
        FROM time_entries te
        LEFT JOIN team_members tm ON tm.id = te.member_id
       WHERE te.project_id = ${projectId}
       GROUP BY te.phase_id
    `;
    const byPhase: Record<string, number> = {};
    let unassigned = 0;
    let total = 0;
    for (const r of rows) {
      const cost = Math.round(Number(r.cost ?? 0) * 100) / 100;
      total += cost;
      if (r.phase_id) byPhase[String(r.phase_id)] = cost;
      else unassigned = cost;
    }
    return { byPhase, unassigned, total: Math.round(total * 100) / 100 };
  },
};
