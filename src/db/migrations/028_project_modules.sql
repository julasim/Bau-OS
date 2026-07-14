-- ============================================================
-- PATIO — Projekt-Module-Konfiguration (Phase 6e)
-- ============================================================
-- Globale Default-Auswahl welche Module/Tabs in Projekten zur
-- Verfuegung stehen (Stammdaten, Notizen, Aufgaben, Termine, Files,
-- Team, Bautagebuch, Meetings, Stunden). Pro Projekt kann ueber
-- projects.modules_override (JSONB) ein Override gesetzt werden —
-- Default ist NULL (= globale Settings gelten).
--
-- Verwendung im Frontend (ProjectDetailView):
--   1. GET /api/project-modules → globale Defaults
--   2. GET /api/projects/:name/modules → effektive Auswahl fuer
--      dieses Projekt (Default + Override gemerged)
--   3. UI versteckt Tabs deren Modul auf false ist.
-- ============================================================

CREATE TABLE IF NOT EXISTS project_module_config (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modules     JSONB NOT NULL DEFAULT '{
    "stammdaten":     true,
    "notes":          true,
    "tasks":          true,
    "termine":        true,
    "files":          true,
    "team":           true,
    "bautagebuch":    true,
    "meetings":       true,
    "time_entries":   true
  }'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO project_module_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION trg_project_module_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_module_config_updated_at ON project_module_config;
CREATE TRIGGER project_module_config_updated_at
  BEFORE UPDATE ON project_module_config
  FOR EACH ROW EXECUTE FUNCTION trg_project_module_config_updated_at();

-- Per-Projekt-Override (NULL = globale Settings gelten).
-- JSONB-Format identisch zu project_module_config.modules.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS modules_override JSONB;

COMMENT ON TABLE project_module_config IS 'Singleton: globale Defaults welche Projekt-Module aktiv sind. Pro-Projekt-Override ueber projects.modules_override.';
COMMENT ON COLUMN projects.modules_override IS 'JSONB-Override fuer einzelnes Projekt. NULL = globale Defaults gelten. Sonst: Merge-Sicht (override-Werte gewinnen, fehlende Keys aus Default).';
