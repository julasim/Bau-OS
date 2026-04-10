// ============================================================
// Bau-OS — Datenbank Barrel Export
// ============================================================

// Direkter PostgreSQL Client (fuer Migrations, Queries, Transaktionen)
export { getDb, checkDbHealth, checkPgVector, closeDb } from "./client.js";
export { runMigrations, migrationStatus } from "./migrate.js";

// Supabase JS Client (fuer Realtime, Storage, Auth)
export { getSupabase, getSupabaseAnon, subscribeToTable, checkSupabaseHealth } from "./supabase.js";

// Embeddings & Semantische Suche
export {
  generateEmbedding,
  generateEmbeddings,
  embedNote,
  embedFile,
  embedAllNotes,
  embedAllFiles,
  embeddingStats,
} from "./embeddings.js";
export {
  semanticSearch,
  searchHybrid,
  searchNotesSemantic,
  searchFilesSemantic,
  searchNotesText,
} from "./semantic-search.js";
export type { SemanticResult } from "./semantic-search.js";
