-- ============================================================
-- PATIO — Custom Template Variables + Custom Project Modules
-- ============================================================

-- Eigene Platzhalter für Vorlagen ({{MeineFeld}})
CREATE TABLE IF NOT EXISTS custom_template_variables (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,           -- Platzhalter-Key z.B. "Bauleiter"
  description TEXT,                    -- Beschreibung für die UI
  value       TEXT NOT NULL DEFAULT '', -- Fester Wert (statisch) ODER leer wenn dynamisch
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name)
);

CREATE OR REPLACE FUNCTION trg_custom_template_variables_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS custom_template_variables_updated_at ON custom_template_variables;
CREATE TRIGGER custom_template_variables_updated_at
  BEFORE UPDATE ON custom_template_variables
  FOR EACH ROW EXECUTE FUNCTION trg_custom_template_variables_updated_at();

-- Eigene Projekt-Module (nutzerdefinierte Kategorien)
CREATE TABLE IF NOT EXISTS custom_project_modules (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key         TEXT NOT NULL UNIQUE,    -- Interner Schlüssel z.B. "gewährleistung"
  label       TEXT NOT NULL,           -- Anzeigename z.B. "Gewährleistung"
  description TEXT,                    -- Beschreibung / Hilfetext
  icon        TEXT DEFAULT 'folder',   -- Lucide-Icon-Name
  enabled_by_default BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE custom_template_variables IS 'Nutzerdefinierte Platzhalter für Vorlagen (ergänzen built-in vars).';
COMMENT ON TABLE custom_project_modules IS 'Nutzerdefinierte Projekt-Modul-Kategorien (ergänzen die 9 built-in Module).';
