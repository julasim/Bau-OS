-- ============================================================
-- PATIO — Projektmanagement: Leistungsphasen, Teilrechnungen, Verknuepfung
-- ============================================================
-- Kern des PM-Moduls fuer Planungsbueros. Drei Bausteine:
--
--   1. project_phases — frei konfigurierbares Phasenmodell pro Projekt
--      (z.B. AT-Leistungsbilder: Vorentwurf, Entwurf, Einreich-, Ausfueh-
--      rungsplanung, Vergabe, OEBA). Jede Phase traegt einen Honoraranteil
--      (fee_share %), Soll/Ist-Termine und einen Status. Der Fortschritt
--      wird NICHT hier gespeichert, sondern in der App-Schicht aus den
--      verknuepften Aufgaben abgeleitet (COUNT done / COUNT *). progress_manual
--      erlaubt ein optionales Override, wenn keine Aufgaben verknuepft sind.
--
--   2. project_invoices — Teilrechnungen je Projekt/Phase. Die Honorarsumme
--      bleibt projects.budget (Migration 031); der je-Phase-Betrag ergibt
--      sich aus budget * fee_share — keine Doppel-Datenhaltung.
--
--   3. phase_id auf tasks + termine, is_milestone auf termine — das Scharnier:
--      Aufgaben/Termine gehoeren optional zu einer Phase. ON DELETE SET NULL,
--      damit das Loeschen einer Phase die Aufgaben nicht mitreisst.
--
-- DB-only Feature (wie Bautagebuch/Meetings/Stunden) — kein FS-Fallback.
-- Forward-only, idempotent (IF NOT EXISTS / CHECK-Guards).
-- ============================================================

-- ── 1. Leistungsphasen ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_phases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'offen'
                    CHECK (status IN ('offen','aktiv','fertig')),
  -- Optionales manuelles Fortschritts-Override (0..100). NULL = aus Aufgaben ableiten.
  progress_manual INTEGER CHECK (progress_manual IS NULL OR (progress_manual BETWEEN 0 AND 100)),
  -- Honoraranteil in Prozent (0..100). Summe je Projekt soll 100 ergeben,
  -- wird aber NICHT hart erzwungen (Teil-Beauftragungen sind erlaubt).
  fee_share       NUMERIC(5,2) NOT NULL DEFAULT 0
                    CHECK (fee_share >= 0 AND fee_share <= 100),
  soll_start      DATE,
  soll_ende       DATE,
  ist_start       DATE,
  ist_ende        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_phases_project
  ON project_phases(project_id, sort_order);

CREATE OR REPLACE FUNCTION project_phases_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_phases_updated_at ON project_phases;
CREATE TRIGGER trg_project_phases_updated_at
  BEFORE UPDATE ON project_phases
  FOR EACH ROW EXECUTE FUNCTION project_phases_touch_updated_at();

-- ── 2. Teilrechnungen ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_invoices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Phase, auf die sich die Teilrechnung bezieht (optional). SET NULL, damit
  -- eine geloeschte Phase die Rechnungshistorie nicht zerstoert.
  phase_id     UUID REFERENCES project_phases(id) ON DELETE SET NULL,
  nummer       TEXT,
  betrag       NUMERIC(12,2) NOT NULL DEFAULT 0,
  datum        DATE,
  status       TEXT NOT NULL DEFAULT 'gestellt'
                 CHECK (status IN ('entwurf','gestellt','bezahlt')),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_invoices_project
  ON project_invoices(project_id, datum DESC);
CREATE INDEX IF NOT EXISTS idx_project_invoices_phase
  ON project_invoices(phase_id);

DROP TRIGGER IF EXISTS trg_project_invoices_updated_at ON project_invoices;
CREATE TRIGGER trg_project_invoices_updated_at
  BEFORE UPDATE ON project_invoices
  FOR EACH ROW EXECUTE FUNCTION project_phases_touch_updated_at();

-- ── 3. Verknuepfung: Aufgaben + Termine an Phasen haengen ─────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase_id);

ALTER TABLE termine
  ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES project_phases(id) ON DELETE SET NULL;
ALTER TABLE termine
  ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_termine_phase ON termine(phase_id);
