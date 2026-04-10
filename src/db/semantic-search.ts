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
 */
export async function searchNotesSemantic(query: string, limit = 10): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];
  try {
    const queryVec = await generateEmbedding(query);
    const db = getDb();
    const vecSql = `[${queryVec.join(",")}]`;

    const rows = await db`
      SELECT
        n.id, n.title, left(n.content, 200) as snippet,
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
 */
export async function searchFilesSemantic(query: string, limit = 10): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];
  try {
    const queryVec = await generateEmbedding(query);
    const db = getDb();
    const vecSql = `[${queryVec.join(",")}]`;

    const rows = await db`
      SELECT
        f.id, f.filename as title, left(f.content_text, 200) as snippet,
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
 */
export async function searchNotesText(query: string, limit = 10): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];
  try {
    const db = getDb();
    const rows = await db`
      SELECT
        n.id, n.title, left(n.content, 200) as snippet,
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
 */
export async function searchHybrid(query: string, limit = 10): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];

  const k = 60; // RRF-Konstante

  // Parallel: Vektor-Suche + Text-Suche
  const [semanticResults, textResults] = await Promise.all([
    searchNotesSemantic(query, limit * 2),
    searchNotesText(query, limit * 2),
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
  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map((entry) => ({ ...entry.result, score: entry.rrfScore }));
}

/**
 * Universelle Suche: nutzt Hybrid wenn DB aktiv, sonst leeres Array.
 * Consumer sollten bei !DB_ENABLED auf vault searchVault() zurueckfallen.
 */
export async function semanticSearch(
  query: string,
  options: { limit?: number; type?: "note" | "file" | "all" } = {},
): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];

  const limit = options.limit ?? 10;
  const type = options.type ?? "all";

  if (type === "note") return searchHybrid(query, limit);
  if (type === "file") return searchFilesSemantic(query, limit);

  // "all": Notizen (hybrid) + Dateien (semantic) zusammenfuehren
  const [notes, files] = await Promise.all([searchHybrid(query, limit), searchFilesSemantic(query, limit)]);

  return [...notes, ...files].sort((a, b) => b.score - a.score).slice(0, limit);
}
