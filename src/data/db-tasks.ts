// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { Task, TaskRepository } from "./types.js";

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    rev: Number(row.rev ?? 1),
    text: String(row.text),
    status: row.status as Task["status"],
    priority: row.priority ? String(row.priority) : undefined,
    assignee: row.assignee ? String(row.assignee) : null,
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    assigneeName: row.assignee_name ? String(row.assignee_name) : null,
    date: row.date ? String(row.date) : null,
    dueDate: row.due_date ? String(row.due_date) : null,
    location: row.location ? String(row.location) : null,
    project: row.project_name ? String(row.project_name) : null,
    sortOrder: row.sort_order ? Number(row.sort_order) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    phaseId: row.phase_id ? String(row.phase_id) : null,
    // Aufgabensystem (Migration 050). `rang` ist NOT NULL DEFAULT 3, der
    // Rueckfall deckt nur den Fall ab, dass eine Abfrage die Spalte nicht
    // mitliest — dann lieber der Standard als `undefined` in der Oberflaeche.
    rang: (Number(row.rang ?? 3) as Task["rang"]) ?? 3,
    aufwandMin: row.aufwand_min === null || row.aufwand_min === undefined ? null : Number(row.aufwand_min),
    imTagesplan: row.im_tagesplan === true,
    tagesplanVon: row.tagesplan_von ? String(row.tagesplan_von) : null,
    createdById: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Gemeinsame SELECT-Klausel — LEFT JOIN auf team_members, damit assignee_name
// immer mitgeliefert wird ohne N+1.
const TASK_SELECT = `
  SELECT t.*,
    p.name as project_name,
    tm.name as assignee_name
  -- Der Papierkorb (Migration 049) wird HIER ausgefiltert, in der gemeinsamen
  -- Abfrage, und nicht an den sieben Aufrufstellen. Eine neue Abfrage, die
  -- diese Konstante benutzt, ist damit von sich aus richtig; eine, die den
  -- Filter selbst mitbringen muesste, waere die naechste vergessene Stelle.
  FROM (SELECT * FROM tasks WHERE deleted_at IS NULL) t
  LEFT JOIN projects p ON t.project_id = p.id
  LEFT JOIN team_members tm ON tm.id = t.assignee_id
`;

export const dbTasks: TaskRepository = {
  async save(text, project, createdById) {
    const db = getDb();
    // Volle UUID — die tasks.id-Spalte ist UUID-typisiert, ein .slice(0,8)
    // wuerde PostgresError "invalid input syntax for type uuid" werfen.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Projekt-ID nachschlagen wenn Name gegeben
    let projectId: string | null = null;
    if (project) {
      const [p] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      projectId = p?.id ?? null;
    }

    await db`
      INSERT INTO tasks (id, text, status, project_id, created_by, created_at, updated_at)
      VALUES (${id}, ${text}, 'offen', ${projectId}, ${createdById ?? null}, ${now}, ${now})
    `;
    const task = await this.get(id);
    if (!task) throw new Error("Task nach INSERT nicht lesbar");
    return task;
  },

  async list(project) {
    const db = getDb();
    if (project) {
      const rows = await db.unsafe(`${TASK_SELECT} WHERE p.name = $1 ORDER BY t.sort_order, t.created_at DESC`, [
        project,
      ]);
      return rows.map((r) => rowToTask(r as Record<string, unknown>));
    }
    const rows = await db.unsafe(`${TASK_SELECT} ORDER BY t.sort_order, t.created_at DESC`);
    return rows.map((r) => rowToTask(r as Record<string, unknown>));
  },

  async listOpen(project) {
    const all = await this.list(project);
    return all.filter((t) => t.status !== "done");
  },

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${TASK_SELECT} WHERE t.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToTask(rows[0] as Record<string, unknown>) : null;
  },

  async update(id, updates) {
    const db = getDb();
    const now = new Date().toISOString();

    // Aktuelle Werte holen um undefined vs null unterscheiden zu koennen
    const [current] = await db`SELECT * FROM tasks WHERE id = ${id}`;
    if (!current) return null;

    // Konfliktschutz (Migration 042): schickt der Aufrufer einen Zaehler mit,
    // muss er noch stimmen — sonst hat in der Zwischenzeit jemand anderes
    // gespeichert. Ohne Zaehler gilt weiterhin „zuletzt gewinnt".
    pruefeRev(rowToTask(current), current.rev, updates.rev);

    const text = "text" in updates ? updates.text : current.text;
    const status = "status" in updates ? updates.status : current.status;
    const assignee = "assignee" in updates ? updates.assignee : current.assignee;
    const date = "date" in updates ? updates.date : current.date;
    const location = "location" in updates ? updates.location : current.location;
    const priority = "priority" in updates ? updates.priority : current.priority;
    // Migration 035: Verknuepfung mit einer Leistungsphase.
    const phaseId = "phaseId" in updates ? (updates.phaseId ?? null) : current.phase_id;
    // Aufgabensystem (Migration 050). Bewusst mit `in`-Pruefung wie alles
    // andere hier: nur was der Aufrufer mitschickt, wird geaendert. Sonst
    // setzte ein Teil-Update den Rang jedes Mal auf den Standard zurueck.
    const rang = "rang" in updates ? (updates.rang ?? 3) : current.rang;
    const aufwandMin = "aufwandMin" in updates ? (updates.aufwandMin ?? null) : current.aufwand_min;
    // assigneeId kommt als FK dazu. Wenn gesetzt, denormalisieren wir auch
    // den assignee-Text auf den Mitglieder-Namen — das haelt Legacy-Reader
    // konsistent und vermeidet den "Freitext widerspricht FK"-Fall.
    const assigneeId = "assigneeId" in updates ? updates.assigneeId : current.assignee_id;
    let finalAssignee = assignee;
    if ("assigneeId" in updates) {
      if (assigneeId) {
        const [tm] = await db`SELECT name FROM team_members WHERE id = ${assigneeId}`;
        if (tm) finalAssignee = String(tm.name);
      }
      // Wenn assigneeId explizit null, bleibt assignee bei dem was der Caller
      // gesetzt hat (oder current) — erlaubt "Freitext ohne FK" als Zustand.
    }

    // `AND rev = …` macht Lesen-Aendern-Schreiben atomar: schreibt jemand
    // zwischen SELECT und UPDATE, trifft die Anweisung keine Zeile mehr.
    // Das greift auch ohne mitgeschickten Zaehler — nur ist das Zeitfenster
    // dann winzig.
    const geschrieben = await db`
      UPDATE tasks SET
        text = ${text}, status = ${status},
        assignee = ${finalAssignee},
        assignee_id = ${assigneeId ?? null},
        date = ${date}, location = ${location}, priority = ${priority},
        phase_id = ${phaseId ?? null},
        rang = ${rang},
        aufwand_min = ${aufwandMin},
        rev = rev + 1,
        updated_at = ${now}
      WHERE id = ${id} AND rev = ${current.rev}
      RETURNING id
    `;
    if (geschrieben.length === 0) {
      const [jetzt] = await db`SELECT * FROM tasks WHERE id = ${id}`;
      if (!jetzt) return null; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(rowToTask(jetzt), Number(current.rev), Number(jetzt.rev));
    }
    return this.get(id);
  },

  async complete(textOrId) {
    const db = getDb();
    const now = new Date().toISOString();
    // id::text verhindert "invalid input syntax for type uuid" wenn ein
    // Text-Match statt einer UUID uebergeben wird — sonst crasht die gesamte
    // Query, bevor die OR-Klausel auf text = ... ueberhaupt ausgewertet wird.
    const result = await db`
      UPDATE tasks SET status = 'done', completed_at = ${now}, updated_at = ${now}
      WHERE id::text = ${textOrId} OR text = ${textOrId}
    `;
    return result.count > 0;
  },

  /** Legt die Aufgabe in den Papierkorb (Migration 049) — sie verschwindet aus
   *  allen Listen, bleibt aber liegen. Endgueltig entfernt wird sie erst mit
   *  `purge()`. */
  async delete(id) {
    const db = getDb();
    const result = await db`UPDATE tasks SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`;
    return result.count > 0;
  },

  async listDeleted(sichtbareProjekte) {
    const db = getDb();
    const eingeschraenkt = Array.isArray(sichtbareProjekte);
    if (eingeschraenkt && sichtbareProjekte.length === 0) return [];
    const rows = eingeschraenkt
      ? await db`
          SELECT t.id, t.text AS titel, p.name AS project_name, t.deleted_at, t.created_by
            FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
           WHERE t.deleted_at IS NOT NULL
             AND (t.project_id = ANY(${db.array(sichtbareProjekte)}::uuid[])
                  -- Datensaetze OHNE Projekt sind persoenlich. Sie muessen hier
                  -- durch, damit die Route sie ihrem Verfasser zeigen kann; wem
                  -- sie NICHT gehoeren, den filtert die Route heraus.
                  OR t.project_id IS NULL)
           ORDER BY t.deleted_at DESC`
      : await db`
          SELECT t.id, t.text AS titel, p.name AS project_name, t.deleted_at, t.created_by
            FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
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
    const r = await db`UPDATE tasks SET deleted_at = NULL WHERE id = ${id} AND deleted_at IS NOT NULL`;
    return r.count > 0;
  },

  /** Endgueltig entfernen — nur aus dem Papierkorb heraus. Endgueltiges
   *  Loeschen soll nie ein Einzelschritt sein. */
  async purge(id) {
    const db = getDb();
    const r = await db`DELETE FROM tasks WHERE id = ${id} AND deleted_at IS NOT NULL`;
    return r.count > 0;
  },
};
