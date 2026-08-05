// ============================================================
// PATIO — Datenbank Barrel Export
// ============================================================

// Direkter PostgreSQL Client (fuer Migrations, Queries, Transaktionen)
export { getDb, checkDbHealth, checkPgVector, getPoolStats, closeDb, withRetry } from "./client.js";
export { runMigrations, migrationStatus } from "./migrate.js";

// Volltextsuche: die frueheren Embedding-/pgvector-Exporte sind mit der
// LLM-Laufzeit entfallen. Der Ersatz auf Postgres-Volltext (tsvector) kommt
// als eigenes Arbeitspaket — bis dahin hat die Suche keinen Unterbau.
