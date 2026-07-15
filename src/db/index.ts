// ============================================================
// PATIO — Datenbank Barrel Export
// ============================================================

// Direkter PostgreSQL Client (fuer Migrations, Queries, Transaktionen)
export { getDb, checkDbHealth, checkPgVector, getPoolStats, closeDb, withRetry } from "./client.js";
export { runMigrations, migrationStatus } from "./migrate.js";

// Embeddings & Semantische Suche
export {
  generateEmbedding,
  generateEmbeddings,
  embedNote,
  embedFile,
  embedAllNotes,
  embedAllFiles,
  embeddingStats,
  checkEmbeddingHealth,
  checkEmbeddingSchemaDims,
} from "./embeddings.js";
export {
  semanticSearch,
  searchHybrid,
  searchNotesSemantic,
  searchFilesSemantic,
  searchFilesHybrid,
  searchNotesText,
  searchFilesText,
} from "./semantic-search.js";
export type { SemanticResult } from "./semantic-search.js";
