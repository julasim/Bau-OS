// ============================================================
// PATIO — Volltextsuche (Datenbank)
// ============================================================
// Ersetzt die beiden frueheren Suchwege, die mit der LLM-Laufzeit entfallen
// sind: das rekursive grep ueber Vault-Markdown (workspace/search.ts) und die
// pgvector-Aehnlichkeitssuche (db/semantic-search.ts).
//
// Zwei Wege, bewusst kombiniert (Migration 048):
//
//   1. **Volltext** ueber `tsvector` mit deutscher Textkonfiguration, GIN-
//      indiziert. Kennt Wortstaemme („Einreichung" findet „Einreichungen")
//      und liefert mit `ts_rank` eine echte Relevanz statt einer Sortierung
//      nach Datum.
//   2. **Teilwort** per ILIKE, aber nur noch auf den KURZEN Feldern: Titel,
//      Aufgabentext, Projektname, Dateiname. Dort ist es richtig — wer
//      „2026-01" tippt, meint einen Nummernanfang, keinen Wortstamm. Diese
//      Felder sind ueber `pg_trgm` indiziert.
//
// Der Volltext allein waere ein Rueckschritt gewesen: er findet keine
// Wortmitte, und „schmid" faende „Schmidbauer" nicht mehr — im Buero der
// haeufigste Griff. Das ILIKE allein kannte keine Stammformen. Beides
// zusammen deckt beide Erwartungen ab.
//
// Die Reihenfolge ist jetzt: Relevanz zuerst, bei Gleichstand das juengere
// Datum. Ein Titeltreffer zaehlt dabei mehr als eine Fundstelle im Text —
// wer „Bauverhandlung" sucht, meint eher das gleichnamige Protokoll als die
// Notiz, in der das Wort einmal vorkommt.
//
// Rechte: Nicht-Admins bekommen `visibleProjectIds` uebergeben und sehen nur
// Treffer aus diesen Projekten. Datensaetze ohne Projektbezug bleiben fuer
// sie unsichtbar — ohne Projekt gibt es keinen Anhaltspunkt fuer die Rechte.
// ============================================================

import { getDb } from "../db/client.js";
import type { VisibleScope } from "./access.js";
import { escapeLike } from "./sql-like.js";

/** Gewicht eines Titeltreffers gegenueber `ts_rank`.
 *
 *  `ts_rank` liefert Werte weit unter 1 (bei einem Treffer typisch 0,06).
 *  Der Zuschlag muss deutlich darueber liegen, damit ein Titeltreffer sicher
 *  vor einer beilaeufigen Fundstelle im Text landet — aber nicht so hoch,
 *  dass mehrere Volltexttreffer gar nicht mehr ins Gewicht fallen. */
const TITEL_BONUS = 1;

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

// ── Warum Projekte zusaetzlich per ILIKE auf der Nummer gesucht werden ──────
//
// (Steht HIER und nicht im SQL: Backticks in einem Template-Literal beenden
// die Zeichenkette. Genau dieser Kommentar hat die Datei beim Schreiben schon
// einmal zerlegt.)
//
// Die Volltextsuche kennt die Projektnummer laengst — `such_text` ist eine
// GENERATED-Spalte und enthaelt sie seit Migration 048. Sie zerlegt die
// Nummer aber in ganze Woerter. Gemessen an
// `to_tsvector('german', 'SAZTG-2026-014')`:
//
//     'saztg':1  '-2026':2  '-014':3
//
// Damit findet man `SAZTG-2026-014`, `SAZTG` und `SAZTG-2026` — aber NICHT
// `2026-014`. Und genau so tippt jemand, der das Buerokuerzel weglaesst, weil
// es bei jedem Projekt des Hauses gleich ist.
//
// Fuer solche Teilstuecke ist ILIKE zustaendig; Migration 052 legt dafuer den
// Trigramm-Index `idx_projects_projektnummer_trgm` an. Ohne diese Zeile im
// WHERE waere er totes Gewicht.
//
// Ein Treffer auf der Nummer zaehlt wie ein Treffer im Namen (TITEL_BONUS):
// wer eine Aktennummer eintippt, sucht dieses eine Projekt und nichts sonst.
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
        WITH frage AS (
          -- websearch_to_tsquery statt plainto_: es versteht Anfuehrungs-
          -- zeichen fuer Wortgruppen und ein vorangestelltes Minus als
          -- Ausschluss — das erwarten Leute von einem Suchfeld. Und es wirft
          -- bei kaputter Eingabe keinen Fehler, sondern liefert eine leere
          -- Frage.
          SELECT websearch_to_tsquery('german', ${q}) AS tsq
        ),
        treffer AS (
          SELECT 'note'::text AS typ, n.id::text AS id, n.title AS titel,
                 left(n.content, ${SNIPPET_SOURCE_MAX}::int) AS auszug,
                 p.name AS project_name, n.updated_at AS updated_at,
                 ts_rank(n.such_text, frage.tsq) +
                   CASE WHEN n.title ILIKE ${like} THEN ${TITEL_BONUS}::real ELSE 0 END AS rang
            FROM notes n LEFT JOIN projects p ON n.project_id = p.id, frage
           WHERE (n.such_text @@ frage.tsq OR n.title ILIKE ${like})
             AND (${all} OR n.project_id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR n.project_id = ${projectId}::uuid)
          UNION ALL
          SELECT 'task'::text, t.id::text, t.text,
                 NULL, p.name, t.updated_at,
                 ts_rank(t.such_text, frage.tsq) +
                   CASE WHEN t.text ILIKE ${like} THEN ${TITEL_BONUS}::real ELSE 0 END
            FROM tasks t LEFT JOIN projects p ON t.project_id = p.id, frage
           WHERE (t.such_text @@ frage.tsq OR t.text ILIKE ${like})
             AND (${all} OR t.project_id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR t.project_id = ${projectId}::uuid)
          UNION ALL
          SELECT 'project'::text, pr.id::text, pr.name,
                 left(pr.description, ${SNIPPET_SOURCE_MAX}::int), pr.name, pr.updated_at,
                 ts_rank(pr.such_text, frage.tsq) +
                   CASE WHEN pr.name ILIKE ${like} OR pr.projektnummer ILIKE ${like}
                        THEN ${TITEL_BONUS}::real ELSE 0 END
            FROM projects pr, frage
           -- ILIKE auch auf der Projektnummer -- Begruendung ueber der Funktion.
           WHERE (pr.such_text @@ frage.tsq OR pr.name ILIKE ${like} OR pr.projektnummer ILIKE ${like})
             AND pr.deleted_at IS NULL
             AND (${all} OR pr.id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR pr.id = ${projectId}::uuid)
          UNION ALL
          SELECT 'file'::text, f.id::text, f.filename,
                 left(f.content_text, ${SNIPPET_SOURCE_MAX}::int), p.name, f.updated_at,
                 ts_rank(f.such_text, frage.tsq) +
                   CASE WHEN f.filename ILIKE ${like} THEN ${TITEL_BONUS}::real ELSE 0 END
            FROM files f LEFT JOIN projects p ON f.project_id = p.id, frage
           WHERE (f.such_text @@ frage.tsq OR f.filename ILIKE ${like})
             AND (${all} OR f.project_id = ANY(${db.array(ids)}::uuid[]))
             AND (${projectId === null} OR f.project_id = ${projectId}::uuid)
        )
        SELECT typ, id, titel, auszug, project_name
          FROM treffer
         ORDER BY rang DESC, updated_at DESC, id
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
