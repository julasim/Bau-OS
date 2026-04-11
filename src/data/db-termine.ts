// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { validateDatum, validateUhrzeit } from "../workspace/termine.js";
import type { Termin, TerminRepository } from "./types.js";

function rowToTermin(row: Record<string, unknown>): Termin {
  return {
    id: String(row.id),
    text: String(row.text),
    datum: String(row.datum),
    uhrzeit: row.uhrzeit ? String(row.uhrzeit) : null,
    endzeit: row.endzeit ? String(row.endzeit) : null,
    location: row.location ? String(row.location) : null,
    assignees: (row.assignees as string[]) || [],
    project: row.project_name ? String(row.project_name) : null,
    recurring: row.recurring ? String(row.recurring) : null,
    color: row.color ? String(row.color) : null,
    createdAt: String(row.created_at),
  };
}

export const dbTermine: TerminRepository = {
  async save(datum, text, uhrzeit, project) {
    const datumErr = validateDatum(datum);
    if (datumErr) return datumErr;
    if (uhrzeit) {
      const uhrzeitErr = validateUhrzeit(uhrzeit);
      if (uhrzeitErr) return uhrzeitErr;
    }

    const db = getDb();
    const id = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();

    let projectId: string | null = null;
    if (project) {
      const [p] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      projectId = p?.id ?? null;
    }

    const [row] = await db`
      INSERT INTO termine (id, text, datum, uhrzeit, project_id, created_at)
      VALUES (${id}, ${text}, ${datum}, ${uhrzeit ?? null}, ${projectId}, ${now})
      RETURNING *, (SELECT name FROM projects WHERE id = project_id) as project_name
    `;
    return rowToTermin(row);
  },

  async list(project) {
    const db = getDb();
    if (project) {
      return (
        await db`
        SELECT t.*, p.name as project_name FROM termine t
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE p.name = ${project}
        ORDER BY t.datum, t.uhrzeit
      `
      ).map(rowToTermin);
    }
    return (
      await db`
      SELECT t.*, p.name as project_name FROM termine t
      LEFT JOIN projects p ON t.project_id = p.id
      ORDER BY t.datum, t.uhrzeit
    `
    ).map(rowToTermin);
  },

  async get(id) {
    const db = getDb();
    const [row] = await db`
      SELECT t.*, p.name as project_name FROM termine t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = ${id}
    `;
    return row ? rowToTermin(row) : null;
  },

  async update(id, updates) {
    const db = getDb();

    // Aktuelle Werte holen um undefined vs null unterscheiden zu koennen
    const [current] = await db`SELECT * FROM termine WHERE id = ${id}`;
    if (!current) return null;

    const text = "text" in updates ? (updates.text ?? null) : current.text;
    const datum = "datum" in updates ? (updates.datum ?? null) : current.datum;
    const uhrzeit = "uhrzeit" in updates ? (updates.uhrzeit ?? null) : current.uhrzeit;
    const endzeit = "endzeit" in updates ? (updates.endzeit ?? null) : current.endzeit;
    const location = "location" in updates ? (updates.location ?? null) : current.location;
    const assignees = "assignees" in updates ? (updates.assignees ?? null) : current.assignees;

    const [row] = await db`
      UPDATE termine SET
        text = ${text}, datum = ${datum}, uhrzeit = ${uhrzeit},
        endzeit = ${endzeit}, location = ${location}, assignees = ${assignees}
      WHERE id = ${id}
      RETURNING *, (SELECT name FROM projects WHERE id = project_id) as project_name
    `;
    return row ? rowToTermin(row) : null;
  },

  async delete(textOrId) {
    const db = getDb();
    const result = await db`
      DELETE FROM termine WHERE id = ${textOrId} OR text LIKE ${"%" + textOrId + "%"}
    `;
    return result.count > 0;
  },
};
