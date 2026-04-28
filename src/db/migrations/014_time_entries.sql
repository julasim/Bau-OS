-- ============================================================
-- Bau-OS — Stundenerfassung (Phase 1)
-- ============================================================
-- Pflicht-Feature in vielen Laendern: in Oesterreich §26 AZG
-- (Arbeitszeitaufzeichnungs-Pflicht), in Deutschland nach BAG-
-- Urteil v. 13.09.2022. Pro Mitarbeiter, pro Tag, pro Projekt
-- werden Stunden festgehalten.
--
-- Designentscheidungen:
--   - hours als DECIMAL(5,2): Bau-Standard ist Dezimal (8.50 statt
--     8:30). UI kann beides anbieten (HH:MM ↔ Dezimal).
--   - member_id ist FK auf team_members + member_name als Fallback:
--     Erlaubt sowohl interne Mitarbeiter (bekannt im Team) als auch
--     externe (Subunternehmer-Trupp ohne Stammdatensatz). ON DELETE
--     SET NULL, member_name bleibt lesbar.
--   - start_time + end_time + break_minutes optional: rechtskonforme
--     Variante (§26 AZG verlangt Beginn/Ende), aber im Polier-Alltag
--     reicht oft "8.5h". Beide Wege erlaubt.
--   - activity als TEXT: Maurerarbeiten, Schalung, Aufraumen — zu
--     volatil und projektspezifisch fuer ein Stamm-Schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS time_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Verknuepfung Mitarbeiter (optional). Wenn member_id geloescht wird,
  -- bleibt member_name als Doku erhalten.
  member_id       UUID REFERENCES team_members(id) ON DELETE SET NULL,
  member_name     TEXT, -- Fallback / Snapshot fuer externe Mitarbeiter
  entry_date      DATE NOT NULL,
  hours           DECIMAL(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  start_time      TIME,
  end_time        TIME,
  break_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  activity        TEXT,
  notes           TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hauptzugriffspfad: alle Stunden eines Projekts, neueste zuerst.
CREATE INDEX IF NOT EXISTS idx_time_entries_project_date
  ON time_entries(project_id, entry_date DESC);

-- "Wieviele Stunden hat Mitarbeiter X gemacht?"
CREATE INDEX IF NOT EXISTS idx_time_entries_member_date
  ON time_entries(member_id, entry_date DESC);

-- "Was ist heute / diese Woche an Stunden zusammengekommen?"
CREATE INDEX IF NOT EXISTS idx_time_entries_date
  ON time_entries(entry_date DESC);

-- updated_at automatisch nachfuehren
CREATE OR REPLACE FUNCTION time_entries_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries;
CREATE TRIGGER trg_time_entries_updated_at
  BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION time_entries_touch_updated_at();

-- Sicherheits-Trigger: wenn member_id beim INSERT gesetzt ist und
-- member_name leer, holen wir den Namen aus team_members. Dadurch ist
-- der Eintrag spaeter auch lesbar wenn das team_members entfernt wird
-- (member_id wird per ON DELETE SET NULL geleert, member_name bleibt).
CREATE OR REPLACE FUNCTION time_entries_snapshot_member_name() RETURNS trigger AS $$
BEGIN
  IF NEW.member_id IS NOT NULL AND (NEW.member_name IS NULL OR NEW.member_name = '') THEN
    SELECT name INTO NEW.member_name FROM team_members WHERE id = NEW.member_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_time_entries_snapshot_name ON time_entries;
CREATE TRIGGER trg_time_entries_snapshot_name
  BEFORE INSERT OR UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION time_entries_snapshot_member_name();
