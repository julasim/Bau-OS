// ============================================================
// Bau-OS — Embedding-Service
// Generiert Vektoren via Ollama (nomic-embed-text) und speichert
// sie in pgvector-Spalten fuer semantische Suche.
// ============================================================

import { client } from "../llm/client.js";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_BATCH_SIZE, DB_ENABLED } from "../config.js";
import { getDb } from "./client.js";
import { logInfo, logError } from "../logger.js";

// ── Embedding-Generierung ───────────────────────────────────

/**
 * Generiert einen Embedding-Vektor fuer einen einzelnen Text.
 * Nutzt das Ollama-kompatible OpenAI Embeddings API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Text vorbereiten: trimmen, zu langen Text kuerzen (nomic-embed-text: ~8192 tokens)
  const cleaned = text.trim().slice(0, 16000);
  if (!cleaned) throw new Error("Leerer Text fuer Embedding");

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleaned,
  });

  const vector = response.data[0]?.embedding;
  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unerwartete Embedding-Dimension: ${vector?.length ?? 0}, erwartet ${EMBEDDING_DIMENSIONS}. ` +
        `Stimmt EMBEDDING_MODEL (${EMBEDDING_MODEL}) mit EMBEDDING_DIMENSIONS ueberein? ` +
        `nomic-embed-text=768, text-embedding-3-small=1536.`,
    );
  }
  return vector;
}

/**
 * Generiert Embeddings fuer mehrere Texte in Batches.
 * Respektiert EMBEDDING_BATCH_SIZE fuer parallele Anfragen.
 */
export async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const promises = batch.map(async (text, j) => {
      try {
        results[i + j] = await generateEmbedding(text);
      } catch (err) {
        logError("[Embedding]", err);
        results[i + j] = null;
      }
    });
    await Promise.all(promises);
  }

  return results;
}

// ── Embedding-Speicherung ───────────────────────────────────

/**
 * Speichert einen Embedding-Vektor fuer eine Notiz.
 */
export async function embedNote(noteId: string, content: string): Promise<boolean> {
  if (!DB_ENABLED) return false;
  try {
    const vector = await generateEmbedding(content);
    const db = getDb();
    await db`UPDATE notes SET embedding = ${vectorToSql(vector)}::vector WHERE id = ${noteId}`;
    return true;
  } catch (err) {
    logError("[Embedding] Note fehlgeschlagen", err);
    return false;
  }
}

/**
 * Speichert einen Embedding-Vektor fuer eine Datei.
 */
export async function embedFile(fileId: string, content: string): Promise<boolean> {
  if (!DB_ENABLED) return false;
  try {
    const vector = await generateEmbedding(content);
    const db = getDb();
    await db`UPDATE files SET embedding = ${vectorToSql(vector)}::vector WHERE id = ${fileId}`;
    return true;
  } catch (err) {
    logError("[Embedding] File fehlgeschlagen", err);
    return false;
  }
}

// ── Batch-Embedding ─────────────────────────────────────────

/**
 * Embeddet alle Notizen die noch keinen Vektor haben.
 * Gibt Anzahl der neu generierten Embeddings zurueck.
 */
export async function embedAllNotes(): Promise<number> {
  if (!DB_ENABLED) return 0;
  const db = getDb();
  const rows = await db`
    SELECT id, content FROM notes WHERE embedding IS NULL
    ORDER BY created_at DESC
  `;
  if (rows.length === 0) return 0;

  logInfo(`[Embedding] ${rows.length} Notizen ohne Embedding gefunden`);
  let count = 0;

  for (let i = 0; i < rows.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((r) => String(r.content));
    const embeddings = await generateEmbeddings(texts);

    for (let j = 0; j < batch.length; j++) {
      const vec = embeddings[j];
      if (vec) {
        await db`UPDATE notes SET embedding = ${vectorToSql(vec)}::vector WHERE id = ${batch[j].id}`;
        count++;
      }
    }
    logInfo(`[Embedding] Fortschritt: ${Math.min(i + EMBEDDING_BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  return count;
}

/**
 * Embeddet alle Dateien die noch keinen Vektor haben.
 */
export async function embedAllFiles(): Promise<number> {
  if (!DB_ENABLED) return 0;
  const db = getDb();
  const rows = await db`
    SELECT id, content_text FROM files WHERE embedding IS NULL AND content_text IS NOT NULL
    ORDER BY created_at DESC
  `;
  if (rows.length === 0) return 0;

  logInfo(`[Embedding] ${rows.length} Dateien ohne Embedding gefunden`);
  let count = 0;

  for (let i = 0; i < rows.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((r) => String(r.content_text));
    const embeddings = await generateEmbeddings(texts);

    for (let j = 0; j < batch.length; j++) {
      const vec = embeddings[j];
      if (vec) {
        await db`UPDATE files SET embedding = ${vectorToSql(vec)}::vector WHERE id = ${batch[j].id}`;
        count++;
      }
    }
    logInfo(`[Embedding] Fortschritt: ${Math.min(i + EMBEDDING_BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  return count;
}

// ── Health-Checks ───────────────────────────────────────────

/**
 * Prueft, ob der Embedding-Provider (Ollama / OpenAI) erreichbar ist.
 * Versucht, einen Dummy-Text zu embedden — wenn das klappt, liefert der
 * Provider-Endpunkt und die konfigurierte Dimension stimmt.
 */
export async function checkEmbeddingHealth(): Promise<{
  ok: boolean;
  model: string;
  dimensions: number;
  error?: string;
}> {
  try {
    const vec = await generateEmbedding("bau-os-healthcheck");
    return {
      ok: true,
      model: EMBEDDING_MODEL,
      dimensions: vec.length,
    };
  } catch (err) {
    return {
      ok: false,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Vergleicht die in der DB konfigurierte Vektor-Dimension (files.embedding,
 * notes.embedding) mit EMBEDDING_DIMENSIONS aus der Env. Bei Provider-Wechsel
 * (nomic-embed-text 768 → text-embedding-3-small 1536) muss das Schema per
 * Migration angepasst werden, sonst schlagen alle embedNote/embedFile-Calls
 * mit "vector dimension mismatch" fehl.
 */
export async function checkEmbeddingSchemaDims(): Promise<{
  ok: boolean;
  configured: number;
  schema: { notes: number | null; files: number | null };
  error?: string;
}> {
  if (!DB_ENABLED) {
    return { ok: false, configured: EMBEDDING_DIMENSIONS, schema: { notes: null, files: null } };
  }
  try {
    const db = getDb();
    // format_type liefert bei pgvector 'vector(768)' o. ae. — Zahl extrahieren
    const rows = await db`
      SELECT
        (SELECT format_type(atttypid, atttypmod)
           FROM pg_attribute
          WHERE attrelid = 'notes'::regclass AND attname = 'embedding') AS notes_t,
        (SELECT format_type(atttypid, atttypmod)
           FROM pg_attribute
          WHERE attrelid = 'files'::regclass AND attname = 'embedding') AS files_t
    `;
    const row = rows[0] ?? {};
    const parseDim = (t: string | null | undefined): number | null => {
      if (!t) return null;
      const m = /vector\((\d+)\)/i.exec(t);
      return m ? Number(m[1]) : null;
    };
    const notesDim = parseDim(row.notes_t as string | null);
    const filesDim = parseDim(row.files_t as string | null);
    const ok =
      (notesDim === null || notesDim === EMBEDDING_DIMENSIONS) &&
      (filesDim === null || filesDim === EMBEDDING_DIMENSIONS);
    return {
      ok,
      configured: EMBEDDING_DIMENSIONS,
      schema: { notes: notesDim, files: filesDim },
    };
  } catch (err) {
    return {
      ok: false,
      configured: EMBEDDING_DIMENSIONS,
      schema: { notes: null, files: null },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Embedding-Statistik ─────────────────────────────────────

export async function embeddingStats(): Promise<{
  notes: { total: number; embedded: number };
  files: { total: number; embedded: number };
}> {
  if (!DB_ENABLED) return { notes: { total: 0, embedded: 0 }, files: { total: 0, embedded: 0 } };
  const db = getDb();
  const [noteStats] = await db`
    SELECT count(*) as total, count(embedding) as embedded FROM notes
  `;
  const [fileStats] = await db`
    SELECT count(*) as total, count(embedding) as embedded FROM files
  `;
  return {
    notes: { total: Number(noteStats.total), embedded: Number(noteStats.embedded) },
    files: { total: Number(fileStats.total), embedded: Number(fileStats.embedded) },
  };
}

// ── Hilfsfunktionen ─────────────────────────────────────────

/**
 * Konvertiert number[] in pgvector SQL-String '[0.1,0.2,...]'
 */
function vectorToSql(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
