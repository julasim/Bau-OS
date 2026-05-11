-- Migration 005: files.project_id ON DELETE CASCADE → SET NULL
-- Wenn ein Projekt gelöscht wird, sollen verknüpfte Dateien erhalten bleiben
-- (mit project_id = NULL), anstatt ebenfalls gelöscht zu werden.
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_project_id_fkey;
ALTER TABLE files ADD CONSTRAINT files_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
