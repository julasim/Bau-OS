-- Migration 006: UNIQUE-Constraint auf projects.name
-- Verhindert doppelte Projektnamen, die zu Prefix-Match-Kollisionen führen.
ALTER TABLE projects ADD CONSTRAINT projects_name_unique UNIQUE (name);
