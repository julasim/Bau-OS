// ============================================================
// PATIO — Datenbank Barrel Export
// ============================================================

// Direkter PostgreSQL Client (fuer Migrations, Queries, Transaktionen)
export { getDb, checkDbHealth, getPoolStats, closeDb, withRetry } from "./client.js";
export { runMigrations, migrationStatus } from "./migrate.js";

// Die frueheren Embedding-/pgvector-Exporte sind mit der LLM-Laufzeit
// entfallen; `checkPgVector` ebenso, seit das Schema die Extension nicht mehr
// voraussetzt. Die Volltextsuche liegt in `src/data/db-search.ts` (derzeit
// ILIKE, spaeter tsvector) und wird ueber `src/data/index.ts` eingebunden.
