-- ============================================================
-- Bau-OS — PostgreSQL Extensions (wird bei erstem Start ausgefuehrt)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- Fuzzy-Textsuche
CREATE EXTENSION IF NOT EXISTS unaccent;     -- Umlaut-neutrale Suche
