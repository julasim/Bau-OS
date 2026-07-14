-- ============================================================
-- PATIO — Projekt-ACL & File-Sharing
-- ============================================================
-- Macht Mehrbenutzer-Betrieb mit per-Projekt-Zugriff moeglich.
--
--   - user_projects   : Junction Users <-> Projekte. Admin-User in der
--                       Tabelle = User darf das Projekt sehen.
--   - file_shares     : Direkt-Sharing einer Datei mit anderen Usern.
--                       can_edit-Flag fuer zukuenftige Edit-Rechte
--                       (aktuell nur read).
--   - created_by/uploaded_by-Spalten existieren seit 001_init.sql,
--     werden aber bisher nicht aktiv befuellt. Ab dieser Migration
--     legt der Backend-Code sie bei jedem POST automatisch an.
--
-- Pre-existing Daten ohne created_by sind fuer Nicht-Admins unsichtbar
-- (Phase-4-Scoping). Admins sehen weiterhin alles. Falls der Admin
-- spaeter alte Projekte fuer User freigibt, geht das wie bei neuen.
--
-- Idempotent.
-- ============================================================

-- 1) Junction: User <-> Projekt -----------------------------------------------
-- ON DELETE CASCADE auf beiden FKs: wenn ein User oder Projekt geloescht
-- wird, verschwindet auch die Zuordnung. Soll auch so sein — Tote Eintraege
-- bringen niemandem was.
CREATE TABLE IF NOT EXISTS user_projects (
  user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_user_projects_user    ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project ON user_projects(project_id);

-- 2) File-Shares: Direkt-Sharing -----------------------------------------------
-- Drei Sichtbarkeits-Quellen einer Datei:
--   a) created_by (uploaded_by) = me  — meine eigene Datei
--   b) project_id ist gesetzt + ich bin in user_projects fuer das Projekt
--   c) Eintrag in file_shares fuer (datei, mich)
-- can_edit-Flag bleibt aktuell ungenutzt (read-only Sharing); wird in einer
-- spaeteren Phase fuer kollaboratives Editieren ausgewertet.
CREATE TABLE IF NOT EXISTS file_shares (
  file_id   UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit  BOOLEAN NOT NULL DEFAULT false,
  added_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (file_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_file_shares_file ON file_shares(file_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_user ON file_shares(user_id);
