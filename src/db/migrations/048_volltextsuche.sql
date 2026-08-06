-- ============================================================
-- 048 — Volltextsuche auf tsvector
-- ============================================================
-- Die Suche lief bis hierher ueber `ILIKE '%begriff%'`. Das funktioniert, hat
-- aber drei Grenzen, die im Buero sofort spuerbar sind:
--
--   1. **Kein Wortstamm.** Wer „Einreichung" sucht, findet „Einreichungen"
--      nicht — und schon gar nicht „einreichen".
--   2. **Keine Reihenfolge nach Relevanz.** Sortiert wurde nach Datum: eine
--      Notiz, in der der Begriff einmal am Rand vorkommt, stand vor dem
--      Protokoll, das sich um nichts anderes dreht.
--   3. **Kein Index moeglich.** `%begriff%` kann keinen B-Tree nutzen; jede
--      Suche liest alle Zeilen. Bei ein paar hundert Datensaetzen egal, bei
--      Jahren voller Bautagebuecher nicht.
--
-- ── Generierte Spalten statt Trigger ────────────────────────────────────────
--
-- `GENERATED ALWAYS AS (…) STORED` haelt den Suchvektor automatisch aktuell —
-- es gibt keinen Schreibpfad, der ihn vergessen koennte. Ein Trigger waere die
-- Alternative, aber Trigger sind unsichtbar: wer den Code liest, sieht die
-- Spalte und weiss sofort, woraus sie entsteht.
--
-- Die Textkonfiguration `german` ist fest verdrahtet, nicht `default`. Ein
-- generierter Ausdruck muss IMMUTABLE sein, und `to_tsvector(text)` ohne
-- Konfiguration ist es nicht — es haengt an einer Sitzungsvariablen.
--
-- ── Die Falle bei grossen Dateien ───────────────────────────────────────────
--
-- Ein `tsvector` darf hoechstens 1 MB gross werden. `files.content_text`
-- enthaelt den ausgelesenen Text ganzer PDF-Plaene; bei einem grossen
-- gescannten Dokument reisst das die Grenze, und dann schlaegt nicht die
-- Suche fehl, sondern **der Upload** — mit „string is too long for tsvector".
-- Deshalb geht nur der Anfang in den Vektor. 500.000 Zeichen sind rund 200
-- Seiten Text; was danach kommt, ist ueber den Dateinamen und das Projekt
-- immer noch auffindbar.
-- ============================================================

ALTER TABLE notes ADD COLUMN IF NOT EXISTS such_text tsvector
  GENERATED ALWAYS AS (
    to_tsvector('german', coalesce(title, '') || ' ' || coalesce(left(content, 500000), ''))
  ) STORED;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS such_text tsvector
  GENERATED ALWAYS AS (to_tsvector('german', coalesce(text, ''))) STORED;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS such_text tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'german',
      coalesce(name, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(projektnummer, '') || ' ' || coalesce(bauherr, '') || ' ' || coalesce(standort, '')
    )
  ) STORED;

ALTER TABLE files ADD COLUMN IF NOT EXISTS such_text tsvector
  GENERATED ALWAYS AS (
    to_tsvector('german', coalesce(filename, '') || ' ' || coalesce(left(content_text, 500000), ''))
  ) STORED;

-- GIN ist fuer tsvector die richtige Wahl: langsamer beim Schreiben als GiST,
-- aber deutlich schneller beim Suchen — und gesucht wird oefter als
-- geschrieben.
CREATE INDEX IF NOT EXISTS idx_notes_such_text    ON notes    USING GIN (such_text);
CREATE INDEX IF NOT EXISTS idx_tasks_such_text    ON tasks    USING GIN (such_text);
CREATE INDEX IF NOT EXISTS idx_projects_such_text ON projects USING GIN (such_text);
CREATE INDEX IF NOT EXISTS idx_files_such_text    ON files    USING GIN (such_text);

-- Fuer die Teilwort-Suche auf den KURZEN Feldern (Titel, Name, Dateiname)
-- bleibt ILIKE — dort ist sie richtig: wer „2026-01" tippt, meint einen
-- Nummernanfang, keinen Wortstamm. `pg_trgm` (Migration 001) macht das
-- indizierbar.
CREATE INDEX IF NOT EXISTS idx_notes_title_trgm    ON notes    USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_text_trgm     ON tasks    USING GIN (text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm  ON projects USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_files_filename_trgm ON files    USING GIN (filename gin_trgm_ops);
