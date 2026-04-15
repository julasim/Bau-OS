// Datenbank-Implementation: PostgreSQL via postgres.js
import { getDb } from "../db/client.js";
import type { Project, ProjectRepository } from "./types.js";
import {
  createProject as createProjectOnDisk,
  getProjectInfo as getProjectInfoFromDisk,
} from "../workspace/projects.js";

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
    if (row) {
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
    }
    // Fallback: DB hat keinen Eintrag, aber Vault-Ordner existiert vielleicht
    // (z.B. von einer alten manuellen Anlage). Damit der Agent korrekt sieht
    // "Projekt existiert", liefern wir die FS-Sicht zurueck.
    const disk = getProjectInfoFromDisk(name);
    if (!disk) return null;
    return {
      name: disk.name,
      notes: disk.notes,
      openTasks: disk.openTasks,
      termine: disk.termine,
      status: "aktiv",
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

  async create(name, description) {
    // Gleiche Unicode-Regel wie in workspace/projects.ts (Umlaute & Co. erlaubt)
    if (!/^[\p{L}\p{N}_\-. ]+$/u.test(name) || name.includes("..")) return false;

    const db = getDb();
    const folderPath = `Projekte/${name}`;

    // Idempotent in beide Richtungen:
    // 1. Vault-Ordner — falls noch nicht da, anlegen. Wenn schon da, ignorieren
    //    (createProject gibt false, das ist OK — wir wollen nur sicherstellen,
    //    dass am Ende beide Seiten existieren).
    createProjectOnDisk(name, description ?? null);

    // 2. DB-Eintrag — wenn schon vorhanden, NICHT als Fehler werten:
    //    "create" wird hier als "stelle sicher dass es existiert" interpretiert.
    //    folder_path ist NOT NULL in der Tabelle (siehe migrations/001_init.sql),
    //    deshalb MUSS der Wert mit gesetzt werden. ON CONFLICT (name) brauchen
    //    wir nicht, weil die Tabelle keinen UNIQUE-Constraint auf name hat —
    //    wir pruefen vorher per SELECT.
    const [existing] = await db`SELECT id FROM projects WHERE name = ${name} LIMIT 1`;
    if (existing) {
      // DB hatte den Eintrag schon (z.B. nach Server-Crash oder von vorherigem
      // erfolgreichem Lauf). Vault wurde oben sichergestellt → fertig.
      return true;
    }

    await db`
      INSERT INTO projects (name, folder_path, description, status)
      VALUES (${name}, ${folderPath}, ${description ?? null}, 'aktiv')
    `;
    return true;
  },
};
