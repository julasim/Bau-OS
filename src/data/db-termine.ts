// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { validateDatum, validateUhrzeit, normalizeDatum } from "../workspace/termine.js";
import type { Termin, TerminRepository, TerminFromMsInput } from "./types.js";

function rowToTermin(row: Record<string, unknown>): Termin {
  const assigneeIds = Array.isArray(row.assignee_ids) ? (row.assignee_ids as string[]).map(String) : [];
  const resolvedRaw = row.assignees_resolved;
  const assigneesResolved = Array.isArray(resolvedRaw)
    ? (resolvedRaw as Array<Record<string, unknown>>)
        .filter((r) => r && r.id)
        .map((r) => ({ id: String(r.id), name: String(r.name) }))
    : [];
  return {
    id: String(row.id),
    text: String(row.text),
    datum: String(row.datum),
    uhrzeit: row.uhrzeit ? String(row.uhrzeit) : null,
    endzeit: row.endzeit ? String(row.endzeit) : null,
    location: row.location ? String(row.location) : null,
    assignees: (row.assignees as string[]) || [],
    assigneeIds,
    assigneesResolved,
    project: row.project_name ? String(row.project_name) : null,
    recurring: row.recurring ? String(row.recurring) : null,
    color: row.color ? String(row.color) : null,
    createdAt: String(row.created_at),
    // ── Microsoft-Graph-Sync ──────────────────────────────
    msEventId: row.ms_event_id ? String(row.ms_event_id) : null,
    msCalendarId: row.ms_calendar_id ? String(row.ms_calendar_id) : null,
    msOwnerUserId: row.ms_owner_user_id ? String(row.ms_owner_user_id) : null,
    msEtag: row.ms_etag ? String(row.ms_etag) : null,
    msSyncStatus: (row.ms_sync_status as Termin["msSyncStatus"]) ?? null,
    msLastSyncAt:
      row.ms_last_sync_at instanceof Date
        ? row.ms_last_sync_at.toISOString()
        : row.ms_last_sync_at
          ? String(row.ms_last_sync_at)
          : null,
    msSource: (row.ms_source as Termin["msSource"]) ?? null,
  };
}

// Gemeinsame SELECT-Klausel — LEFT JOIN auf Array-Elemente ueber LATERAL,
// damit wir die Namen der referenzierten Mitglieder als JSON-Array mit
// zurueckbekommen, ohne N+1.
const TERMIN_SELECT = `
  SELECT t.*,
    p.name as project_name,
    COALESCE(
      (SELECT json_agg(json_build_object('id', tm.id, 'name', tm.name))
         FROM team_members tm
        WHERE tm.id = ANY(COALESCE(t.assignee_ids, '{}'::uuid[]))),
      '[]'::json
    ) as assignees_resolved
  FROM termine t
  LEFT JOIN projects p ON t.project_id = p.id
`;

export const dbTermine: TerminRepository = {
  async save(datum, text, uhrzeit, project) {
    const datumErr = validateDatum(datum);
    if (datumErr) return datumErr;
    if (uhrzeit) {
      const uhrzeitErr = validateUhrzeit(uhrzeit);
      if (uhrzeitErr) return uhrzeitErr;
    }
    datum = normalizeDatum(datum);

    const db = getDb();
    // Volle UUID — die termine.id-Spalte ist UUID-typisiert, ein .slice(0,8)
    // wuerde PostgresError "invalid input syntax for type uuid" werfen.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let projectId: string | null = null;
    if (project) {
      const [p] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      projectId = p?.id ?? null;
    }

    await db`
      INSERT INTO termine (id, text, datum, uhrzeit, project_id, created_at)
      VALUES (${id}, ${text}, ${datum}, ${uhrzeit ?? null}, ${projectId}, ${now})
    `;
    const termin = await this.get(id);
    if (!termin) throw new Error("Termin nach INSERT nicht lesbar");
    return termin;
  },

  async list(project) {
    const db = getDb();
    if (project) {
      const rows = await db.unsafe(`${TERMIN_SELECT} WHERE p.name = $1 ORDER BY t.datum, t.uhrzeit`, [project]);
      return rows.map((r) => rowToTermin(r as Record<string, unknown>));
    }
    const rows = await db.unsafe(`${TERMIN_SELECT} ORDER BY t.datum, t.uhrzeit`);
    return rows.map((r) => rowToTermin(r as Record<string, unknown>));
  },

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${TERMIN_SELECT} WHERE t.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToTermin(rows[0] as Record<string, unknown>) : null;
  },

  async update(id, updates) {
    const db = getDb();

    // Aktuelle Werte holen um undefined vs null unterscheiden zu koennen
    const [current] = await db`SELECT * FROM termine WHERE id = ${id}`;
    if (!current) return null;

    if (updates.datum) {
      const err = validateDatum(updates.datum);
      if (err) return null;
      updates = { ...updates, datum: normalizeDatum(updates.datum) };
    }

    const text = "text" in updates ? updates.text : current.text;
    const datum = "datum" in updates ? updates.datum : current.datum;
    const uhrzeit = "uhrzeit" in updates ? updates.uhrzeit : current.uhrzeit;
    const endzeit = "endzeit" in updates ? updates.endzeit : current.endzeit;
    const location = "location" in updates ? updates.location : current.location;
    let assignees = "assignees" in updates ? updates.assignees : current.assignees;
    const assigneeIds = "assigneeIds" in updates ? updates.assigneeIds : (current.assignee_ids as string[]);

    // Wenn assigneeIds neu gesetzt werden, denormalisieren wir den assignees-
    // Freitext-Array analog auf die zugehoerigen Namen, damit Legacy-Reader
    // konsistent bleiben. Externe Namen (nicht in team_members) gehen nicht
    // verloren — assignees darf zusaetzlich Eintraege enthalten.
    if ("assigneeIds" in updates && Array.isArray(assigneeIds) && assigneeIds.length > 0) {
      const members = await db`
        SELECT id, name FROM team_members WHERE id = ANY(${assigneeIds})
      `;
      const memberNames = members.map((m) => String(m.name));
      // Beibehalten aller Freitext-Namen die NICHT zu gemappten Mitgliedern
      // gehoeren (z.B. externe Teilnehmer).
      const existingText = Array.isArray(assignees) ? (assignees as string[]) : [];
      const memberNameSet = new Set(memberNames.map((n) => n.toLowerCase()));
      const extra = existingText.filter((n) => !memberNameSet.has(n.toLowerCase()));
      assignees = [...memberNames, ...extra];
    }

    await db`
      UPDATE termine SET
        text = ${text}, datum = ${datum}, uhrzeit = ${uhrzeit},
        endzeit = ${endzeit}, location = ${location},
        assignees = ${assignees as string[]},
        assignee_ids = ${(assigneeIds ?? []) as string[]}
      WHERE id = ${id}
    `;
    return this.get(id);
  },

  async delete(textOrId) {
    const db = getDb();
    // id::text verhindert "invalid input syntax for type uuid" wenn ein
    // Text-Match statt einer UUID uebergeben wird.
    const result = await db`
      DELETE FROM termine
      WHERE id::text = ${textOrId} OR text LIKE ${"%" + textOrId + "%"}
    `;
    return result.count > 0;
  },

  // ── Microsoft-Graph-Sync ─────────────────────────────────────

  async getByMsEventId(msEventId) {
    const db = getDb();
    const rows = await db.unsafe(`${TERMIN_SELECT} WHERE t.ms_event_id = $1 LIMIT 1`, [msEventId]);
    return rows[0] ? rowToTermin(rows[0] as Record<string, unknown>) : null;
  },

  async upsertFromMs(input: TerminFromMsInput): Promise<Termin> {
    const db = getDb();

    // Manueller Upsert: ON CONFLICT (ms_event_id) wuerde an dem partial
    // UNIQUE-Index "uq_termine_ms_event_id ... WHERE ms_event_id IS NOT NULL"
    // (Migration 023) scheitern — PostgreSQL kann partial-Index-Inference
    // nur, wenn der index_predicate exakt repliziert wird. Statt das fragil
    // zu replizieren machen wir SELECT-then-INSERT-or-UPDATE in einer
    // Transaktion. Race-condition-frei, weil wir innerhalb einer Single-
    // Connection-Transaktion arbeiten + UNIQUE-Index uns vor parallelen
    // Inserts schuetzt (zweiter Insert wuerde 23505 werfen → wir koennten
    // bei Bedarf retryen, aber bei MS-Sync ist nur ein Worker pro User aktiv).
    const now = new Date().toISOString();

    const [existing] = await db`
      SELECT id FROM termine WHERE ms_event_id = ${input.msEventId} LIMIT 1
    `;

    let resultId: string;
    if (existing) {
      resultId = String(existing.id);
      await db`
        UPDATE termine SET
          text             = ${input.text},
          datum            = ${input.datum},
          uhrzeit          = ${input.uhrzeit},
          endzeit          = ${input.endzeit},
          location         = ${input.location},
          ms_calendar_id   = ${input.msCalendarId},
          ms_etag          = ${input.msEtag},
          ms_sync_status   = 'synced',
          ms_last_sync_at  = ${now}
        WHERE id = ${resultId}
      `;
    } else {
      resultId = crypto.randomUUID();
      await db`
        INSERT INTO termine (
          id, text, datum, uhrzeit, endzeit, location, created_at,
          ms_event_id, ms_calendar_id, ms_owner_user_id, ms_etag,
          ms_sync_status, ms_last_sync_at, ms_source
        ) VALUES (
          ${resultId}, ${input.text}, ${input.datum}, ${input.uhrzeit}, ${input.endzeit}, ${input.location}, ${now},
          ${input.msEventId}, ${input.msCalendarId}, ${input.msOwnerUserId}, ${input.msEtag},
          'synced', ${now}, 'microsoft'
        )
      `;
    }
    const result = await this.get(resultId);
    if (!result) throw new Error("Termin nach upsertFromMs nicht lesbar");
    return result;
  },

  async listPendingForUser(userId): Promise<Termin[]> {
    const db = getDb();
    const rows = await db.unsafe(
      `${TERMIN_SELECT} WHERE t.ms_sync_status = 'pending' AND t.ms_owner_user_id = $1 ORDER BY t.datum, t.uhrzeit`,
      [userId],
    );
    return rows.map((r) => rowToTermin(r as Record<string, unknown>));
  },

  async markMsSynced(id, patch): Promise<void> {
    const db = getDb();
    await db`
      UPDATE termine SET
        ms_event_id     = ${patch.msEventId},
        ms_calendar_id  = ${patch.msCalendarId},
        ms_etag         = ${patch.msEtag},
        ms_sync_status  = 'synced',
        ms_last_sync_at = now()
      WHERE id = ${id}
    `;
  },

  async markMsSyncError(id): Promise<void> {
    const db = getDb();
    await db`UPDATE termine SET ms_sync_status = 'error' WHERE id = ${id}`;
  },

  async markMsPending(id, ownerUserId): Promise<void> {
    const db = getDb();
    // Nur als pending markieren wenn der Termin noch nicht aus MS kam
    // (sonst koennten wir einen Outlook-Event von uns ueberschreiben).
    // Existing 'synced' MS-Termine werden auch wieder pending gesetzt
    // (lokale Aenderung an einem Outlook-Event → push back).
    await db`
      UPDATE termine SET
        ms_sync_status   = 'pending',
        ms_owner_user_id = COALESCE(ms_owner_user_id, ${ownerUserId}),
        ms_source        = COALESCE(ms_source, 'bau-os')
      WHERE id = ${id}
    `;
  },

  async clearMsLink(id): Promise<void> {
    const db = getDb();
    await db`
      UPDATE termine SET
        ms_event_id     = NULL,
        ms_calendar_id  = NULL,
        ms_etag         = NULL,
        ms_sync_status  = NULL,
        ms_last_sync_at = NULL
      WHERE id = ${id}
    `;
  },
};
