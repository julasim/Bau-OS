// ============================================================
// Bau-OS — Semantische Suche (pgvector + Hybrid)
// Kombiniert Vektor-Aehnlichkeit mit Textsuche (pg_trgm)
// fuer bestmoegliche Suchergebnisse.
// ============================================================

import { DB_ENABLED } from "../config.js";
import { getDb } from "./client.js";
import { generateEmbedding } from "./embeddings.js";
import { logError } from "../logger.js";

export interface SemanticResult {
  id: string;
  type: "note" | "file";
  title: string;
  snippet: string;
  score: number;
  project?: string | null;
}

// ── Semantische Suche (Vektor) ──────────────────────────────

/**
 * Sucht Notizen per Vektor-Aehnlichkeit (Cosine Distance).
 * Optional auf ein Projekt einschraenken via `project` (Projektname).
 */
export async function searchNotesSemantic(
  query: string,
  limit = 10,
  project?: string | null,
): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];
  try {
    const queryVec = await generateEmbedding(query);
    const db = getDb();
    const vecSql = `[${queryVec.join(",")}]`;

    const rows = project
      ? await db`
          SELECT
            n.id, n.title, left(n.content, 500) as snippet,
            1 - (n.embedding <=> ${vecSql}::vector) as score,
            p.name as project
          FROM notes n
          LEFT JOIN projects p ON n.project_id = p.id
          WHERE n.embedding IS NOT NULL
            AND n.project_id = (SELECT id FROM projects WHERE name = ${project} LIMIT 1)
          ORDER BY n.embedding <=> ${vecSql}::vector
          LIMIT ${limit}
        `
      : await db`
          SELECT
            n.id, n.title, left(n.content, 500) as snippet,
            1 - (n.embedding <=> ${vecSql}::vector) as score,
            p.name as project
          FROM notes n
          LEFT JOIN projects p ON n.project_id = p.id
          WHERE n.embedding IS NOT NULL
          ORDER BY n.embedding <=> ${vecSql}::vector
          LIMIT ${limit}
        `;

    return rows.map((r) => ({
      id: String(r.id),
      type: "note" as const,
      title: String(r.title),
      snippet: String(r.snippet),
      score: Number(r.score),
      project: r.project ? String(r.project) : null,
    }));
  } catch (err) {
    logError("[SemanticSearch] Notes-Suche fehlgeschlagen", err);
    return [];
  }
}

/**
 * Sucht Dateien per Vektor-Aehnlichkeit (Cosine Distance).
 * Optional auf ein Projekt einschraenken via `project` (Projektname).
 */
export async function searchFilesSemantic(
  query: string,
  limit = 10,
  project?: string | null,
): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];
  try {
    const queryVec = await generateEmbedding(query);
    const db = getDb();
    const vecSql = `[${queryVec.join(",")}]`;

    const rows = project
      ? await db`
          SELECT
            f.id, f.filename as title, left(f.content_text, 500) as snippet,
            1 - (f.embedding <=> ${vecSql}::vector) as score,
            p.name as project
          FROM files f
          LEFT JOIN projects p ON f.project_id = p.id
          WHERE f.embedding IS NOT NULL
            AND f.project_id = (SELECT id FROM projects WHERE name = ${project} LIMIT 1)
          ORDER BY f.embedding <=> ${vecSql}::vector
          LIMIT ${limit}
        `
      : await db`
          SELECT
            f.id, f.filename as title, left(f.content_text, 500) as snippet,
            1 - (f.embedding <=> ${vecSql}::vector) as score,
            p.name as project
          FROM files f
          LEFT JOIN projects p ON f.project_id = p.id
          WHERE f.embedding IS NOT NULL
          ORDER BY f.embedding <=> ${vecSql}::vector
          LIMIT ${limit}
        `;

    return rows.map((r) => ({
      id: String(r.id),
      type: "file" as const,
      title: String(r.title),
      snippet: String(r.snippet || ""),
      score: Number(r.score),
      project: r.project ? String(r.project) : null,
    }));
  } catch (err) {
    logError("[SemanticSearch] Files-Suche fehlgeschlagen", err);
    return [];
  }
}

// ── Textsuche (pg_trgm) ────────────────────────────────────

/**
 * Sucht Notizen per Trigram-Textaehnlichkeit.
 * Optional auf ein Projekt einschraenken via `project` (Projektname).
 */
export async function searchNotesText(query: string, limit = 10, project?: string | null): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];
  try {
    const db = getDb();
    const rows = project
      ? await db`
          SELECT
            n.id, n.title, left(n.content, 500) as snippet,
            greatest(
              similarity(n.title, ${query}),
              similarity(left(n.content, 500), ${query})
            ) as score,
            p.name as project
          FROM notes n
          LEFT JOIN projects p ON n.project_id = p.id
          WHERE (n.title % ${query} OR n.content % ${query})
            AND n.project_id = (SELECT id FROM projects WHERE name = ${project} LIMIT 1)
          ORDER BY score DESC
          LIMIT ${limit}
        `
      : await db`
          SELECT
            n.id, n.title, left(n.content, 500) as snippet,
            greatest(
              similarity(n.title, ${query}),
              similarity(left(n.content, 500), ${query})
            ) as score,
            p.name as project
          FROM notes n
          LEFT JOIN projects p ON n.project_id = p.id
          WHERE n.title % ${query} OR n.content % ${query}
          ORDER BY score DESC
          LIMIT ${limit}
        `;

    return rows.map((r) => ({
      id: String(r.id),
      type: "note" as const,
      title: String(r.title),
      snippet: String(r.snippet),
      score: Number(r.score),
      project: r.project ? String(r.project) : null,
    }));
  } catch (err) {
    logError("[SemanticSearch] Text-Suche fehlgeschlagen", err);
    return [];
  }
}

// ── Hybrid-Suche (RRF) ─────────────────────────────────────

/**
 * Kombiniert semantische und Textsuche via Reciprocal Rank Fusion.
 * Gibt die besten Ergebnisse aus beiden Methoden zurueck.
 * Optional auf ein Projekt einschraenken via `project` (Projektname).
 */
export async function searchHybrid(query: string, limit = 10, project?: string | null): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];

  const k = 60; // RRF-Konstante

  // Parallel: Vektor-Suche + Text-Suche
  const [semanticResults, textResults] = await Promise.all([
    searchNotesSemantic(query, limit * 2, project),
    searchNotesText(query, limit * 2, project),
  ]);

  // RRF-Score berechnen
  const scoreMap = new Map<string, { result: SemanticResult; rrfScore: number }>();

  semanticResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    scoreMap.set(r.id, { result: r, rrfScore: rrf });
  });

  textResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    const existing = scoreMap.get(r.id);
    if (existing) {
      existing.rrfScore += rrf;
    } else {
      scoreMap.set(r.id, { result: r, rrfScore: rrf });
    }
  });

  // Sortieren nach RRF-Score, Top-N zurueckgeben
  // RRF-Scores sind tiny (1/(k+rank+1), mit k=60 liegt Rang 0 bei ~0.016).
  // Ein direkter `score * 100` im UI las sich als "1%" und sah fuer das LLM
  // aus, als waeren die Treffer irrelevant — der Agent machte deshalb sofort
  // weitere Suchen (vault_suchen, notizen_auflisten, projekt_info) anstatt
  // die Ergebnisse zu verwenden. Deshalb normalisieren wir auf [0, 1] relativ
  // zum besten Treffer: der Top-Treffer bekommt 1.0, der Rest absteigend.
  // Damit liest sich "Score: 87%" fuer das LLM korrekt als "sehr relevant".
  const sorted = Array.from(scoreMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  const maxRrf = sorted[0]?.rrfScore ?? 1;
  return sorted.slice(0, limit).map((entry) => ({ ...entry.result, score: maxRrf > 0 ? entry.rrfScore / maxRrf : 0 }));
}

/**
 * Universelle Suche: nutzt Hybrid wenn DB aktiv, sonst leeres Array.
 * Consumer sollten bei !DB_ENABLED auf searchWorkspace() zurueckfallen.
 */
export async function semanticSearch(
  query: string,
  options: { limit?: number; type?: "note" | "file" | "all"; project?: string | null } = {},
): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];

  const limit = options.limit ?? 10;
  const type = options.type ?? "all";
  const project = options.project ?? null;

  if (type === "note") return searchHybrid(query, limit, project);
  if (type === "file") return searchFilesSemantic(query, limit, project);

  // "all": Notizen (hybrid) + Dateien (semantic) zusammenfuehren
  const [notes, files] = await Promise.all([
    searchHybrid(query, limit, project),
    searchFilesSemantic(query, limit, project),
  ]);

  return [...notes, ...files].sort((a, b) => b.score - a.score).slice(0, limit);
}
