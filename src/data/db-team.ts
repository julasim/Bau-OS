// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import type { TeamMember, TeamRepository } from "./types.js";

function rowToMember(row: Record<string, unknown>): TeamMember {
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role ? String(row.role) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    company: row.company ? String(row.company) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const dbTeam: TeamRepository = {
  async list() {
    const db = getDb();
    const rows = await db`SELECT * FROM team_members ORDER BY name`;
    return rows.map(rowToMember);
  },

  async get(id) {
    const db = getDb();
    const [row] = await db`SELECT * FROM team_members WHERE id = ${id}`;
    return row ? rowToMember(row) : null;
  },

  async add(member) {
    const db = getDb();
    const id = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const name = member.name;
    const role = member.role ?? null;
    const email = member.email ?? null;
    const phone = member.phone ?? null;
    const company = member.company ?? null;
    const projectId = member.projectId ?? null;

    const [row] = await db`
      INSERT INTO team_members (id, name, role, email, phone, company, project_id, created_at, updated_at)
      VALUES (${id}, ${name}, ${role}, ${email}, ${phone}, ${company}, ${projectId}, ${now}, ${now})
      RETURNING *
    `;
    return rowToMember(row);
  },

  async update(id, updates) {
    const db = getDb();
    const [current] = await db`SELECT * FROM team_members WHERE id = ${id}`;
    if (!current) return null;

    const name = "name" in updates ? updates.name : current.name;
    const role = "role" in updates ? updates.role : current.role;
    const email = "email" in updates ? updates.email : current.email;
    const phone = "phone" in updates ? updates.phone : current.phone;
    const company = "company" in updates ? updates.company : current.company;
    const projectId = "projectId" in updates ? updates.projectId : current.project_id;

    const [row] = await db`
      UPDATE team_members SET
        name = ${name}, role = ${role}, email = ${email},
        phone = ${phone}, company = ${company}, project_id = ${projectId}
      WHERE id = ${id}
      RETURNING *
    `;
    return row ? rowToMember(row) : null;
  },

  async remove(nameOrId) {
    const db = getDb();
    const result = await db`
      DELETE FROM team_members WHERE id = ${nameOrId} OR name = ${nameOrId}
    `;
    return result.count > 0;
  },
};
