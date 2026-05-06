-- ============================================================
-- Bau-OS — Word-Export-Templates (Phase 6d)
-- ============================================================
-- Word-Dokumente (.docx) als Layout-Templates fuer Exports.
-- Beim Export eines Meetings/Bautagebuch-Eintrags/Stundenzettels
-- wird das default-Template fuer die jeweilige Kategorie geladen,
-- mit Daten aus DB befuellt (docxtemplater) und als .docx-Stream
-- ausgeliefert.
--
-- Tag-Syntax in den Word-Files: {Variable} statt {{Variable}}
-- (docxtemplater-Default). Branding-Logo kann ueber {%logo}
-- als Bild eingebettet werden — siehe docxtemplater-image-module.
-- ============================================================

CREATE TABLE IF NOT EXISTS export_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind            TEXT NOT NULL CHECK (kind IN (
                    'meeting', 'bautagebuch', 'time-entry', 'project-summary'
                  )),
  name            TEXT NOT NULL,
  description     TEXT,
  docx_blob       BYTEA NOT NULL,
  filename        TEXT NOT NULL,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_templates_kind ON export_templates(kind);
CREATE UNIQUE INDEX IF NOT EXISTS uq_export_templates_default_per_kind
  ON export_templates(kind) WHERE is_default = true;

COMMENT ON TABLE export_templates IS 'Word-Dokumente als Layout-Templates fuer .docx-Exports. Tag-Syntax: {Variable} (docxtemplater).';
COMMENT ON COLUMN export_templates.docx_blob IS 'Original .docx als BYTEA. Render-Pipeline laedt + ersetzt Tags + streamt.';
