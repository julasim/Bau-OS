-- ============================================================
-- PATIO — Team-Redesign: Companies, M:N Projekt-Zuordnung,
-- Member-Kategorien, Kontakt-Log
-- ============================================================
-- Die bisherige team_members-Tabelle hatte zwei gravierende Limitierungen:
--   1) company war ein TEXT-Freitext → keine saubere Suche, kein Umbenennen
--   2) project_id war eine einzelne FK → ein Mitglied konnte nur zu EINEM
--      Projekt gehoeren (realitaetsfremd — Statiker arbeiten parallel).
--
-- Diese Migration:
--   a) Legt companies als eigene Entitaet an (Unique-Constraint auf Name).
--   b) Ergaenzt team_members um member_type (Kategorie), company_id (FK)
--      und contact_log (JSONB-Array fuer Phase 4).
--   c) Legt project_team_members als Junction-Table fuer M:N an.
--   d) Backfillt bestehende Daten idempotent:
--      - Distinct company-Strings → companies-Eintraege
--      - team_members.company → company_id
--      - team_members.project_id → project_team_members
--      - projects.bauherr_id → member_type='Bauherr' fuer die referenzierte Person
--   e) Behaelt Legacy-Spalten team_members.project_id und team_members.company
--      bewusst bestehen (forward-only Kultur). Frontend migriert schrittweise
--      auf die neue Struktur; alte Spalten werden spaeter in Migration 00X
--      sauber entfernt, wenn garantiert niemand mehr dagegen schreibt.
-- ============================================================

-- 1) Companies-Tabelle -------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  website TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- updated_at Trigger analog zu den anderen Tabellen (siehe 001_init.sql).
DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2) team_members erweitern --------------------------------------------------
-- CHECK-Constraint statt Enum: wir koennen Kategorien spaeter ergaenzen ohne
-- eine weitere Migration. DROP + ADD damit die Migration idempotent bleibt.
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS member_type TEXT,
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_log JSONB DEFAULT '[]'::jsonb;

-- CHECK-Constraint separat (IF NOT EXISTS gibt es nicht fuer CONSTRAINTs,
-- daher DO-Block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_members_member_type_check'
  ) THEN
    ALTER TABLE team_members
      ADD CONSTRAINT team_members_member_type_check
      CHECK (member_type IS NULL OR member_type IN (
        'Intern', 'Planer', 'Ausführende', 'Behörde', 'Lieferant', 'Bauherr'
      ));
  END IF;
END$$;

-- 3) Junction-Table project_team_members ------------------------------------
-- project_role ist die projektspezifische Rolle (z.B. "Statiker", "Polier",
-- "Bauleiter"), orthogonal zu team_members.role (generische Berufsbezeichnung
-- wie "Dipl.-Ing." oder "Geselle").
CREATE TABLE IF NOT EXISTS project_team_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  project_role TEXT,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, member_id)
);

-- 4) Backfill: Companies aus bestehenden Freitext-Werten --------------------
-- Nur echte, getrimmte Nicht-Leer-Werte; Duplikate werden via UNIQUE verhindert.
INSERT INTO companies (name)
  SELECT DISTINCT TRIM(company)
  FROM team_members
  WHERE company IS NOT NULL AND TRIM(company) <> ''
ON CONFLICT (name) DO NOTHING;

-- 5) Backfill: company_id aus Name-Match ------------------------------------
UPDATE team_members
   SET company_id = c.id
  FROM companies c
 WHERE c.name = TRIM(team_members.company)
   AND team_members.company_id IS NULL;

-- 6) Backfill: Junction aus bestehendem project_id -------------------------
INSERT INTO project_team_members (project_id, member_id)
  SELECT project_id, id
    FROM team_members
   WHERE project_id IS NOT NULL
ON CONFLICT (project_id, member_id) DO NOTHING;

-- 7) Backfill: Bauherr-Mitglieder kategorisieren ----------------------------
-- projects.bauherr_id (Migration 005) referenziert einen team_member. Fuer
-- dessen member_type setzen wir 'Bauherr' — falls noch nicht anders gesetzt.
UPDATE team_members tm
   SET member_type = 'Bauherr'
  FROM (SELECT DISTINCT bauherr_id FROM projects WHERE bauherr_id IS NOT NULL) p
 WHERE tm.id = p.bauherr_id
   AND tm.member_type IS NULL;

-- 8) Indizes -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ptm_project             ON project_team_members(project_id);
CREATE INDEX IF NOT EXISTS idx_ptm_member              ON project_team_members(member_id);
CREATE INDEX IF NOT EXISTS idx_team_members_company    ON team_members(company_id);
CREATE INDEX IF NOT EXISTS idx_team_members_type       ON team_members(member_type);
