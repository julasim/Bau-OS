-- ============================================================
-- Bau-OS — Strukturierte Projekt-Stammdaten
-- ============================================================
-- Vorher lagen die Stammdaten als Textblock in projects.description
-- ("Projektnummer: 2026-037\nBauherr: ...\n..."), was weder filterbar
-- noch gezielt editierbar war. Diese Migration:
--   1) fuegt 8 strukturierte Spalten hinzu
--   2) legt Indizes fuer haeufige Filter an
--   3) backfillt die neuen Spalten aus description (description bleibt
--      als Backup erhalten, wird nicht angefasst)
-- Idempotent: kann mehrfach laufen ohne Datenverlust (IF NOT EXISTS +
-- COALESCE-Schutz beim Backfill).
-- ============================================================

-- 1) Spalten ergaenzen ---------------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS projektnummer TEXT,
  ADD COLUMN IF NOT EXISTS bauherr       TEXT,
  ADD COLUMN IF NOT EXISTS standort      TEXT,
  ADD COLUMN IF NOT EXISTS projektart    TEXT,
  ADD COLUMN IF NOT EXISTS nutzung       TEXT,
  ADD COLUMN IF NOT EXISTS phase         TEXT,
  ADD COLUMN IF NOT EXISTS start_date    DATE,
  ADD COLUMN IF NOT EXISTS end_date      DATE;

-- 2) Indizes fuer haeufige Filter ---------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_projektnummer ON projects(projektnummer);
CREATE INDEX IF NOT EXISTS idx_projects_projektart    ON projects(projektart);
CREATE INDEX IF NOT EXISTS idx_projects_phase         ON projects(phase);

-- 3) Backfill aus description --------------------------------------------------
-- Das bisherige projekt_anlegen-Tool hat Stammdaten im Format
--   "Projektnummer: 2026-037
--    Bauherr: Hans Müller — hans@example.at
--    Standort: Wien 9
--    Projektart: Neubau
--    Nutzung: Wohnbau"
-- in description abgelegt. Wir extrahieren zeilenweise per Regex.
-- Wichtig: COALESCE sorgt dafuer, dass bereits gefuellte Spalten nicht
-- ueberschrieben werden — so bleibt die Migration idempotent.
UPDATE projects SET
  projektnummer = COALESCE(
    projektnummer,
    NULLIF(TRIM((regexp_match(description, '(?im)^Projektnummer:\s*(.+)$'))[1]), '')
  ),
  bauherr = COALESCE(
    bauherr,
    NULLIF(TRIM((regexp_match(description, '(?im)^Bauherr:\s*(.+)$'))[1]), '')
  ),
  standort = COALESCE(
    standort,
    NULLIF(TRIM((regexp_match(description, '(?im)^Standort:\s*(.+)$'))[1]), '')
  ),
  projektart = COALESCE(
    projektart,
    NULLIF(TRIM((regexp_match(description, '(?im)^Projektart:\s*(.+)$'))[1]), '')
  ),
  nutzung = COALESCE(
    nutzung,
    NULLIF(TRIM((regexp_match(description, '(?im)^Nutzung:\s*(.+)$'))[1]), '')
  )
WHERE description IS NOT NULL
  AND description ~* '^(Projektnummer|Bauherr|Standort|Projektart|Nutzung):';
