-- ============================================================
-- PATIO — Bautagebuch (Phase 1)
-- ============================================================
-- Klassisches Bau-Domain-Feature: ein Eintrag pro Projekt pro Tag mit
-- Wetter, eingesetztem Personal/Maschinen, Taetigkeiten und besonderen
-- Vorkommnissen. In vielen Bauvorhaben gesetzlich Pflicht (zB OEN B 2110
-- Pkt 6.2.4 in Oesterreich, VOB/B § 6 Abs 3 in Deutschland).
--
-- Designentscheidungen:
--   - UNIQUE (project_id, date): pro Tag genau ein Eintrag pro Projekt.
--     UPSERT-Pattern in der App-Schicht (PUT statt POST + PUT).
--   - personnel als JSONB-Array von { memberId?, name, hours?, role? }:
--     erlaubt sowohl Team-Mitglieder (mit FK auf team_members) als auch
--     externe Namen (Subunternehmer-Trupp ohne eigenen Stammdatensatz).
--     Member-Loeschung wuerschen wir NICHT in JSONB-Subtree weg — Trigger
--     unten markiert die Eintraege stattdessen mit removed:true.
--   - machines als TEXT statt strukturiert: Maschinenpark im Bau ist zu
--     volatil und divers fuer ein Stammdaten-Schema ("Bagger CAT 320,
--     Mobilkran LTM 1050, Walze BW213"). Volltextsuche ueber alle
--     Eintraege ist mit GIN trgm noch immer billig.
--   - weather als enum-aehnlicher TEXT mit CHECK: keine Enum-Migration
--     wenn neue Wettertypen dazukommen (zB "Hagel"), bleibt aber kontrol-
--     liert. Dropdown-Reihenfolge in der UI bestimmt der CHECK-Constraint.
-- ============================================================

CREATE TABLE IF NOT EXISTS bautagebuch (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_date      DATE NOT NULL,
  weather         TEXT CHECK (weather IS NULL OR weather IN
                    ('sonnig','bewoelkt','regen','schnee','sturm','nebel','frost','hagel')),
  temperature_min INTEGER,
  temperature_max INTEGER,
  personnel       JSONB NOT NULL DEFAULT '[]'::jsonb,
  machines        TEXT,
  activities      TEXT,
  incidents       TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, entry_date)
);

CREATE INDEX IF NOT EXISTS idx_bautagebuch_project_date
  ON bautagebuch(project_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_bautagebuch_date
  ON bautagebuch(entry_date DESC);

-- updated_at automatisch nachfuehren (Pattern aus Migration 004/005).
CREATE OR REPLACE FUNCTION bautagebuch_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bautagebuch_updated_at ON bautagebuch;
CREATE TRIGGER trg_bautagebuch_updated_at
  BEFORE UPDATE ON bautagebuch
  FOR EACH ROW EXECUTE FUNCTION bautagebuch_touch_updated_at();

-- Member-Delete-Cleanup: wenn ein team_members-Eintrag geloescht wird,
-- markieren wir die referenzierenden personnel-Eintraege mit removed:true,
-- damit die History nicht stillschweigend zerbroeselt. Wir setzen NICHT
-- den Namen auf NULL — der Eintrag soll dokumentarisch erhalten bleiben.
CREATE OR REPLACE FUNCTION bautagebuch_mark_personnel_removed() RETURNS trigger AS $$
BEGIN
  UPDATE bautagebuch
     SET personnel = (
       SELECT jsonb_agg(
         CASE WHEN (elem->>'memberId') = OLD.id::text
              THEN elem || jsonb_build_object('removed', true)
              ELSE elem
         END
       )
       FROM jsonb_array_elements(personnel) elem
     )
   WHERE personnel @> jsonb_build_array(jsonb_build_object('memberId', OLD.id::text));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bautagebuch_member_removed ON team_members;
CREATE TRIGGER trg_bautagebuch_member_removed
  BEFORE DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION bautagebuch_mark_personnel_removed();
