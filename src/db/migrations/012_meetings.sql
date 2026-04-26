-- ============================================================
-- Bau-OS — Meetings / Protokolle (Phase 1)
-- ============================================================
-- Eigenstaendige Tabelle fuer Bauherrenmeetings, Baubesprechungen,
-- Subunternehmer-Abstimmungen, Behoerden-Termine.
--
-- Bewusste Trennung vom Bautagebuch:
--   - Mehrere Meetings pro Tag moeglich (kein UNIQUE auf project+date)
--   - Meeting kann ohne Bautagebuch-Eintrag stattfinden
--   - Eigener Lebenszyklus: Agenda (vorher) → Protokoll (nachher) →
--     Beschluesse → To-Dos → Folgetermin
--   - Strukturierte Teilnehmer-Verknuepfung wie bei termine
--     (UUID-Array auf team_members), aber eigene Naming-Konvention
--     "attendee_ids" statt "assignee_ids" weil Teilnehmer != Verantwort-
--     liche.
--
-- meeting_type: enum-aehnlicher TEXT mit CHECK fuer kontrollierte
-- Filter-Optionen, aber ohne Enum-Migration wenn neue Typen dazukommen.
--
-- action_items als JSONB-Array von { text, assigneeId?, dueDate?, done? }.
-- Bewusst nicht als separate Tabelle: zu eng mit Meeting verzahnt, will
-- man immer als Block laden, wuerde N+1 erzeugen ohne Mehrwert. Wenn
-- Action-Items spaeter eigenstaendig werden sollen (zB als Tasks
-- eskalierbar), kann man die JSONB-Eintraege per JOIN-Migration in die
-- tasks-Tabelle giessen.
-- ============================================================

CREATE TABLE IF NOT EXISTS meetings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_date        DATE NOT NULL,
  start_time          TIME,
  end_time            TIME,
  title               TEXT NOT NULL,
  meeting_type        TEXT CHECK (meeting_type IS NULL OR meeting_type IN
                        ('Bauherrenmeeting','Baubesprechung','Subunternehmer','Planung',
                         'Behoerde','Abnahme','Sonstiges')),
  location            TEXT,
  attendee_ids        UUID[] NOT NULL DEFAULT '{}',
  attendees_external  TEXT[] NOT NULL DEFAULT '{}',
  agenda              TEXT,
  minutes             TEXT,
  decisions           TEXT,
  action_items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_meeting_date   DATE,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_project_date
  ON meetings(project_id, meeting_date DESC);

-- GIN auf attendee_ids fuer schnelles "= ANY()" und @>-Queries
-- ("welche Meetings hatte Person X?")
CREATE INDEX IF NOT EXISTS idx_meetings_attendees
  ON meetings USING GIN (attendee_ids);

CREATE INDEX IF NOT EXISTS idx_meetings_type
  ON meetings(meeting_type);

-- updated_at automatisch nachfuehren
CREATE OR REPLACE FUNCTION meetings_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON meetings;
CREATE TRIGGER trg_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION meetings_touch_updated_at();

-- Member-Delete-Cleanup analog zu Migration 007 fuer termine.
-- Wenn ein Team-Mitglied geloescht wird, wird seine UUID aus allen
-- attendee_ids-Arrays entfernt. Action-Items mit assigneeId=<deleted>
-- bleiben erhalten (assigneeId wird auf null gepatcht), damit das
-- Protokoll dokumentarisch lesbar bleibt.
CREATE OR REPLACE FUNCTION meetings_remove_member() RETURNS trigger AS $$
BEGIN
  UPDATE meetings
     SET attendee_ids = array_remove(attendee_ids, OLD.id)
   WHERE OLD.id = ANY(attendee_ids);

  UPDATE meetings
     SET action_items = (
       SELECT jsonb_agg(
         CASE WHEN (elem->>'assigneeId') = OLD.id::text
              THEN elem - 'assigneeId'
              ELSE elem
         END
       )
       FROM jsonb_array_elements(action_items) elem
     )
   WHERE action_items @> jsonb_build_array(jsonb_build_object('assigneeId', OLD.id::text));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_meetings_member_removed ON team_members;
CREATE TRIGGER trg_meetings_member_removed
  BEFORE DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION meetings_remove_member();
