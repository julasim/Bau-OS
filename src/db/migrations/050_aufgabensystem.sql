-- ============================================================
-- 050 — Aufgabensystem, Stufe 1 (Grundgeruest)
-- ============================================================
-- Setzt die Spezifikation "Aufgabensystem — Prinzip und Spezifikation"
-- um, Baustufe 1: Rang, Aufwand, Tagesplan.
--
-- Das Prinzip dahinter in einem Satz: der Zweck ist nicht, Aufgaben zu
-- verwalten, sondern jeden Morgen eine belastbare Auswahl zu treffen — und
-- sichtbar zu machen, wo diese Auswahl an eine Grenze stoesst. Jede Regel
-- hat deshalb dieselbe Bauform: eine Grenze plus eine sichtbare Zahl.
--
-- ── Warum `rang` und nicht `priority` ───────────────────────────────────────
--
-- Die Tabelle hat seit 001 eine Spalte `priority` (niedrig/mittel/hoch). Sie
-- bleibt unangetastet: Portfolio und Projektliste zaehlen darauf
-- (db-portfolio.ts:67, db-projects.ts:96), ein Umbau waere ein Eingriff in
-- Auswertungen, die mit dem Aufgabensystem nichts zu tun haben.
--
-- Inhaltlich ist es ohnehin etwas anderes. `priority` ist eine Achse
-- ("wie wichtig"), `rang` sind ZWEI Fragen in vier Werten:
--
--     dringend + wichtig   -> 1  Sofort        (hoechstens 5 offen)
--     wichtig              -> 2  Terminieren   (mindestens eine pro Tag)
--     dringend             -> 3  Sammeln       (hoechstens 60 min/Tag)
--     keins von beidem     -> 4  Streichen     (Verfall nach 30 Tagen)
--
-- Gemessen am 2026-08-23: ALLE 946 Aufgaben stehen auf `priority = 'mittel'`.
-- Das Feld ist verdrahtet, aber nie benutzt worden — es steht dem neuen
-- Rang also nicht im Weg.
--
-- ── Warum der Standard 3 ist und nicht 1 ────────────────────────────────────
--
-- Grundsatz 02 der Spezifikation: der Normalfall wird nicht markiert. Aktiv
-- gesetzt wird nur Rang 1, 2 oder 4. Aus sechzig Entscheidungen pro Abend
-- werden so fuenfzehn — und an dieser Zahl entscheidet sich, ob die
-- Abendroutine die dritte Woche ueberlebt.
-- ============================================================

-- ── Rang ────────────────────────────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rang SMALLINT NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_rang_gueltig'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_rang_gueltig CHECK (rang BETWEEN 1 AND 4);
  END IF;
END $$;

-- ── Geschaetzter Aufwand in Minuten ─────────────────────────────────────────
-- Bewusst grob gerastert (15/30/60/120/180/240), damit die Summe im Kopf
-- nachvollziehbar bleibt. NULL heisst: liegt noch im Eingang, wurde also
-- noch nicht eingeschaetzt — das ist ein gueltiger Zustand und der Grund,
-- warum die Spalte nullable ist.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS aufwand_min SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_aufwand_raster'
  ) THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_aufwand_raster
      CHECK (aufwand_min IS NULL OR aufwand_min IN (15, 30, 60, 120, 180, 240));
  END IF;
END $$;

-- ── Tagesplan ───────────────────────────────────────────────────────────────
-- "Fuer heute ausgewaehlt". Wird beim Tageswechsel fuer ALLE zurueckgesetzt
-- (src/maintenance.ts) — die Aufgabe selbst bleibt unveraendert, es gibt
-- keine Rueckstandsliste und keine Uebertragung. Der neue Tag beginnt leer.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS im_tagesplan BOOLEAN NOT NULL DEFAULT false;

-- Wer die Auswahl getroffen hat. Ohne diese Spalte waere der Tagesplan
-- GEMEINSAM — auf einem Mehrbenutzer-Server raeumt sonst der eine dem
-- anderen den Tag ab. Die Spezifikation ist fuer eine Person geschrieben;
-- hier braucht es die Trennung.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tagesplan_von UUID REFERENCES users(id) ON DELETE SET NULL;

-- ── Indizes ─────────────────────────────────────────────────────────────────
-- Die Matrix gruppiert nach Rang ueber alle Projekte, "Mein Tag" filtert auf
-- die eigene Auswahl. Beides sind die haeufigsten Abfragen des Systems.
CREATE INDEX IF NOT EXISTS idx_tasks_rang
  ON tasks (rang) WHERE status <> 'done' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tagesplan
  ON tasks (tagesplan_von) WHERE im_tagesplan = true AND deleted_at IS NULL;
