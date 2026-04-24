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
-- array(SELECT ...) ist der postgres-Idiom fuer "Subselect → Array".
UPDATE termine te
   SET assignee_ids = (
     SELECT COALESCE(array_agg(tm.id) FILTER (WHERE tm.id IS NOT NULL), '{}'::uuid[])
       FROM unnest(te.assignees) AS assignee_name
       LEFT JOIN team_members tm
              ON LOWER(TRIM(tm.name)) = LOWER(TRIM(assignee_name))
   )
 WHERE cardinality(COALESCE(te.assignee_ids, '{}'::uuid[])) = 0
   AND cardinality(COALESCE(te.assignees, '{}'::text[])) > 0;

-- 3) Indizes ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
-- GIN-Index auf dem Array — macht = ANY(assignee_ids) und @> effizient.
CREATE INDEX IF NOT EXISTS idx_termine_assignee_ids ON termine USING GIN (assignee_ids);
