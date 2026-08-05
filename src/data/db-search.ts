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
// ein eigenes Arbeitspaket — es tauscht nur die WHERE-Klauseln der vier
// UNION-Zweige aus; Reihenfolge, Auszug-Kuerzung und Rechtefilter bleiben.
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

/** Obergrenze und Vorgabe fuer `limit`. Bewusst hier und nicht in der Route:
 *  jeder Aufrufer (kuenftig z.B. MCP) bekommt dieselben Grenzen, ohne sie
 *  selbst kennen zu muessen. */
const SEARCH_LIMIT_MAX = 100;
const SEARCH_LIMIT_DEFAULT = 50;

/** Laenge des ausgelieferten Auszugs. */
const SNIPPET_MAX = 200;

/** So viel Text holt die Query aus der Datenbank (`left(...)`). Bewusst ein
 *  Vielfaches von SNIPPET_MAX: das Zusammenziehen von Whitespace in JS kann
 *  den Text noch deutlich verkuerzen, ein hart auf 200 gekapptes Feld waere
 *  danach zu kurz.
 *
 *  BEKANNTE EINSCHRAENKUNG: der Auszug zeigt dadurch immer den ANFANG des
 *  Dokuments, nicht die Fundstelle. Bei einem 5-MB-OCR-Text steht der
 *  Suchbegriff moeglicherweise auf Seite 40 und taucht im Auszug gar nicht
 *  auf. Das ist bewusst in Kauf genommen — die Alternative waere, den
 *  Volltext zu uebertragen (13 Treffer x 5 MB pro Anfrage, um 99,99 % davon
 *  wegzuwerfen). Ein Auszug an der Fundstelle kommt mit dem tsvector-Umbau
 *  (`ts_headline`), der die Stelle ohnehin kennt. */
const SNIPPET_SOURCE_MAX = SNIPPET_MAX * 3;

/** Notbremse in der Datenbank. Greift, wenn ein Suchbegriff trotz
 *  Laengenbegrenzung teuer wird (grosse `content_text`-Bestaende ohne Index).
 *  Bewusst hier und nicht im Pool: `src/db/client.ts` kennt keine
 *  Timeout-Option, und der Wert soll nur fuer die Suche gelten — nicht fuer
 *  Migrationen oder Exporte. */
const STATEMENT_TIMEOUT_MS = 5000;

function snippet(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX) + "…" : s || null;
}

/** Macht `%`, `_` und `\` zu buchstaeblichen Zeichen.
 *
 *  Ohne das bleiben sie ILIKE-Metazeichen — und Dateinamen wie
 *  `LP3_Einreichung_01` oder `Grundriss_EG` sind in einem Planungsbuero der
 *  Normalfall, nicht der Randfall: `_` matcht sonst jedes beliebige Zeichen
 *  (`Grundriss-EG`, `GrundrissXEG`). `100%` wuerde zur Praefixsuche, `?q=%`
 *  lieferte alles im sichtbaren Bereich, und `C:\Plan` suchte nach `C:Plan`,
 *  weil der Backslash selbst das Escape-Zeichen ist.
 *
 *  Kein Injection-Schutz — die Werte gehen als Bind-Parameter raus. Es geht
 *  ausschliesslich um die Bedeutung der Zeichen INNERHALB des Musters. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Haelt `limit` im erlaubten Bereich und ist die EINZIGE Stelle, an der die
 *  Grenzen festgelegt werden — die Route reicht den Rohwert durch.
 *
 *  Unsinnige Werte (NaN, 0, negativ) fallen auf die Vorgabe zurueck, statt
 *  Treffer zu verschlucken: die frueher nachgelagerte Kuerzung
 *  `.slice(0, limit)` lieferte bei `limit=-1` still einen Treffer weniger und
 *  bei `limit=-10` ein leeres Ergebnis. */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return SEARCH_LIMIT_DEFAULT;
  return Math.min(Math.trunc(limit), SEARCH_LIMIT_MAX);
}

export const dbSearch = {
  /**
   * Sucht ueber Notizen, Aufgaben, Projekte und Dateien.
   *
   * @param visible "all" (Admin) oder die Liste sichtbarer Projekt-IDs.
   * @param project optionaler Projektname als zusaetzlicher Filter.
   * @param limit Obergrenze fuer die Gesamtzahl der Treffer (1…100).
   */
  async search(
    query: string,
    visible: VisibleScope,
    project?: string | null,
    limit = SEARCH_LIMIT_DEFAULT,
  ): Promise<SearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const db = getDb();
    const like = `%${escapeLike(q)}%`;
    const all = visible === "all";
    // Leere Sichtbarkeit heisst: kein Projekt zugewiesen → nichts zu finden.
    if (!all && visible.length === 0) return [];
    const ids = all ? [] : visible;
    const max = clampLimit(limit);

    // Projektfilter als Name → ID aufloesen; unbekannter Name ergibt keine
    // Treffer (statt still den Filter zu verwerfen).
    let projectId: string | null = null;
    if (project) {
      const [row] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      if (!row) return [];
      projectId = String(row.id);
      if (!all && !ids.includes(projectId)) return [];
    }

    // EINE Abfrage statt vier, und `limit` gilt global statt je Typ.
    //
    // Vorher bekam jeder Typ ein festes Viertel des Budgets. Das hatte drei
    // Folgen: eine Kategorie konnte das Budget der anderen nicht nutzen (300
    // Notizen, sonst nichts → 13 statt 50 Treffer), 4 x aufgerundetes Viertel
    // ueberschritt `limit` und die nachgelagerte Kuerzung warf immer die
    // letzten Datei-Treffer weg, und sortiert war blockweise nach Typ — eine
    // zwei Jahre alte Notiz stand vor einer gestern geaenderten Datei.
    //
    // Jetzt: UNION ALL + globales ORDER BY. Dass damit ein sehr aktiver Typ
    // die anderen verdraengen kann, ist gewollt — das ist eine Aussage ueber
    // Aktualitaet, keine ueber den Datentyp. Eine echte Relevanz-Reihenfolge
    // kommt mit tsvector (`ts_rank`); die `id` als zweites Sortierkriterium
    // haelt die Reihenfolge bei gleichem Zeitstempel stabil.
    //
    // Typ-Casts sind Pflicht, nicht Kosmetik: project_id ist UUID, die IDs
    // kommen als JS-Strings herein. Ohne ::uuid[] bzw. ::uuid wirft Postgres
    // `operator does not exist: uuid = text` und die ganze Abfrage stirbt —
    // und zwar nur bei Nicht-Admins mit sichtbaren Projekten, weil der
    // ANY-Zweig sonst gar nicht erst ausgewertet wird.
    //
    // Der `left(...)`-Aufruf kuerzt den Text in der Datenbank. Vorher kam der
    // komplette Inhalt ueber die Verbindung (Volltext-OCR inklusive), nur um
    // in JS auf 200 Zeichen gekuerzt zu werden.
    const rows: Array<Record<string, unknown>> = await db.begin(async (tx) => {
      // Notbremse fuer genau diese Transaktion (set_config(..., true) =
      // LOCAL). `SET LOCAL` selbst nimmt keine Bind-Parameter. Laeuft der
      // Timeout ab, wirft Postgres SQLSTATE 57014 — `app.onError` macht daraus
      // eine verstaendliche Antwort statt eines nackten 500.
      await tx`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
      const hits = await tx`
        WITH treffer AS (
          SELECT 'note'::text AS typ, n.id::text AS id, n.title AS titel,
                 left(n.content, ${SNIPPET_SOURCE_MAX}::int) AS auszug,
                 p.name AS project_name, n.updated_at AS updated_at
            FROM notes n LEFT JOIN projects p ON n.project_id = p.id
           WHERE (n.title ILIKE ${like} OR n.content ILIKE ${like})
             AND (${all} OR n.project_id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR n.project_id = ${projectId}::uuid)
          UNION ALL
          SELECT 'task'::text, t.id::text, t.text,
                 NULL, p.name, t.updated_at
            FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
           WHERE t.text ILIKE ${like}
             AND (${all} OR t.project_id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR t.project_id = ${projectId}::uuid)
          UNION ALL
          SELECT 'project'::text, pr.id::text, pr.name,
                 left(pr.description, ${SNIPPET_SOURCE_MAX}::int), pr.name, pr.updated_at
            FROM projects pr
           WHERE (pr.name ILIKE ${like} OR pr.description ILIKE ${like})
             AND (${all} OR pr.id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR pr.id = ${projectId}::uuid)
          UNION ALL
          SELECT 'file'::text, f.id::text, f.filename,
                 left(f.content_text, ${SNIPPET_SOURCE_MAX}::int), p.name, f.updated_at
            FROM files f LEFT JOIN projects p ON f.project_id = p.id
           WHERE (f.filename ILIKE ${like} OR f.content_text ILIKE ${like})
             AND (${all} OR f.project_id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR f.project_id = ${projectId}::uuid)
        )
        SELECT typ, id, titel, auszug, project_name
          FROM treffer
         ORDER BY updated_at DESC, id
         LIMIT ${max}
      `;
      // Kopie statt RowList: db.begin() spiegelt den Rueckgabetyp seines
      // Callbacks, und ein einfaches Array ist die ehrlichere Zusage.
      return [...hits];
    });

    return rows.map((r) => ({
      // Der Wert stammt aus den vier Literalen der Query selbst, nicht aus
      // Nutzereingaben.
      type: String(r.typ) as SearchHit["type"],
      id: String(r.id),
      title: String(r.titel),
      snippet: snippet(r.auszug),
      project: r.project_name ? String(r.project_name) : null,
    }));
  },
};
