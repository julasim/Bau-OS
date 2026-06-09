-- ============================================================
-- PATIO — Stunden je Leistungsphase
-- ============================================================
-- Migration 035 hat phase_id an tasks + termine gehaengt, aber NICHT an
-- time_entries. Damit liess sich der zentrale Deckungsbeitrag 'Ist-Stunden
-- pro Honorarphase' nicht bilden. Diese Migration schliesst die Luecke.
--
-- ON DELETE SET NULL: das Loeschen einer Phase darf die erfassten Stunden
-- nicht mitreissen (analog tasks/termine in 035).
-- Forward-only, idempotent.
-- ============================================================

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_time_entries_phase ON time_entries(phase_id);
