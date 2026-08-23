-- ============================================================
-- 051 — Aufgaben-Status: eine Schreibweise statt zwei
-- ============================================================
-- Die Tabelle `tasks` fuehrt ihren Status seit 001 auf Deutsch (`offen`),
-- der Rest des Systems auf Englisch. Und zwar nicht nur „der Rest" im Sinne
-- von Konvention — die Tabelle selbst mischt: der Endzustand heisst seit
-- jeher `done`, der Anfangszustand `offen`.
--
-- ── Was daran kaputt war ────────────────────────────────────────────────────
--
-- Der Typ `Task["status"]` (src/data/types.ts) sagt seit jeher
-- `"open" | "in_progress" | "done"`. Geschrieben wurde aber `offen`. Alles,
-- was den Status VERGLEICHT, lief damit ins Leere — gemessen am 2026-08-23
-- an einer Datenbank mit 1230 offenen Aufgaben:
--
--   * `TasksListPane.vue` — Registerkarte „Offen" filtert auf `=== "open"`.
--     Sie zeigte „Keine offenen Aufgaben vorhanden.", waehrend 1230 offene
--     Aufgaben in der Tabelle standen. Die Zaehler an allen vier Reitern
--     standen auf 0.
--   * `TaskDetail.vue` — `cycleStatus()` schlaegt den naechsten Status in
--     einer Karte nach: `open -> in_progress -> done -> open`. Fuer `offen`
--     gibt es dort keinen Eintrag, das Ergebnis war `undefined`, und weil
--     `JSON.stringify` undefinierte Felder weglaesst, ging die Anfrage OHNE
--     Status hinaus. Der Knopf tat also nichts — ohne Fehler, ohne Meldung.
--   * `DashboardView.vue` — die Kennzahl „in Arbeit" konnte nie etwas
--     anderes als 0 anzeigen.
--
-- ── Warum Englisch und nicht Deutsch ────────────────────────────────────────
--
-- Weil `done` bereits Englisch ist und in Migrationen, Abfragen und Code an
-- Dutzenden Stellen so steht (`status <> 'done'`). `offen` -> `open` aendert
-- EINE Schreibweise; `done` -> `erledigt` haette jede dieser Stellen
-- angefasst, inklusive der Indizes und der Volltextsuche.
--
-- ── Was hier ausdruecklich NICHT angefasst wird ─────────────────────────────
--
-- `project_phases.status` bleibt `offen/aktiv/fertig` (Migration 035). Das
-- ist eine andere Tabelle mit einer eigenen, bewusst deutschen Werteliste —
-- Leistungsphasen sind ein Fachbegriff der Honorarordnung, kein
-- Zustandsautomat. Ein Reihen-Rename ueber alle `status`-Spalten waere hier
-- genau der falsche Griff.
-- ============================================================

-- ── Bestand umschreiben ─────────────────────────────────────────────────────
UPDATE tasks SET status = 'open' WHERE status = 'offen';

-- ── Standard fuer neue Zeilen ───────────────────────────────────────────────
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'open';

-- ── Die Werteliste festnageln ───────────────────────────────────────────────
-- Damit nicht in zwei Jahren eine vierte Schreibweise dazukommt und wieder
-- monatelang niemandem auffaellt.
--
-- Die Bedingung wird nur gesetzt, wenn KEINE Zeile sie verletzt. Auf einer
-- fremden Datenbank koennen Werte stehen, die hier niemand kennt; die
-- Migration soll dann durchlaufen und die Daten in Ruhe lassen, statt den
-- Start des Dienstes zu verhindern. Forward-only heisst auch: nichts
-- wegwerfen, was man nicht sicher deuten kann.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_gueltig')
     AND NOT EXISTS (SELECT 1 FROM tasks WHERE status NOT IN ('open', 'in_progress', 'done'))
  THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_status_gueltig
      CHECK (status IN ('open', 'in_progress', 'done'));
  END IF;
END $$;
