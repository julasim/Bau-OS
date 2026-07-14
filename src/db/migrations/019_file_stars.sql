-- ============================================================
-- PATIO — File-Starring (Markiert)
-- ============================================================
-- Pro User kann jede Datei "markiert" werden (Star). Dient als
-- persoenliche Favoriten-Liste in der Datei-View ("Markiert"-
-- Sidebar-Eintrag).
--
-- Schema bewusst minimal: keine Reihenfolge, keine Folder, keine
-- Tags — nur ein Flag "ist gestartet". Junction-Tabelle (User x File)
-- mit Composite-PK.
--
-- ON DELETE CASCADE auf beiden Seiten: wenn der User oder die Datei
-- weg ist, ist der Stern auch weg. Kein orphan possible.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS file_stars (
  file_id    UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, user_id)
);

-- Reihenfolge der "Markiert"-Liste = neueste zuerst → Index nach
-- starred_at fuer den User-spezifischen Pfad.
CREATE INDEX IF NOT EXISTS idx_file_stars_user_ts
  ON file_stars(user_id, starred_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_stars_file
  ON file_stars(file_id);

COMMENT ON TABLE file_stars IS 'Pro-User-Favoriten ("Markiert" in der Datei-View). Junction User x File.';
