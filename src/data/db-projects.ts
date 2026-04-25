// Datenbank-Implementation: PostgreSQL via postgres.js
//
// Projekte sind rein logische DB-Entities — es werden KEINE Vault-Ordner
// mehr angelegt oder geloescht. User-Daten liegen komplett in Postgres
// (Notizen, Tasks, Termine, Files als bytea). Der Vault speichert nur
// noch System-Dateien (Agenten-Workspace, users.json, Tools, Logs).
import { getDb } from "../db/client.js";
import type { ProjectAccessEntry, ProjectCreateOptions, ProjectRepository, ProjectUpdate } from "./types.js";

// Mapping: camelCase-API-Feld ↔ snake_case-Spaltenname.
// Wird beim dynamischen UPDATE genutzt, um tippfest aus dem Patch auf
// die DB-Spalten zu kommen — ohne dass der Caller snake_case kennen muss.
const UPDATE_COLUMNS: Record<keyof ProjectUpdate, string> = {
  description: "description",
  status: "status",
  color: "color",
  projektnummer: "projektnummer",
  bauherr: "bauherr",
  standort: "standort",
  projektart: "projektart",
  nutzung: "nutzung",
  phase: "phase",
  startDate: "start_date",
  endDate: "end_date",
  bauherrId: "bauherr_id",
  parentId: "parent_id",
};

function isValidName(name: string): boolean {
  return /^[\p{L}\p{N}_\-. ]+$/u.test(name) && !name.includes("..");
}

export const dbProjects: ProjectRepository = {
  async list(visibleIds) {
    const db = getDb();
    // Phase 4: wenn visibleIds ein Array ist, nur diese Projekte zurueckgeben.
    // "all" oder undefined = kein Filter (Admin / Legacy-Caller).
    if (Array.isArray(visibleIds)) {
      if (visibleIds.length === 0) return [];
      const rows = await db`
        SELECT name FROM projects
        WHERE status = 'aktiv' AND id = ANY(${visibleIds})
        ORDER BY name
      `;
      return rows.map((r) => String(r.name));
    }
    const rows = await db`SELECT name FROM projects WHERE status = 'aktiv' ORDER BY name`;
    return rows.map((r) => String(r.name));
  },

  async getInfo(name) {
    const db = getDb();
    const [row] = await db`
      SELECT
        p.id, p.name, p.description, p.status, p.color,
        p.projektnummer, p.bauherr, p.standort, p.projektart, p.nutzung,
        p.phase, p.start_date, p.end_date,
        p.bauherr_id, p.parent_id,
        p.created_by,
        bm.name as bauherr_name,
        parent.name as parent_name,
        creator.username as created_by_username,
        p.created_at, p.updated_at,
        (SELECT count(*) FROM notes n WHERE n.project_id = p.id) as notes,
        (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') as open_tasks,
        (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as done_tasks,
        (SELECT count(*) FROM termine te WHERE te.project_id = p.id) as termine,
        (SELECT count(*) FROM files f WHERE f.project_id = p.id) as files,
        (SELECT count(*) FROM projects child WHERE child.parent_id = p.id) as children_count
      FROM projects p
      LEFT JOIN team_members bm ON bm.id = p.bauherr_id
      LEFT JOIN projects parent ON parent.id = p.parent_id
      LEFT JOIN users creator ON creator.id = p.created_by
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
      projektnummer: row.projektnummer ? String(row.projektnummer) : null,
      bauherr: row.bauherr ? String(row.bauherr) : null,
      standort: row.standort ? String(row.standort) : null,
      projektart: row.projektart ? String(row.projektart) : null,
      nutzung: row.nutzung ? String(row.nutzung) : null,
      phase: row.phase ? String(row.phase) : null,
      startDate: row.start_date ? String(row.start_date) : null,
      endDate: row.end_date ? String(row.end_date) : null,
      bauherrId: row.bauherr_id ? String(row.bauherr_id) : null,
      bauherrName: row.bauherr_name ? String(row.bauherr_name) : null,
      parentId: row.parent_id ? String(row.parent_id) : null,
      parentName: row.parent_name ? String(row.parent_name) : null,
      createdById: row.created_by ? String(row.created_by) : null,
      createdByUsername: row.created_by_username ? String(row.created_by_username) : null,
      notes: Number(row.notes),
      openTasks: Number(row.open_tasks),
      doneTasks: Number(row.done_tasks),
      termine: Number(row.termine),
      files: Number(row.files),
      childrenCount: Number(row.children_count),
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

  async create(name, options, createdById) {
    // Gleiche Unicode-Regel wie vorher (Umlaute erlaubt, "..", Slashes nicht).
    if (!isValidName(name)) return false;

    // Rueckwaertskompatibilitaet: frueher wurde description als String uebergeben.
    const opts: ProjectCreateOptions =
      typeof options === "string" || options === null || options === undefined
        ? { description: options ?? null }
        : options;

    const db = getDb();

    // Idempotent: existiert der Name schon, ist das kein Fehler — "create"
    // heisst hier "stelle sicher dass es existiert". Falls bereits vorhanden,
    // patchen wir die Stammdaten durch (nur Felder die im Patch gesetzt sind).
    const [existing] = await db`SELECT id FROM projects WHERE name = ${name} LIMIT 1`;
    if (existing) {
      const patch: ProjectUpdate = {
        description: opts.description,
        projektnummer: opts.projektnummer,
        bauherr: opts.bauherr,
        standort: opts.standort,
        projektart: opts.projektart,
        nutzung: opts.nutzung,
        phase: opts.phase,
        startDate: opts.startDate,
        endDate: opts.endDate,
      };
      // Nur patchen, wenn mindestens ein Wert gesetzt ist — sonst no-op
      // (sonst wuerde ein nackter create()-Aufruf alle Spalten auf null
      // zuruecksetzen, wenn man das aus Versehen wieder bei bestehendem
      // Projekt aufruft).
      const hasAny = Object.values(patch).some((v) => v !== undefined);
      if (hasAny) await this.update(name, patch);
      // Auch bei bestehendem Projekt: wenn createdById uebergeben wurde,
      // user_projects-Eintrag idempotent setzen — z.B. fuer den Fall, dass
      // ein User ein Projekt anlegt, das ein anderer Admin schon erzeugt
      // hatte (ON CONFLICT verhindert Duplikat).
      if (createdById) {
        await db`
          INSERT INTO user_projects (user_id, project_id)
          VALUES (${createdById}, ${String(existing.id)})
          ON CONFLICT DO NOTHING
        `;
      }
      return true;
    }

    // folder_path ist seit migration 003 nullable — Projekte sind rein logisch.
    const [inserted] = await db`
      INSERT INTO projects (
        name, description, status,
        projektnummer, bauherr, standort, projektart, nutzung,
        phase, start_date, end_date,
        created_by
      )
      VALUES (
        ${name}, ${opts.description ?? null}, 'aktiv',
        ${opts.projektnummer ?? null}, ${opts.bauherr ?? null}, ${opts.standort ?? null},
        ${opts.projektart ?? null}, ${opts.nutzung ?? null},
        ${opts.phase ?? null}, ${opts.startDate ?? null}, ${opts.endDate ?? null},
        ${createdById ?? null}
      )
      RETURNING id
    `;
    // Ersteller automatisch in user_projects — ohne diesen Eintrag wuerde
    // ein Nicht-Admin sein eben angelegtes Projekt direkt nicht mehr sehen.
    if (createdById && inserted) {
      await db`
        INSERT INTO user_projects (user_id, project_id)
        VALUES (${createdById}, ${String(inserted.id)})
        ON CONFLICT DO NOTHING
      `;
    }
    return true;
  },

  async update(name, patch) {
    if (!isValidName(name)) return false;
    const db = getDb();

    // Nur Felder mit explizit gesetztem Wert (inkl. null!) in das UPDATE
    // aufnehmen. undefined = unveraendert, null = leeren.
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [
      keyof ProjectUpdate,
      ProjectUpdate[keyof ProjectUpdate],
    ][];
    if (entries.length === 0) return false;

    // Existenz pruefen (sonst wuerde UPDATE stillschweigend 0 Zeilen aendern).
    const [existing] = await db`SELECT id FROM projects WHERE name = ${name} LIMIT 1`;
    if (!existing) return false;

    // Loop-Schutz fuer parent_id: ein Projekt darf nicht sein eigenes Parent
    // werden. Tiefer liegende Zyklen (A → B → A) werden im Frontend vor dem
    // Auswaehlen verhindert — die DB hat dafuer keine CHECK-Semantik.
    if (patch.parentId && String(patch.parentId) === String(existing.id)) {
      return false;
    }

    // Dynamisches UPDATE per postgres.js — fuer jede Spalte ein eigener
    // Parameter, damit SQL-Injection ausgeschlossen ist. Spaltennamen
    // kommen aus der fix gemappten UPDATE_COLUMNS-Tabelle (Whitelist).
    //
    // postgres.js bietet kein natives "dynamic SET" — wir bauen das manuell
    // mit db.unsafe fuer die Spaltennamen + geparametrisierte Werte.
    const setFragments: string[] = [];
    // postgres.js unsafe() erwartet einen konkreten SQL-Parameter-Typ;
    // (string | null) deckt alles ab, was wir via ProjectUpdate patchen.
    const values: (string | null)[] = [];
    for (const [key, val] of entries) {
      const col = UPDATE_COLUMNS[key];
      if (!col) continue; // sollte nicht passieren (Typ-Guard)
      values.push(val == null ? null : String(val));
      setFragments.push(`${col} = $${values.length}`);
    }
    // updated_at Trigger setzt das Feld automatisch (siehe migration 001).
    const sql = `UPDATE projects SET ${setFragments.join(", ")} WHERE name = $${values.length + 1}`;
    values.push(name);

    await db.unsafe(sql, values);
    return true;
  },

  // ── ACL (Phase 3) ──────────────────────────────────────────

  async listAccess(projectId): Promise<ProjectAccessEntry[]> {
    const db = getDb();
    const rows = await db`
      SELECT u.id, u.username, u.display_name, u.role, up.added_at
      FROM user_projects up
      JOIN users u ON u.id = up.user_id
      WHERE up.project_id = ${projectId}
      ORDER BY u.username
    `;
    return rows.map((r) => ({
      userId: String(r.id),
      username: String(r.username),
      displayName: r.display_name ? String(r.display_name) : null,
      role: r.role === "admin" ? "admin" : "user",
      addedAt: String(r.added_at),
    }));
  },

  async grantAccess(projectId, userId) {
    const db = getDb();
    await db`
      INSERT INTO user_projects (user_id, project_id)
      VALUES (${userId}, ${projectId})
      ON CONFLICT DO NOTHING
    `;
    // Idempotent: nach Aufruf ist die Zuordnung garantiert vorhanden, egal
    // ob neu eingefuegt oder schon da. Daher immer true.
    return true;
  },

  async revokeAccess(projectId, userId) {
    const db = getDb();
    const result = await db`
      DELETE FROM user_projects
      WHERE user_id = ${userId} AND project_id = ${projectId}
    `;
    return result.count > 0;
  },

  async listVisibleProjectIds(userId) {
    const db = getDb();
    const rows = await db`
      SELECT project_id FROM user_projects WHERE user_id = ${userId}
    `;
    return rows.map((r) => String(r.project_id));
  },

  async listChildren(parentName) {
    const db = getDb();
    const rows = await db`
      SELECT child.id, child.name, child.status
      FROM projects parent
      JOIN projects child ON child.parent_id = parent.id
      WHERE parent.name = ${parentName}
      ORDER BY child.name
    `;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      status: r.status ? String(r.status) : null,
    }));
  },

  async rename(oldName, newName) {
    const trimmed = newName.trim();
    if (!isValidName(trimmed)) return "invalid";
    if (trimmed === oldName) return "ok"; // No-op
    const db = getDb();
    const [existing] = await db`SELECT id FROM projects WHERE name = ${oldName} LIMIT 1`;
    if (!existing) return "not-found";
    const [conflict] = await db`SELECT id FROM projects WHERE name = ${trimmed} LIMIT 1`;
    if (conflict) return "conflict";
    // id bleibt; FK-Konsistenz ist gewahrt, weil alle Child-Eintraege (notes,
    // tasks, termine, files, team_members) an projects.id haengen.
    await db`UPDATE projects SET name = ${trimmed} WHERE name = ${oldName}`;
    return "ok";
  },

  async delete(name) {
    if (!isValidName(name)) return false;

    const db = getDb();
    // FK-Verhalten laut migration 001_init.sql:
    // - notes.project_id: ON DELETE CASCADE (Notizen werden mitgeloescht)
    // - tasks / termine / files / team: ON DELETE SET NULL (werden nur entkoppelt)
    // DELETE ist idempotent — wenn kein Eintrag da ist, passiert nichts.
    await db`DELETE FROM projects WHERE name = ${name}`;
    return true;
  },
};
