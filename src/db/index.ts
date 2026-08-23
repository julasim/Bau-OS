// ============================================================
// PATIO — Datenbank Barrel Export
// ============================================================

// Direkter PostgreSQL Client (fuer Migrations, Queries, Transaktionen)
// `getPoolStats` und `withRetry` standen hier ebenfalls im Re-Export. Beide
// werden direkt aus `./client.js` geholt — ueber den Barrel griff niemand
// darauf zu. Ein Re-Export, den keiner benutzt, sieht beim Lesen wie eine
// oeffentliche Schnittstelle aus.
export { getDb, checkDbHealth, closeDb } from "./client.js";
export { runMigrations, migrationStatus } from "./migrate.js";

// Die frueheren Embedding-/pgvector-Exporte sind mit der LLM-Laufzeit
// entfallen; `checkPgVector` ebenso, seit das Schema die Extension nicht mehr
// voraussetzt. Die Volltextsuche liegt in `src/data/db-search.ts` (derzeit
// ILIKE, spaeter tsvector) und wird ueber `src/data/index.ts` eingebunden.
