-- ============================================================
-- Bau-OS — Projekt-Verknuepfungen
-- ============================================================
-- Zwei neue FK-Spalten auf projects:
--   1) bauherr_id → team_members(id): Bauherr kann statt Freitext auch
--      direkt auf ein Team-Mitglied zeigen. Beide koennen parallel existieren;
--      wenn bauherr_id gesetzt ist, zieht das Frontend Name/Kontakt aus dem
--      Team-Eintrag, das bauherr-Textfeld bleibt als Fallback erhalten.
--   2) parent_id → projects(id): erlaubt Sub-Projekte / Bauteile. Keine
--      CHECK-Constraint gegen Zyklen auf DB-Ebene — das waere mit einem
--      einfachen FK nicht rekursiv erzwingbar. Wir pruefen das im Frontend
--      (keine Selbstzuweisung + Parent darf nicht Kind sein).
--
-- ON DELETE SET NULL: wenn das referenzierte Member / Parent geloescht
-- wird, verliert das Projekt die Verknuepfung aber nicht sich selbst.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS bauherr_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_id  UUID REFERENCES projects(id)     ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_parent    ON projects(parent_id);
CREATE INDEX IF NOT EXISTS idx_projects_bauherr   ON projects(bauherr_id);
