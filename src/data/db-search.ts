// ============================================================
// PATIO — Volltextsuche (Datenbank)
// ============================================================
// Ersetzt die beiden frueheren Suchwege, die mit der LLM-Laufzeit entfallen
// sind: das rekursive grep ueber Vault-Markdown (workspace/search.ts) und die
// pgvector-Aehnlichkeitssuche (db/semantic-search.ts).
//
// ZWISCHENSTAND: sucht per ILIKE. Das findet Teilwoerter und ist fuer die
// heutigen Datenmengen schnell genug, kennt aber keine Wortstaemme
// ("Bauherren" findet "Bauherr" nicht) und nutzt keinen Index. Der Ersatz
// durch Postgres-Volltext (tsvector + GIN, Textkonfiguration 'german') ist
// ein eigenes Arbeitspaket — es tauscht nur die WHERE-Klauseln hier aus, die
// Schnittstelle bleibt.
//
// Rechte: Nicht-Admins bekommen `visibleProjectIds` uebergeben und sehen nur
// Treffer aus diesen Projekten. Datensaetze ohne Projektbezug bleiben fuer
// sie unsichtbar — ohne Projekt gibt es keinen Anhaltspunkt fuer die Rechte.
// ============================================================

import { getDb } from "../db/client.js";
import type { VisibleScope } from "./access.js";

export interface SearchHit {
  type: "note" | "task" | "project" | "file";
  id: string;
  title: string;
  /** Kurzer Textausschnitt zum Einordnen des Treffers. */
  snippet: string | null;
  project: string | null;
}

const SNIPPET_MAX = 200;

function snippet(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX) + "…" : s || null;
}

export const dbSearch = {
  /**
   * Sucht ueber Notizen, Aufgaben, Projekte und Dateien.
   *
   * @param visible "all" (Admin) oder die Liste sichtbarer Projekt-IDs.
   * @param project optionaler Projektname als zusaetzlicher Filter.
   */
  async search(query: string, visible: VisibleScope, project?: string | null, limit = 50): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const db = getDb();
    const like = `%${q}%`;
    const all = visible === "all";
    // Leere Sichtbarkeit heisst: kein Projekt zugewiesen → nichts zu finden.
    if (!all && visible.length === 0) return [];
    const ids = all ? [] : visible;
    const perType = Math.max(1, Math.ceil(limit / 4));

    // Projektfilter als Name → ID aufloesen; unbekannter Name ergibt keine
    // Treffer (statt still den Filter zu verwerfen).
    let projectId: string | null = null;
    if (project) {
      const [row] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      if (!row) return [];
      projectId = String(row.id);
      if (!all && !ids.includes(projectId)) return [];
    }

    // Typ-Casts sind Pflicht, nicht Kosmetik: project_id ist UUID, die IDs
    // kommen als JS-Strings herein. Ohne ::uuid[] bzw. ::uuid wirft Postgres
    // `operator does not exist: uuid = text` und die ganze Abfrage stirbt —
    // und zwar nur bei Nicht-Admins mit sichtbaren Projekten, weil der
    // ANY-Zweig sonst gar nicht erst ausgewertet wird.
    const [notes, tasks, projects, files] = await Promise.all([
      db`
        SELECT n.id, n.title, n.content, p.name AS project_name
          FROM notes n LEFT JOIN projects p ON n.project_id = p.id
         WHERE (n.title ILIKE ${like} OR n.content ILIKE ${like})
           AND (${all} OR n.project_id = ANY(${db.array(ids)}::uuid[]))
           AND (${projectId === null} OR n.project_id = ${projectId}::uuid)
         ORDER BY n.updated_at DESC LIMIT ${perType}
      `,
      db`
        SELECT t.id, t.text, p.name AS project_name
          FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
         WHERE t.text ILIKE ${like}
           AND (${all} OR t.project_id = ANY(${db.array(ids)}::uuid[]))
           AND (${projectId === null} OR t.project_id = ${projectId}::uuid)
         ORDER BY t.updated_at DESC LIMIT ${perType}
      `,
      db`
        SELECT id, name, description
          FROM projects
         WHERE (name ILIKE ${like} OR description ILIKE ${like})
           AND (${all} OR id = ANY(${db.array(ids)}::uuid[]))
           AND (${projectId === null} OR id = ${projectId}::uuid)
         ORDER BY updated_at DESC LIMIT ${perType}
      `,
      db`
        SELECT f.id, f.filename, f.content_text, p.name AS project_name
          FROM files f LEFT JOIN projects p ON f.project_id = p.id
         WHERE (f.filename ILIKE ${like} OR f.content_text ILIKE ${like})
           AND (${all} OR f.project_id = ANY(${db.array(ids)}::uuid[]))
           AND (${projectId === null} OR f.project_id = ${projectId}::uuid)
         ORDER BY f.updated_at DESC LIMIT ${perType}
      `,
    ]);

    return [
      ...notes.map((r) => ({
        type: "note" as const,
        id: String(r.id),
        title: String(r.title),
        snippet: snippet(r.content),
        project: r.project_name ? String(r.project_name) : null,
      })),
      ...tasks.map((r) => ({
        type: "task" as const,
        id: String(r.id),
        title: String(r.text),
        snippet: null,
        project: r.project_name ? String(r.project_name) : null,
      })),
      ...projects.map((r) => ({
        type: "project" as const,
        id: String(r.id),
        title: String(r.name),
        snippet: snippet(r.description),
        project: String(r.name),
      })),
      ...files.map((r) => ({
        type: "file" as const,
        id: String(r.id),
        title: String(r.filename),
        snippet: snippet(r.content_text),
        project: r.project_name ? String(r.project_name) : null,
      })),
    ].slice(0, limit);
  },
};
