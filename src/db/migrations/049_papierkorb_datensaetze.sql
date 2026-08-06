-- ============================================================
-- 049 — Papierkorb für einzelne Datensätze
-- ============================================================
-- Migration 044 hat den Papierkorb für PROJEKTE gebracht, weil dort der
-- Schaden am größten ist: ein gelöschtes Projekt riss Bautagebuch,
-- Protokolle, Stunden, Phasen und Rechnungen mit.
--
-- Im Alltag wird aber etwas anderes gelöscht — eine Notiz, eine Aufgabe, ein
-- Termin. Das passierte bis hierher endgültig, mit einer Rückfrage als
-- einziger Bremse. Wer sie wegklickt, hat den Datensatz verloren; der einzige
-- Rückweg war die nächtliche Sicherung, also bis zu einem Tag Arbeit für
-- einen einzelnen Eintrag.
--
-- Dieselbe Lösung wie bei den Projekten und aus denselben Gründen: ein
-- Zeitstempel statt einer Kopie. Es passiert schlicht kein Löschen, alle
-- Bezüge bleiben, das Zurückholen ist ein `SET deleted_at = NULL`.
--
-- ── Warum nur diese drei ────────────────────────────────────────────────────
--
-- Notizen, Aufgaben und Termine legt und löscht man täglich, oft im
-- Vorbeigehen. Besprechungen, Bautagebuch, Phasen und Rechnungen sind
-- schwergewichtiger: sie entstehen bewusst und werden selten entfernt, und
-- sie hängen ohnehin am Projekt-Papierkorb, wenn das Projekt geht.
--
-- Sollte sich das ändern, ist der Nachtrag eine Zeile pro Tabelle plus die
-- Filter im jeweiligen Repo.
-- ============================================================

ALTER TABLE notes   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tasks   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE termine ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN notes.deleted_at   IS 'Im Papierkorb seit diesem Zeitpunkt. NULL = in Verwendung.';
COMMENT ON COLUMN tasks.deleted_at   IS 'Im Papierkorb seit diesem Zeitpunkt. NULL = in Verwendung.';
COMMENT ON COLUMN termine.deleted_at IS 'Im Papierkorb seit diesem Zeitpunkt. NULL = in Verwendung.';

-- Teilindizes: sie enthalten nur die gelöschten Zeilen und bleiben damit
-- klein. Der Normalfall („nicht im Papierkorb") kommt ohnehin über die
-- vorhandenen Indizes.
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at   ON notes   (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at   ON tasks   (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_termine_deleted_at ON termine (deleted_at) WHERE deleted_at IS NOT NULL;
