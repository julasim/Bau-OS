-- ============================================================
-- Bau-OS — Aufgaben & Termine: Team-Verknuepfung
-- ============================================================
-- Bisher waren tasks.assignee und termine.assignees reine TEXT-Felder —
-- keine FK, keine zuverlaessige Suche "welche Aufgaben hat Polier X?".
-- Diese Migration:
--   1) tasks.assignee_id UUID → team_members(id) ON DELETE SET NULL.
--   2) termine.assignee_ids UUID[] (Array, konsistent mit bestehendem
--      assignees TEXT[]-Pattern). Kein Junction-Table, weil wir keine
--      per-Teilnehmer-Rolle speichern muessen.
--   3) Best-Effort-Backfill per Name-Match: Legacy-Freitext wird auf
--      bestehende Mitglieder gemappt, wo moeglich. Treffer bleiben doppelt
--      (sowohl assignee_id als auch assignee-Text) — UI bevorzugt ID.
--
-- Legacy-Felder assignee / assignees bleiben bestehen (forward-only):
--   - Fallback wenn assignee_id NULL ist (externe Person ohne Team-Eintrag)
--   - Denormalisierte Anzeige ohne extra JOIN
-- ============================================================

-- 1) tasks.assignee_id -----------------------------------------------------
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES team_members(id) ON DELETE SET NULL;

-- Backfill per Name-Match. LOWER(TRIM()) auf beiden Seiten fuer robuste
-- Matches (Schreibvarianten wie " Max " und "Max" treffen sich).
UPDATE tasks t
   SET assignee_id = tm.id
  FROM team_members tm
 WHERE t.assignee_id IS NULL
   AND t.assignee IS NOT NULL
   AND LOWER(TRIM(t.assignee)) = LOWER(TRIM(tm.name));

-- 2) termine.assignee_ids --------------------------------------------------
ALTER TABLE termine
  ADD COLUMN IF NOT EXISTS assignee_ids UUID[] DEFAULT '{}';

-- Backfill fuer termine ist komplizierter, weil assignees ein TEXT[] ist:
-- wir erzeugen fuer jeden Termin das Array der gematchten Member-IDs.
--
-- WICHTIG: unnest() braucht "AS alias(col_name)", sonst heisst die Spalte
-- in PostgreSQL "unnest" (Funktions-Default), nicht der Table-Alias. Ohne
-- die Spalten-Benennung scheitert die Query mit "column does not exist".
UPDATE termine te
   SET assignee_ids = (
     SELECT COALESCE(array_agg(tm.id) FILTER (WHERE tm.id IS NOT NULL), '{}'::uuid[])
       FROM unnest(te.assignees) AS u(assignee_name)
       LEFT JOIN team_members tm
              ON LOWER(TRIM(tm.name)) = LOWER(TRIM(u.assignee_name))
   )
 WHERE cardinality(COALESCE(te.assignee_ids, '{}'::uuid[])) = 0
   AND cardinality(COALESCE(te.assignees, '{}'::text[])) > 0;

-- 3) Indizes ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
-- GIN-Index auf dem Array — macht = ANY(assignee_ids) und @> effizient.
CREATE INDEX IF NOT EXISTS idx_termine_assignee_ids ON termine USING GIN (assignee_ids);

-- 4) Orphan-Schutz fuer termine.assignee_ids --------------------------------
-- UUID-Arrays unterstuetzen keine FK-Cascade. Wenn ein Team-Mitglied geloescht
-- wird, bleibt seine UUID in termine.assignee_ids-Arrays als Zombie haengen.
-- Reads filtern das im JSON-Subselect weg, aber beim naechsten Termin-Update
-- wuerde der Zombie wieder persistiert. Dieser Trigger raeumt das atomisch
-- beim Delete auf — setzt auch dauerhafte Daten-Konsistenz sicher.
CREATE OR REPLACE FUNCTION remove_member_from_termine() RETURNS trigger AS $$
BEGIN
  UPDATE termine
     SET assignee_ids = array_remove(assignee_ids, OLD.id)
   WHERE OLD.id = ANY(assignee_ids);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clean_termine_assignees ON team_members;
CREATE TRIGGER trg_clean_termine_assignees
  BEFORE DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION remove_member_from_termine();
