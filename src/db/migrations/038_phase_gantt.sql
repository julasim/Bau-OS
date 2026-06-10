-- ============================================================
-- PATIO — Gantt-Grundlage: Phasen-Abhaengigkeiten + Auto-Meilenstein
-- ============================================================
-- (1) depends_on_phase_id: optionaler Vorgaenger einer Phase (lineare
--     LPH-Ketten / kritischer Pfad). Self-FK, ON DELETE SET NULL — das
--     Loeschen des Vorgaengers loest nur die Verknuepfung.
-- (2) milestone_termin_id: Verknuepfung zum automatisch gepflegten
--     Meilenstein-Termin. Ein gesetztes soll_ende erzeugt/aktualisiert
--     einen is_milestone-Termin; das Feld haelt dessen ID, damit der Sync
--     idempotent ist (kein Raten ueber Konventionen). ON DELETE SET NULL,
--     damit ein manuell geloeschter Termin die Phase nicht zerstoert.
-- Forward-only, idempotent.
-- ============================================================

ALTER TABLE project_phases
  ADD COLUMN IF NOT EXISTS depends_on_phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL;

ALTER TABLE project_phases
  ADD COLUMN IF NOT EXISTS milestone_termin_id UUID REFERENCES termine(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_phases_depends ON project_phases(depends_on_phase_id);
