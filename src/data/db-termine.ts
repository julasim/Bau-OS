// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import { validateDatum, validateUhrzeit, normalizeDatum } from "./termin-validation.js";
import type { Termin, TerminRepository } from "./types.js";

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
    phaseId: row.phase_id ? String(row.phase_id) : null,
    isMilestone: row.is_milestone === true,
    createdById: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
    /** Konflikt-Zaehler (Migration 042) — die Oberflaeche schickt ihn beim
     *  Speichern zurueck. Fehlt er im DTO, ist der Schutz von aussen unerreichbar. */
    rev: Number(row.rev ?? 1),
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
  -- Der Papierkorb (Migration 049) wird HIER ausgefiltert, in der gemeinsamen
  -- Abfrage, und nicht an den sieben Aufrufstellen. Eine neue Abfrage, die
  -- diese Konstante benutzt, ist damit von sich aus richtig; eine, die den
  -- Filter selbst mitbringen muesste, waere die naechste vergessene Stelle.
  FROM (SELECT * FROM termine WHERE deleted_at IS NULL) t
  LEFT JOIN projects p ON t.project_id = p.id
`;

export const dbTermine: TerminRepository = {
  async save(datum, text, uhrzeit, project, createdById) {
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
      INSERT INTO termine (id, text, datum, uhrzeit, project_id, created_by, created_at)
      VALUES (${id}, ${text}, ${datum}, ${uhrzeit ?? null}, ${projectId}, ${createdById ?? null}, ${now})
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

    // Konfliktschutz (Migration 042): schickt der Aufrufer einen Zaehler mit,
    // muss er noch stimmen — sonst hat in der Zwischenzeit jemand anderes
    // gespeichert. Ohne Zaehler gilt weiterhin „zuletzt gewinnt".
    pruefeRev(rowToTermin(current), current.rev, (updates as { rev?: number }).rev);

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
    // Migration 035: Phasen-Verknuepfung + Meilenstein-Flag.
    const phaseId = "phaseId" in updates ? (updates.phaseId ?? null) : current.phase_id;
    const isMilestone = "isMilestone" in updates ? (updates.isMilestone ?? false) : current.is_milestone;
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

    const betroffen = await db`
      UPDATE termine SET
        text = ${text}, datum = ${datum}, uhrzeit = ${uhrzeit},
        endzeit = ${endzeit}, location = ${location},
        assignees = ${assignees as string[]},
        assignee_ids = ${(assigneeIds ?? []) as string[]},
        phase_id = ${phaseId ?? null}, is_milestone = ${isMilestone ?? false},
        rev = rev + 1
      WHERE id = ${id} AND rev = ${current.rev}
      RETURNING id
    `;
    // Keine Zeile getroffen heisst: zwischen Lesen und Schreiben hat jemand
    // anderes gespeichert. Ohne diese Pruefung taete die Anweisung STILL
    // nichts und meldete trotzdem Erfolg.
    if (betroffen.length === 0) {
      const [jetzt] = await db`SELECT * FROM termine WHERE id = ${id}`;
      if (!jetzt) return null; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(rowToTermin(jetzt), Number(current.rev), Number(jetzt.rev));
    }
    return this.get(id);
  },

  /** Legt den Termin in den Papierkorb (Migration 049).
   *
   *  Frueher stand hier ein `DELETE … WHERE id::text = $1 OR text LIKE '%$1%'`.
   *  Das ist derselbe Fehler, der in `db-notes` schon einmal zugeschlagen hat:
   *  die Bedingung trifft ALLE Termine, deren Text die Angabe enthaelt, und
   *  geloescht wurden sie alle — gemeldet nur, dass „mindestens einer"
   *  betroffen war. Wer „Abnahme" loeschte, verlor jeden Termin mit „Abnahme"
   *  im Text.
   *
   *  Jetzt nur noch ueber die ID. Die Route loest ohnehin vorher ueber `get()`
   *  auf, um die Rechte zu pruefen — der Textweg war unerreichbar und trotzdem
   *  gefaehrlich. */
  async delete(id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
    const db = getDb();
    const result = await db`UPDATE termine SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`;
    return result.count > 0;
  },

  async listDeleted(sichtbareProjekte) {
    const db = getDb();
    const eingeschraenkt = Array.isArray(sichtbareProjekte);
    if (eingeschraenkt && sichtbareProjekte.length === 0) return [];
    const rows = eingeschraenkt
      ? await db`
          SELECT t.id, t.text AS titel, p.name AS project_name, t.deleted_at, t.created_by
            FROM termine t LEFT JOIN projects p ON p.id = t.project_id
           WHERE t.deleted_at IS NOT NULL
             AND (t.project_id = ANY(${db.array(sichtbareProjekte)}::uuid[])
                  -- Datensaetze OHNE Projekt sind persoenlich. Sie muessen hier
                  -- durch, damit die Route sie ihrem Verfasser zeigen kann; wem
                  -- sie NICHT gehoeren, den filtert die Route heraus.
                  OR t.project_id IS NULL)
           ORDER BY t.deleted_at DESC`
      : await db`
          SELECT t.id, t.text AS titel, p.name AS project_name, t.deleted_at, t.created_by
            FROM termine t LEFT JOIN projects p ON p.id = t.project_id
           WHERE t.deleted_at IS NOT NULL
           ORDER BY t.deleted_at DESC`;
    return rows.map((r) => ({
      id: String(r.id),
      titel: String(r.titel),
      projectName: r.project_name ? String(r.project_name) : null,
      geloeschtAm: String(r.deleted_at),
      createdById: r.created_by ? String(r.created_by) : null,
    }));
  },

  async restore(id) {
    const db = getDb();
    const r = await db`UPDATE termine SET deleted_at = NULL WHERE id = ${id} AND deleted_at IS NOT NULL`;
    return r.count > 0;
  },

  async purge(id) {
    const db = getDb();
    const r = await db`DELETE FROM termine WHERE id = ${id} AND deleted_at IS NOT NULL`;
    return r.count > 0;
  },
};
