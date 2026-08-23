// ============================================================
// PATIO — Meetings-Repository (DB-Backend)
// ============================================================
// Migration 012 setzt die Tabelle, dieser Adapter implementiert
// MeetingRepository.
//
// Patterns wiederverwendet:
//   - JSONB-Insert via String-Cast + ::jsonb (siehe db-team.appendLog
//     und db-bautagebuch).
//   - attendees_resolved-LATERAL-Join wie bei db-termine, damit die
//     Mitglieder-Namen ohne N+1 mitkommen.
//   - Datum-Validierung per ISO-Regex am Eingang.
// ============================================================

import crypto from "crypto";
import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { Meeting, MeetingActionItem, MeetingInput, MeetingRepository } from "./types.js";
import { alsIso } from "./zeitstempel.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}(:\d{2})?$/;

function rowToMeeting(row: Record<string, unknown>): Meeting {
  // meeting_date kommt als Date-Objekt → wir wollen YYYY-MM-DD-String.
  const dateRaw = row.meeting_date;
  const dateStr = dateRaw instanceof Date ? dateRaw.toISOString().slice(0, 10) : String(dateRaw).slice(0, 10);

  const nextRaw = row.next_meeting_date;
  const nextStr = nextRaw
    ? nextRaw instanceof Date
      ? nextRaw.toISOString().slice(0, 10)
      : String(nextRaw).slice(0, 10)
    : null;

  // TIME-Felder kommen als "HH:MM:SS"-String — wir kappen auf "HH:MM".
  const cleanTime = (t: unknown): string | null => {
    if (!t) return null;
    const s = String(t);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };

  // JSONB → Array of MeetingActionItem
  let actionItems = row.action_items;
  if (typeof actionItems === "string") {
    try {
      actionItems = JSON.parse(actionItems);
    } catch {
      actionItems = [];
    }
  }

  // attendees_resolved kommt aus dem LATERAL-Subselect als JSON
  const resolvedRaw = row.attendees_resolved;
  const attendeesResolved = Array.isArray(resolvedRaw)
    ? (resolvedRaw as Array<Record<string, unknown>>)
        .filter((r) => r && r.id)
        .map((r) => ({ id: String(r.id), name: String(r.name) }))
    : [];

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: row.project_name ? String(row.project_name) : null,
    date: dateStr,
    startTime: cleanTime(row.start_time),
    endTime: cleanTime(row.end_time),
    title: String(row.title),
    meetingType: row.meeting_type ? (String(row.meeting_type) as Meeting["meetingType"]) : null,
    location: row.location ? String(row.location) : null,
    attendeeIds: Array.isArray(row.attendee_ids) ? (row.attendee_ids as string[]).map(String) : [],
    attendeesResolved,
    attendeesExternal: Array.isArray(row.attendees_external) ? (row.attendees_external as string[]).map(String) : [],
    agenda: row.agenda ? String(row.agenda) : null,
    minutes: row.minutes ? String(row.minutes) : null,
    decisions: row.decisions ? String(row.decisions) : null,
    actionItems: Array.isArray(actionItems) ? (actionItems as MeetingActionItem[]) : [],
    nextMeetingDate: nextStr,
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
  SELECT m.*,
         p.name AS project_name,
         u.username AS created_by_username,
         COALESCE(
           (SELECT json_agg(json_build_object('id', tm.id, 'name', tm.name))
              FROM team_members tm
             WHERE tm.id = ANY(COALESCE(m.attendee_ids, '{}'::uuid[]))),
           '[]'::json
         ) AS attendees_resolved
    FROM meetings m
    LEFT JOIN projects p ON p.id = m.project_id
    LEFT JOIN users u ON u.id = m.created_by
`;

/** Validiert + normalisiert die patchbaren Felder eines Meeting-Inputs.
 *  Liefert entweder einen Fehler-String oder ein Objekt mit den geprueften
 *  Werten (jeweils undefined wenn nicht im Input). */
function normalizeInput(input: Partial<MeetingInput>):
  | string
  | {
      date?: string;
      startTime?: string | null;
      endTime?: string | null;
      title?: string;
      meetingType?: string | null;
      location?: string | null;
      attendeeIds?: string[];
      attendeesExternal?: string[];
      agenda?: string | null;
      minutes?: string | null;
      decisions?: string | null;
      actionItems?: MeetingActionItem[];
      nextMeetingDate?: string | null;
    } {
  if ("date" in input && input.date && !ISO_DATE.test(input.date)) {
    return "Datum muss im Format YYYY-MM-DD sein";
  }
  if ("nextMeetingDate" in input && input.nextMeetingDate && !ISO_DATE.test(input.nextMeetingDate)) {
    return "Folgetermin-Datum muss im Format YYYY-MM-DD sein";
  }
  if ("startTime" in input && input.startTime && !HHMM.test(input.startTime)) {
    return "Startzeit muss im Format HH:MM sein";
  }
  if ("endTime" in input && input.endTime && !HHMM.test(input.endTime)) {
    return "Endzeit muss im Format HH:MM sein";
  }
  if ("title" in input && input.title !== undefined && !String(input.title).trim()) {
    return "Titel darf nicht leer sein";
  }

  const out: Record<string, unknown> = {};
  if ("date" in input) out.date = input.date;
  if ("startTime" in input) out.startTime = input.startTime ?? null;
  if ("endTime" in input) out.endTime = input.endTime ?? null;
  if ("title" in input && input.title !== undefined) out.title = String(input.title).trim();
  if ("meetingType" in input) out.meetingType = input.meetingType ?? null;
  if ("location" in input) out.location = input.location ?? null;
  if ("attendeeIds" in input) out.attendeeIds = Array.isArray(input.attendeeIds) ? input.attendeeIds : [];
  if ("attendeesExternal" in input) {
    out.attendeesExternal = Array.isArray(input.attendeesExternal)
      ? input.attendeesExternal.filter((s) => s && s.trim())
      : [];
  }
  if ("agenda" in input) out.agenda = input.agenda ?? null;
  if ("minutes" in input) out.minutes = input.minutes ?? null;
  if ("decisions" in input) out.decisions = input.decisions ?? null;
  if ("actionItems" in input) {
    out.actionItems = Array.isArray(input.actionItems)
      ? input.actionItems.filter((a) => a && a.text && String(a.text).trim())
      : [];
  }
  if ("nextMeetingDate" in input) out.nextMeetingDate = input.nextMeetingDate ?? null;
  return out as ReturnType<typeof normalizeInput> & object;
}

/** Filtert attendee_ids gegen team_members — nicht-existente IDs werden
 *  ohne Fehler weggelassen (defensiv, damit ein veraltetes Frontend das
 *  Meeting nicht sprengt). */
async function filterValidAttendees(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db`SELECT id FROM team_members WHERE id = ANY(${ids})`;
  const valid = new Set(rows.map((r) => String(r.id)));
  return ids.filter((id) => valid.has(id));
}

export const dbMeetings: MeetingRepository = {
  async list(projectId, limit = 50) {
    const db = getDb();
    const rows = await db.unsafe(
      `${SELECT} WHERE m.project_id = $1 ORDER BY m.meeting_date DESC, m.start_time DESC NULLS LAST LIMIT $2`,
      [projectId, limit],
    );
    return rows.map((r) => rowToMeeting(r as Record<string, unknown>));
  },

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE m.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToMeeting(rows[0] as Record<string, unknown>) : null;
  },

  async create(projectId, input, createdById = null) {
    if (!input.date) return "Datum ist erforderlich";
    if (!input.title || !String(input.title).trim()) return "Titel ist erforderlich";

    const norm = normalizeInput(input);
    if (typeof norm === "string") return norm;

    const db = getDb();
    const id = crypto.randomUUID();
    const attendeeIds = await filterValidAttendees(norm.attendeeIds ?? []);
    const actionItemsJson = JSON.stringify(norm.actionItems ?? []);

    try {
      await db`
        INSERT INTO meetings (
          id, project_id, meeting_date, start_time, end_time,
          title, meeting_type, location,
          attendee_ids, attendees_external,
          agenda, minutes, decisions,
          action_items, next_meeting_date, created_by
        ) VALUES (
          ${id}, ${projectId}, ${norm.date!}, ${norm.startTime ?? null}, ${norm.endTime ?? null},
          ${norm.title!}, ${norm.meetingType ?? null}, ${norm.location ?? null},
          ${attendeeIds as string[]}, ${(norm.attendeesExternal ?? []) as string[]},
          ${norm.agenda ?? null}, ${norm.minutes ?? null}, ${norm.decisions ?? null},
          ${actionItemsJson}::jsonb, ${norm.nextMeetingDate ?? null}, ${createdById}
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
    if (!saved) throw new Error("Meeting nach INSERT nicht lesbar");
    return saved;
  },

  async update(id, input) {
    const norm = normalizeInput(input);
    if (typeof norm === "string") return norm;

    const db = getDb();
    const [current] = await db`SELECT * FROM meetings WHERE id = ${id}`;
    if (!current) return null;

    // Konfliktschutz (Migration 042): schickt der Aufrufer einen Zaehler mit,
    // muss er noch stimmen — sonst hat in der Zwischenzeit jemand anderes
    // gespeichert. Ohne Zaehler gilt weiterhin „zuletzt gewinnt".
    pruefeRev(rowToMeeting(current), current.rev, (input as { rev?: number }).rev);

    // Felder mit Patch-Semantik aufbauen.
    const date = "date" in norm && norm.date ? norm.date : current.meeting_date;
    const startTime = "startTime" in norm ? (norm.startTime ?? null) : current.start_time;
    const endTime = "endTime" in norm ? (norm.endTime ?? null) : current.end_time;
    const title = "title" in norm && norm.title !== undefined ? norm.title : current.title;
    const meetingType = "meetingType" in norm ? (norm.meetingType ?? null) : current.meeting_type;
    const location = "location" in norm ? (norm.location ?? null) : current.location;
    const attendeesExternal =
      "attendeesExternal" in norm ? (norm.attendeesExternal ?? []) : ((current.attendees_external as string[]) ?? []);
    const agenda = "agenda" in norm ? (norm.agenda ?? null) : current.agenda;
    const minutes = "minutes" in norm ? (norm.minutes ?? null) : current.minutes;
    const decisions = "decisions" in norm ? (norm.decisions ?? null) : current.decisions;
    const nextMeetingDate = "nextMeetingDate" in norm ? (norm.nextMeetingDate ?? null) : current.next_meeting_date;

    let attendeeIds = "attendeeIds" in norm ? (norm.attendeeIds ?? []) : ((current.attendee_ids as string[]) ?? []);
    if ("attendeeIds" in norm) {
      attendeeIds = await filterValidAttendees(attendeeIds);
    }

    const actionItems =
      "actionItems" in norm ? (norm.actionItems ?? []) : ((current.action_items as MeetingActionItem[]) ?? []);
    const actionItemsJson = JSON.stringify(actionItems);

    let betroffen: readonly unknown[] = [];
    try {
      betroffen = await db`
        UPDATE meetings SET
          meeting_date = ${date as string},
          start_time = ${startTime as string | null},
          end_time = ${endTime as string | null},
          title = ${title as string},
          meeting_type = ${meetingType as string | null},
          location = ${location as string | null},
          attendee_ids = ${attendeeIds as string[]},
          attendees_external = ${attendeesExternal as string[]},
          agenda = ${agenda as string | null},
          minutes = ${minutes as string | null},
          decisions = ${decisions as string | null},
          action_items = ${actionItemsJson}::jsonb,
          next_meeting_date = ${nextMeetingDate as string | null},
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
      const [jetzt] = await db`SELECT * FROM meetings WHERE id = ${id}`;
      if (!jetzt) return null; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(rowToMeeting(jetzt), Number(current.rev), Number(jetzt.rev));
    }

    return this.get(id);
  },

  async delete(id) {
    const db = getDb();
    const result = await db`DELETE FROM meetings WHERE id = ${id}`;
    return result.count > 0;
  },

  async listRecent(visibleProjectIds, limit = 20) {
    const db = getDb();
    if (visibleProjectIds === "all") {
      const rows = await db.unsafe(`${SELECT} ORDER BY m.meeting_date DESC, m.start_time DESC NULLS LAST LIMIT $1`, [
        limit,
      ]);
      return rows.map((r) => rowToMeeting(r as Record<string, unknown>));
    }
    if (visibleProjectIds.length === 0) return [];
    const rows = await db.unsafe(
      `${SELECT} WHERE m.project_id = ANY($1::uuid[]) ORDER BY m.meeting_date DESC, m.start_time DESC NULLS LAST LIMIT $2`,
      [visibleProjectIds, limit],
    );
    return rows.map((r) => rowToMeeting(r as Record<string, unknown>));
  },
};
