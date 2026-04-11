// Datenbank-Implementation: PostgreSQL via postgres.js
import { getDb } from "../db/client.js";
import type { Project, ProjectRepository } from "./types.js";

export const dbProjects: ProjectRepository = {
  async list() {
    const db = getDb();
    const rows = await db`SELECT name FROM projects WHERE status = 'aktiv' ORDER BY name`;
    return rows.map((r) => String(r.name));
  },

  async getInfo(name) {
    const db = getDb();
    const [row] = await db`
      SELECT
        p.id, p.name, p.description, p.status, p.color, p.created_at, p.updated_at,
        (SELECT count(*) FROM notes n WHERE n.project_id = p.id) as notes,
        (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') as open_tasks,
        (SELECT count(*) FROM termine te WHERE te.project_id = p.id) as termine
      FROM projects p
      WHERE p.name = ${name}
      LIMIT 1
    `;
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      status: String(row.status),
      color: row.color ? String(row.color) : null,
      notes: Number(row.notes),
      openTasks: Number(row.open_tasks),
      termine: Number(row.termine),
      createdAt: row.created_at ? String(row.created_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    };
  },

  async listNotes(name) {
    const db = getDb();
    const rows = await db`
      SELECT n.title FROM notes n
      JOIN projects p ON n.project_id = p.id
      WHERE p.name = ${name}
      ORDER BY n.created_at DESC
    `;
    return rows.map((r) => String(r.title));
  },

  async readNote(project, noteName) {
    const db = getDb();
    const [row] = await db`
      SELECT n.content FROM notes n
      JOIN projects p ON n.project_id = p.id
      WHERE p.name = ${project} AND (n.title = ${noteName} OR n.title LIKE ${noteName + "%"})
      LIMIT 1
    `;
    return row ? String(row.content) : null;
  },
};
