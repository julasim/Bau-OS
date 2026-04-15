-- ============================================================
-- Migration 003: Alles in die Datenbank (User-Daten)
--
-- Regel: Nur System-Dateien (Agenten-Workspace, users.json, Tools,
-- Logs, DOCX-Exports) bleiben im Vault. Alle User-Daten — inkl.
-- hochgeladener Binaerdateien — liegen ab jetzt in Postgres.
-- ============================================================

-- 1. files.blob: Binaer-Inhalt direkt in der DB (bytea) statt auf Disk.
--    Fuer bestehende Zeilen bleibt blob=NULL; der Download faellt dann
--    auf den Legacy-Pfad (filepath im Vault) zurueck, solange die Datei
--    dort noch liegt. Neu hochgeladene Dateien haben ausschliesslich
--    blob gesetzt und filepath ist nur noch ein logischer Anzeigename.
ALTER TABLE files ADD COLUMN IF NOT EXISTS blob BYTEA;

-- 2. projects.folder_path war NOT NULL, weil create() einen Vault-Ordner
--    erzwang. Projekte sind jetzt rein logische DB-Entities ohne FS-
--    Komponente, daher nullable.
ALTER TABLE projects ALTER COLUMN folder_path DROP NOT NULL;
