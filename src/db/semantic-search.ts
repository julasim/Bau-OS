// ============================================================
// PATIO — Semantische Suche (pgvector + Hybrid)
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

// ── Relevanz-Schwellwerte ──────────────────────────────────

/**
 * Mindest-Kosinus-Aehnlichkeit fuer rein semantische Treffer ohne Keyword-Match.
 * Werte kommen aus dem Embedding-Modell qwen3-embedding (bzw. nomic):
 *   > 0.70  = sehr relevant (fast synonym)
 *   0.50..0.70 = thematisch verwandt
 *   0.35..0.50 = lose Assoziation
 *   < 0.35  = Rauschen — gleiche Domaene, aber inhaltlich nicht verwandt
 * Alles unter 0.35 filtern wir raus, damit nicht jedes beliebige Dokument
 * als "Treffer" angezeigt wird, nur weil es im selben Vault liegt.
 */
const MIN_SEMANTIC_SCORE = 0.35;

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

// ── Textsuche (ILIKE / pg_trgm) ────────────────────────────

/**
 * Sucht Dateien per Keyword-Match (ILIKE auf filename + content_text).
 * Wichtig fuer Queries wie "Altbestand" — wenn das Wort literal in einem
 * PDF/DOCX vorkommt, muss es gefunden werden, egal was der Vektor sagt.
 * Optional auf ein Projekt einschraenken via `project` (Projektname).
 */
export async function searchFilesText(query: string, limit = 10, project?: string | null): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];
  try {
    const db = getDb();
    const pattern = `%${query}%`;

    // Score-Heuristik: Treffer im Dateinamen > Treffer im Inhalt.
    // 1.0 fuer Filename-Match, 0.8 fuer Content-Match.
    const rows = project
      ? await db`
          SELECT
            f.id, f.filename as title,
            left(coalesce(f.content_text, ''), 500) as snippet,
            CASE
              WHEN f.filename ILIKE ${pattern} THEN 1.0
              ELSE 0.8
            END as score,
            p.name as project
          FROM files f
          LEFT JOIN projects p ON f.project_id = p.id
          WHERE (f.filename ILIKE ${pattern} OR f.content_text ILIKE ${pattern})
            AND f.project_id = (SELECT id FROM projects WHERE name = ${project} LIMIT 1)
          ORDER BY score DESC
          LIMIT ${limit}
        `
      : await db`
          SELECT
            f.id, f.filename as title,
            left(coalesce(f.content_text, ''), 500) as snippet,
            CASE
              WHEN f.filename ILIKE ${pattern} THEN 1.0
              ELSE 0.8
            END as score,
            p.name as project
          FROM files f
          LEFT JOIN projects p ON f.project_id = p.id
          WHERE f.filename ILIKE ${pattern} OR f.content_text ILIKE ${pattern}
          ORDER BY score DESC
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
    logError("[SemanticSearch] Files-Text-Suche fehlgeschlagen", err);
    return [];
  }
}

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

  // IDs mit Text-Match (pg_trgm-Hit) — die gelten als relevant, selbst wenn
  // der Vektor-Score mickrig ist.
  const textHitIds = new Set(textResults.map((r) => r.id));

  // RRF-Score berechnen
  const scoreMap = new Map<string, { result: SemanticResult; rrfScore: number; hasKeyword: boolean }>();

  semanticResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    scoreMap.set(r.id, { result: r, rrfScore: rrf, hasKeyword: textHitIds.has(r.id) });
  });

  textResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    const existing = scoreMap.get(r.id);
    if (existing) {
      existing.rrfScore += rrf;
      existing.hasKeyword = true;
    } else {
      scoreMap.set(r.id, { result: r, rrfScore: rrf, hasKeyword: true });
    }
  });

  // Filter: ohne Keyword-Match muss der Roh-Semantic-Score ueber Schwelle liegen.
  // Ohne diesen Filter kippen Queries wie "Altbestand" zehn thematisch grob
  // passende, inhaltlich aber irrelevante Notizen aus (README, Team-Kontakte
  // usw.) — nur weil es die 10 naechsten Vektoren im Raum sind.
  const filtered = Array.from(scoreMap.values()).filter(
    (entry) => entry.hasKeyword || entry.result.score >= MIN_SEMANTIC_SCORE,
  );

  // Sortieren nach RRF-Score, Top-N zurueckgeben.
  // RRF-Scores sind tiny (1/(k+rank+1), mit k=60 liegt Rang 0 bei ~0.016).
  // Ein direkter `score * 100` im UI las sich als "1%" und sah fuer das LLM
  // aus, als waeren die Treffer irrelevant — der Agent machte deshalb sofort
  // weitere Suchen (vault_suchen, notizen_auflisten, projekt_info) anstatt
  // die Ergebnisse zu verwenden. Deshalb normalisieren wir auf [0, 1] relativ
  // zum besten Treffer: der Top-Treffer bekommt 1.0, der Rest absteigend.
  // Damit liest sich "Score: 87%" fuer das LLM korrekt als "sehr relevant".
  const sorted = filtered.sort((a, b) => b.rrfScore - a.rrfScore);
  const maxRrf = sorted[0]?.rrfScore ?? 1;
  return sorted.slice(0, limit).map((entry) => ({ ...entry.result, score: maxRrf > 0 ? entry.rrfScore / maxRrf : 0 }));
}

/**
 * Hybrid-Suche fuer Dateien: kombiniert ILIKE-Keyword-Match mit Vektor-Suche.
 * Wichtig: wenn der Query literal in Filename/Content vorkommt, wird dieser
 * Treffer immer oben gerankt — egal was die Embedding-Similarity sagt.
 */
export async function searchFilesHybrid(query: string, limit = 10, project?: string | null): Promise<SemanticResult[]> {
  if (!DB_ENABLED) return [];

  const k = 60; // RRF-Konstante

  const [semanticResults, textResults] = await Promise.all([
    searchFilesSemantic(query, limit * 2, project),
    searchFilesText(query, limit * 2, project),
  ]);

  // IDs mit Keyword-Match (ILIKE) merken — die duerfen auch mit niedrigem
  // Vektor-Score durchgehen, weil der Keyword-Match beweist, dass sie relevant sind.
  const textHitIds = new Set(textResults.map((r) => r.id));

  const scoreMap = new Map<string, { result: SemanticResult; rrfScore: number; hasKeyword: boolean }>();

  semanticResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    scoreMap.set(r.id, { result: r, rrfScore: rrf, hasKeyword: textHitIds.has(r.id) });
  });

  textResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    const existing = scoreMap.get(r.id);
    if (existing) {
      existing.rrfScore += rrf;
      existing.hasKeyword = true;
    } else {
      scoreMap.set(r.id, { result: r, rrfScore: rrf, hasKeyword: true });
    }
  });

  // Filter: ohne Keyword-Match muss der Roh-Semantic-Score ueber Schwelle liegen.
  const filtered = Array.from(scoreMap.values()).filter(
    (entry) => entry.hasKeyword || entry.result.score >= MIN_SEMANTIC_SCORE,
  );

  const sorted = filtered.sort((a, b) => b.rrfScore - a.rrfScore);
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
  if (type === "file") return searchFilesHybrid(query, limit, project);

  // "all": Notizen (hybrid) + Dateien (hybrid) zusammenfuehren.
  // Beide Hybrid-Varianten filtern bereits Rauschen (MIN_SEMANTIC_SCORE +
  // Keyword-Match-Bonus), sodass hier nur noch relevante Treffer ankommen.
  const [notes, files] = await Promise.all([
    searchHybrid(query, limit, project),
    searchFilesHybrid(query, limit, project),
  ]);

  return [...notes, ...files].sort((a, b) => b.score - a.score).slice(0, limit);
}
