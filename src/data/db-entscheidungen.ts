// Datenbank-Implementation: PostgreSQL via postgres.js
//
// Entscheidungslog (Migration 045). Portiert aus `apps/patio-app-lokal`, wo es
// dateibasiert lief — uebernommen sind Feldschnitt und Semantik, nicht der
// Code.
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import { alsIso } from "./zeitstempel.js";
import type {
  Entscheidung,
  EntscheidungAlternative,
  EntscheidungInput,
  EntscheidungRepository,
  EntscheidungStatus,
} from "./types.js";

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const STATUS: EntscheidungStatus[] = ["entwurf", "bestaetigt"];

function rowToEntscheidung(row: Record<string, unknown>): Entscheidung {
  const datumRoh = row.datum;
  const datum = datumRoh instanceof Date ? datumRoh.toISOString().slice(0, 10) : String(datumRoh ?? "").slice(0, 10);

  // JSONB kommt je nach Treiberpfad als Objekt oder als String zurueck.
  let alternativen = row.alternativen;
  if (typeof alternativen === "string") {
    try {
      alternativen = JSON.parse(alternativen);
    } catch {
      alternativen = [];
    }
  }

  const beteiligteRoh = row.beteiligte_resolved;
  const beteiligteResolved = Array.isArray(beteiligteRoh)
    ? (beteiligteRoh as Array<Record<string, unknown>>)
        .filter((b) => b && b.id)
        .map((b) => ({ id: String(b.id), name: String(b.name) }))
    : [];

  const meetingRoh = row.related_meeting_resolved as Record<string, unknown> | null | undefined;

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: row.project_name ? String(row.project_name) : null,
    projektnummer: row.project_nummer ? String(row.project_nummer) : null,
    datum,
    titel: String(row.titel),
    begruendung: row.begruendung ? String(row.begruendung) : null,
    alternativen: Array.isArray(alternativen) ? (alternativen as EntscheidungAlternative[]) : [],
    beteiligteIds: Array.isArray(row.beteiligte_ids) ? (row.beteiligte_ids as string[]).map(String) : [],
    beteiligteResolved,
    beteiligteExtern: Array.isArray(row.beteiligte_extern) ? (row.beteiligte_extern as string[]).map(String) : [],
    status: (STATUS.includes(row.status as EntscheidungStatus) ? row.status : "entwurf") as EntscheidungStatus,
    relatedMeetingId: row.related_meeting_id ? String(row.related_meeting_id) : null,
    relatedMeetingResolved:
      meetingRoh && meetingRoh.id
        ? {
            id: String(meetingRoh.id),
            title: String(meetingRoh.title),
            date: String(meetingRoh.date).slice(0, 10),
          }
        : null,
    createdById: row.created_by ? String(row.created_by) : null,
    createdByUsername: row.created_by_username ? String(row.created_by_username) : undefined,
    createdAt: alsIso(row.created_at),
    updatedAt: alsIso(row.updated_at),
    rev: Number(row.rev ?? 1),
  };
}

// Gemeinsame SELECT-Klausel. Die Namen der Beteiligten kommen ueber eine
// korrelierte Unterabfrage als JSON-Array mit — sonst braeuchte jede Zeile
// eine eigene Nachfrage (N+1).
//
// Der Besprechungs-Join traegt die Projektbedingung IM JOIN, nicht im WHERE:
// so bleibt die Entscheidung sichtbar, wenn die verknuepfte Besprechung in
// einem anderen Projekt liegt — nur der Bezug wird dann nicht aufgeloest.
// Andersherum verschwaende ein Datensatz still aus der Liste.
const SELECT = `
  SELECT e.*,
         p.name AS project_name, p.projektnummer AS project_nummer,
         u.username AS created_by_username,
         (SELECT json_agg(json_build_object('id', tm.id, 'name', tm.name))
            FROM team_members tm
           WHERE tm.id = ANY(e.beteiligte_ids)) AS beteiligte_resolved,
         (SELECT json_build_object('id', m.id, 'title', m.title, 'date', m.meeting_date)
            FROM meetings m
           WHERE m.id = e.related_meeting_id AND m.project_id = e.project_id) AS related_meeting_resolved
    FROM entscheidungen e
    LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN users u ON u.id = e.created_by
`;

/** Prueft die Eingabe und liefert im Fehlerfall den Text, der beim Benutzer
 *  ankommt. Bewusst konkret statt „ungueltige Eingabe". */
function pruefeEingabe(input: Partial<EntscheidungInput>, istNeu: boolean): string | null {
  if (istNeu || input.datum !== undefined) {
    if (!input.datum || !ISO_DATUM.test(input.datum)) return "Datum muss im Format JJJJ-MM-TT angegeben sein";
  }
  if (istNeu || input.titel !== undefined) {
    if (!input.titel || !String(input.titel).trim()) return "Ein Titel ist erforderlich";
  }
  if (input.status !== undefined && input.status !== null && !STATUS.includes(input.status)) {
    return "Status muss 'entwurf' oder 'bestaetigt' sein";
  }
  if (input.alternativen !== undefined && !Array.isArray(input.alternativen)) {
    return "Alternativen muessen als Liste uebergeben werden";
  }
  return null;
}

export const dbEntscheidungen: EntscheidungRepository = {
  async list(projectId, limit = 50) {
    const db = getDb();
    const rows = await db.unsafe(
      `${SELECT} WHERE e.project_id = $1 ORDER BY e.datum DESC, e.created_at DESC LIMIT $2`,
      [projectId, limit],
    );
    return rows.map((r) => rowToEntscheidung(r as Record<string, unknown>));
  },

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE e.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToEntscheidung(rows[0] as Record<string, unknown>) : null;
  },

  async create(projectId, input, createdById = null) {
    const fehler = pruefeEingabe(input, true);
    if (fehler) return fehler;

    const db = getDb();

    // Eine Besprechung aus einem FREMDEN Projekt darf nicht verknuepft werden
    // — sonst stuende in der Entscheidung eines Projekts der Titel einer
    // Besprechung aus einem anderen, und das waere ein stiller Datenabfluss
    // ueber die Projektgrenze hinweg.
    if (input.relatedMeetingId) {
      const [m] = await db`SELECT project_id FROM meetings WHERE id = ${input.relatedMeetingId} LIMIT 1`;
      if (!m) return "Die verknuepfte Besprechung gibt es nicht";
      if (String(m.project_id) !== String(projectId)) {
        return "Die verknuepfte Besprechung gehoert zu einem anderen Projekt";
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db`
      INSERT INTO entscheidungen (
        id, project_id, datum, titel, begruendung,
        alternativen, beteiligte_ids, beteiligte_extern,
        status, related_meeting_id, created_by, created_at, updated_at
      ) VALUES (
        ${id}, ${projectId}, ${input.datum}, ${input.titel.trim()}, ${input.begruendung ?? null},
        ${JSON.stringify(input.alternativen ?? [])}::jsonb,
        ${input.beteiligteIds ?? []}::uuid[],
        ${input.beteiligteExtern ?? []}::text[],
        ${input.status ?? "entwurf"}, ${input.relatedMeetingId ?? null}, ${createdById}, ${now}, ${now}
      )
    `;
    const angelegt = await this.get(id);
    if (!angelegt) throw new Error("Entscheidung konnte nicht gelesen werden");
    return angelegt;
  },

  async update(id, input) {
    const fehler = pruefeEingabe(input, false);
    if (fehler) return fehler;

    const db = getDb();
    const [current] = await db`SELECT * FROM entscheidungen WHERE id = ${id}`;
    if (!current) return null;

    // Konfliktschutz (Migration 042). Siehe src/data/konflikt.ts.
    pruefeRev(rowToEntscheidung(current), current.rev, input.rev);

    if (input.relatedMeetingId) {
      const [m] = await db`SELECT project_id FROM meetings WHERE id = ${input.relatedMeetingId} LIMIT 1`;
      if (!m) return "Die verknuepfte Besprechung gibt es nicht";
      if (String(m.project_id) !== String(current.project_id)) {
        return "Die verknuepfte Besprechung gehoert zu einem anderen Projekt";
      }
    }

    const datum = input.datum ?? current.datum;
    const titel = input.titel !== undefined ? input.titel.trim() : current.titel;
    const begruendung = "begruendung" in input ? (input.begruendung ?? null) : current.begruendung;
    const alternativen = input.alternativen ?? current.alternativen;
    const beteiligteIds = input.beteiligteIds ?? current.beteiligte_ids;
    const beteiligteExtern = input.beteiligteExtern ?? current.beteiligte_extern;
    const status = input.status ?? current.status;
    const relatedMeetingId =
      "relatedMeetingId" in input ? (input.relatedMeetingId ?? null) : current.related_meeting_id;

    const geschrieben = await db`
      UPDATE entscheidungen SET
        datum = ${datum},
        titel = ${titel},
        begruendung = ${begruendung},
        alternativen = ${JSON.stringify(alternativen)}::jsonb,
        beteiligte_ids = ${beteiligteIds}::uuid[],
        beteiligte_extern = ${beteiligteExtern}::text[],
        status = ${status},
        related_meeting_id = ${relatedMeetingId},
        rev = rev + 1,
        updated_at = ${new Date().toISOString()}
      WHERE id = ${id} AND rev = ${current.rev}
      RETURNING id
    `;
    if (geschrieben.length === 0) {
      const [jetzt] = await db`SELECT * FROM entscheidungen WHERE id = ${id}`;
      if (!jetzt) return null;
      throw new KonfliktFehler(rowToEntscheidung(jetzt), Number(current.rev), Number(jetzt.rev));
    }
    return this.get(id);
  },

  async delete(id) {
    const db = getDb();
    const betroffen = await db`DELETE FROM entscheidungen WHERE id = ${id} RETURNING id`;
    return betroffen.length > 0;
  },

  async listRecent(visibleProjectIds, limit = 20) {
    const db = getDb();
    if (Array.isArray(visibleProjectIds)) {
      if (visibleProjectIds.length === 0) return [];
      // ::uuid[] ist Pflicht: project_id ist uuid, die Scope-IDs kommen als
      // Strings — ohne Cast wirft Postgres "operator does not exist: uuid = text",
      // und zwar nur bei Nicht-Admins.
      const rows = await db.unsafe(
        `${SELECT} WHERE e.project_id = ANY($1::uuid[]) ORDER BY e.datum DESC, e.created_at DESC LIMIT $2`,
        [visibleProjectIds as unknown as string, limit],
      );
      return rows.map((r) => rowToEntscheidung(r as Record<string, unknown>));
    }
    const rows = await db.unsafe(`${SELECT} ORDER BY e.datum DESC, e.created_at DESC LIMIT $1`, [limit]);
    return rows.map((r) => rowToEntscheidung(r as Record<string, unknown>));
  },
};
