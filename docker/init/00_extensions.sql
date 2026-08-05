-- ============================================================
-- PATIO — PostgreSQL Extensions (wird bei erstem Start ausgefuehrt)
-- ============================================================
-- Laeuft nur einmal, beim Anlegen eines leeren Datenverzeichnisses
-- (docker-entrypoint-initdb.d). Migration 001 legt dieselben Extensions
-- noch einmal mit IF NOT EXISTS an — dieses Script ist der Guertel zum
-- Hosentraeger, damit die DB auch ohne Migrationslauf brauchbar ist.
--
-- `vector` stand hier bis zum Umbau auf den Firmenserver ebenfalls. Es ist
-- entfernt, weil dort ein gewoehnliches `postgres:16` laeuft (das Image
-- `pgvector/pgvector:pg16` ist im internetlosen Buero nicht zu beschaffen)
-- — und weil PATIO seit AP0 keine Embeddings mehr kennt. Auf einem
-- postgres:16 wuerde die Zeile den gesamten Init-Lauf scheitern lassen.
--
-- Die drei verbliebenen Extensions gehoeren zu postgresql-contrib und sind
-- im offiziellen `postgres:16`-Image enthalten.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- Fuzzy-Textsuche
CREATE EXTENSION IF NOT EXISTS unaccent;     -- Umlaut-neutrale Suche
