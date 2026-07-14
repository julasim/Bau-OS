-- ============================================================
-- PATIO — Branding (Logo + Firmendaten) (Phase 6b)
-- ============================================================
-- Globale Branding-Konfiguration. Singleton-Pattern: genau eine
-- Zeile mit id=1 (CHECK-Constraint), damit Settings einen festen
-- Anker haben und nicht versehentlich mehrere parallele Brandings
-- entstehen.
--
-- Logo wird als BYTEA in der DB gespeichert (kein File-System-
-- Pfad). Vorteile: in Backups enthalten, ueberlebt Container-Re-
-- creates, kein zusaetzliches Volume-Management.
--
-- Verwendet von:
--   - PDF/Word-Exports (Phase 6d): Header-Logo, Firmenadresse
--   - Visitenkarten-Drucken (Phase 4 vCard-Erweiterung)
--   - Email-Templates: Logo im Header
--   - SettingsView Preview
-- ============================================================

CREATE TABLE IF NOT EXISTS org_branding (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name    TEXT,
  logo_blob       BYTEA,
  logo_mime_type  TEXT,
  logo_filename   TEXT,
  primary_color   TEXT,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  website         TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Singleton anlegen, wenn noch nicht vorhanden. Idempotent.
INSERT INTO org_branding (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- updated_at automatisch pflegen.
CREATE OR REPLACE FUNCTION trg_org_branding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS org_branding_updated_at ON org_branding;
CREATE TRIGGER org_branding_updated_at
  BEFORE UPDATE ON org_branding
  FOR EACH ROW EXECUTE FUNCTION trg_org_branding_updated_at();

COMMENT ON TABLE org_branding IS 'Singleton fuer Firmenlogo + Stammdaten. Wird in Word-/PDF-Exports + Email-Templates verwendet.';
COMMENT ON COLUMN org_branding.logo_blob IS 'Logo als Binary, max ~2MB sinnvoll. PNG/JPG/SVG.';
