// ============================================================
// PATIO — Datenbank Barrel Export
// ============================================================

// Direkter PostgreSQL Client (fuer Migrations, Queries, Transaktionen)
// `getPoolStats` stand hier ebenfalls im Re-Export; es wird direkt aus
// `./client.js` geholt (src/api/routes/dashboard.ts) — ueber den Barrel griff
// niemand darauf zu. Ein Re-Export, den keiner benutzt, sieht beim Lesen wie
// eine oeffentliche Schnittstelle aus. `withRetry` ist mit demselben Befund
// ganz entfallen: die Funktion hatte im ganzen Baum keinen Aufrufer.
export { getDb, checkDbHealth, closeDb } from "./client.js";
export { runMigrations, migrationStatus } from "./migrate.js";

// Die frueheren Embedding-/pgvector-Exporte sind mit der LLM-Laufzeit
// entfallen; `checkPgVector` ebenso, seit das Schema die Extension nicht mehr
// voraussetzt. Die Volltextsuche liegt in `src/data/db-search.ts` — seit
// Migration 048 ueber `tsvector` mit deutscher Textkonfiguration, ILIKE nur
// noch fuer Wortteile in kurzen Feldern — und wird ueber `src/data/index.ts`
// eingebunden.
