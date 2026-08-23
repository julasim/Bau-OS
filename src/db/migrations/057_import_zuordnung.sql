-- ============================================================
-- 057 — Zuordnungstabelle fuer die Datenuebernahme
-- ============================================================
-- Die Uebernahme aus PATIO Desktop liest Datensaetze mit deren eigenen IDs
-- (achtstellige Hex-Kennungen) und legt sie hier unter neuen UUIDs an. Fuer
-- zwei Dinge muss die Zuordnung erhalten bleiben:
--
--   1. WIEDERHOLBARKEIT. Ein Import laeuft selten beim ersten Mal vollstaendig
--      durch — eine Datei ist kaputt, ein Feld unerwartet, jemand bricht ab.
--      Ohne Zuordnung kann ein zweiter Lauf nur ueber Text und Datum raten, ob
--      ein Datensatz schon da ist. Genau das tat die Vorgaengerfassung, und
--      bei Notizen entschied sie nur ueber den TITEL: aus 400 Notizen wurde
--      eine.
--
--   2. VERWEISE. Eine Aufgabe zeigt auf ein Projekt, eine Rechnung auf eine
--      Phase, eine Entscheidung auf eine Besprechung. Diese Verweise stehen in
--      den Quelldaten als Quell-IDs und muessen beim Schreiben in die neuen
--      UUIDs uebersetzt werden.
--
-- ── Warum eine eigene Tabelle und keine Spalte je Fachtabelle ──────────────
--
-- Eine Spalte `quell_id` haette zehn Fachtabellen um ein Feld erweitert, das
-- nach der Uebernahme nie wieder jemand liest. Hier steht es an einer Stelle,
-- laesst sich nach einem gelungenen Import als Ganzes loeschen, und die
-- Fachtabellen bleiben so, wie sie ohne Uebernahme aussaehen.
--
-- `quelle` unterscheidet mehrere Uebernahmen (etwa zwei Vaults zweier Firmen).
-- ============================================================

CREATE TABLE IF NOT EXISTS import_zuordnung (
  quelle    TEXT NOT NULL,
  typ       TEXT NOT NULL,
  quell_id  TEXT NOT NULL,
  ziel_id   UUID NOT NULL,
  angelegt_am TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quelle, typ, quell_id)
);

-- Rueckrichtung: „welcher Quelldatensatz wurde das hier?" — fuer Stichproben
-- nach dem Import.
CREATE INDEX IF NOT EXISTS idx_import_zuordnung_ziel ON import_zuordnung (ziel_id);
