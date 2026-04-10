// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import type { Task, TaskRepository } from "./types.js";

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    text: String(row.text),
    status: row.status as Task["status"],
    priority: row.priority ? String(row.priority) : undefined,
    assignee: row.assignee ? String(row.assignee) : null,
    date: row.date ? String(row.date) : null,
    dueDate: row.due_date ? String(row.due_date) : null,
    location: row.location ? String(row.location) : null,
    project: row.project_name ? String(row.project_name) : null,
    sortOrder: row.sort_order ? Number(row.sort_order) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const dbTasks: TaskRepository = {
  async save(text, project) {
    const db = getDb();
    const id = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();

    // Projekt-ID nachschlagen wenn Name gegeben
    let projectId: string | null = null;
    if (project) {
      const [p] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      projectId = p?.id ?? null;
    }

    const [row] = await db`
      INSERT INTO tasks (id, text, status, project_id, created_at, updated_at)
      VALUES (${id}, ${text}, 'offen', ${projectId}, ${now}, ${now})
      RETURNING *, (SELECT name FROM projects WHERE id = project_id) as project_name
    `;
    return rowToTask(row);
  },

  async list(project) {
    const db = getDb();
    if (project) {
      return (
        await db`
        SELECT t.*, p.name as project_name FROM tasks t
        LEFT JOIN projects p ON t.project_id = p.id
        WHERE p.name = ${project}
        ORDER BY t.sort_order, t.created_at DESC
      `
      ).map(rowToTask);
    }
    return (
      await db`
      SELECT t.*, p.name as project_name FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      ORDER BY t.sort_order, t.created_at DESC
    `
    ).map(rowToTask);
  },

  async listOpen(project) {
    const all = await this.list(project);
    return all.filter((t) => t.status !== "done");
  },

  async get(id) {
    const db = getDb();
    const [row] = await db`
      SELECT t.*, p.name as project_name FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = ${id}
    `;
    return row ? rowToTask(row) : null;
  },

  async update(id, updates) {
    const db = getDb();
    const now = new Date().toISOString();

    // Aktuelle Werte holen um undefined vs null unterscheiden zu koennen
    const [current] = await db`SELECT * FROM tasks WHERE id = ${id}`;
    if (!current) return null;

    const text = "text" in updates ? (updates.text ?? null) : current.text;
    const status = "status" in updates ? (updates.status ?? null) : current.status;
    const assignee = "assignee" in updates ? (updates.assignee ?? null) : current.assignee;
    const date = "date" in updates ? (updates.date ?? null) : current.date;
    const location = "location" in updates ? (updates.location ?? null) : current.location;
    const priority = "priority" in updates ? (updates.priority ?? null) : current.priority;

    const [row] = await db`
      UPDATE tasks SET
        text = ${text}, status = ${status}, assignee = ${assignee},
        date = ${date}, location = ${location}, priority = ${priority},
        updated_at = ${now}
      WHERE id = ${id}
      RETURNING *, (SELECT name FROM projects WHERE id = project_id) as project_name
    `;
    return row ? rowToTask(row) : null;
  },

  async complete(textOrId) {
    const db = getDb();
    const now = new Date().toISOString();
    const result = await db`
      UPDATE tasks SET status = 'done', completed_at = ${now}, updated_at = ${now}
      WHERE id = ${textOrId} OR text = ${textOrId}
    `;
    return result.count > 0;
  },

  async delete(id) {
    const db = getDb();
    const result = await db`DELETE FROM tasks WHERE id = ${id}`;
    return result.count > 0;
  },
};
