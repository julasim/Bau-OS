-- ============================================================
-- 046 — Rechnungspositionen und Positionskatalog
-- ============================================================
-- Eine Teilrechnung war bisher genau eine Zahl: `project_invoices.betrag`.
-- Das reicht fuer die Honorarbilanz, aber nicht fuer die Rechnung selbst —
-- die braucht Zeilen: Leistung, Menge, Einheit, Einzelpreis, Steuersatz.
-- Ohne sie muss der Betrag ausserhalb des Programms ausgerechnet und der
-- Beleg in Word von Hand getippt werden; PATIO kennt dann nur die Summe und
-- nicht, woraus sie entstanden ist.
--
-- ── Warum JSONB und keine eigene Tabelle ────────────────────────────────────
--
-- Positionen werden ausschliesslich AM STUECK gelesen und geschrieben: wer
-- eine Rechnung oeffnet, will alle Zeilen; wer speichert, schreibt alle Zeilen.
-- Es wird nie nach einer einzelnen Position gefiltert, sortiert oder
-- gerechnet — die Summe entsteht beim Speichern und steht in `betrag`.
--
-- Eine eigene Tabelle braechte dafuer einen zweiten Schreibpfad, eine
-- Reihenfolgespalte und die Frage, was beim Loeschen der Rechnung passiert.
-- Der Plan sagt es als Regel: „Im Zweifel JSON. Ein Feld spaeter zur Spalte
-- zu machen ist einfach; eine ueberfluessige Spalte loszuwerden ist es nicht."
--
-- ── Der Katalog ─────────────────────────────────────────────────────────────
--
-- Wiederkehrende Leistungen („Einreichplanung, Stunde", „Bauaufsicht, Pauschale")
-- sollen nicht bei jeder Rechnung neu getippt werden. Der Katalog ist deshalb
-- eine eigene, kleine Tabelle — anders als die Positionen wird er sehr wohl
-- einzeln bearbeitet und durchsucht.
--
-- Er gilt fuers ganze Buero und enthaelt Preise. Beides zusammen heisst: er
-- haengt am Geld-Recht (Migration 043), nicht an der Rolle.
--
-- Portiert aus `apps/patio-app-lokal` (dort eine JSON-Datei unter
-- `_Einstellungen/`). Uebernommen sind Feldschnitt und Semantik.
-- ============================================================

-- Bestandsrechnungen bekommen eine leere Liste; ihr `betrag` bleibt gueltig.
-- Genau dafuer ist die Ableitung unten so gebaut, dass sie den vorhandenen
-- Betrag stehen laesst, solange es keine Positionen gibt.
ALTER TABLE project_invoices
  ADD COLUMN IF NOT EXISTS positionen JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN project_invoices.positionen IS
  '[{text, menge, einheit, einzelpreis, ustSatz}]. Leer = Rechnung traegt nur betrag (Bestand).';

COMMENT ON COLUMN project_invoices.betrag IS
  'Netto-Gesamtbetrag. Abgeleitet aus positionen (Summe menge*einzelpreis), sobald welche vorhanden sind.';

CREATE TABLE IF NOT EXISTS positionskatalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text          TEXT NOT NULL,
  einheit       TEXT,
  -- NUMERIC statt double precision: Geldbetraege duerfen nicht runden.
  einzelpreis   NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Prozent, nicht Betrag (20 = 20 %). In Oesterreich sind 20 % der Normalfall.
  ust_satz      NUMERIC(5,2) NOT NULL DEFAULT 20,
  sort_order    INT NOT NULL DEFAULT 0,
  rev           INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positionskatalog_sort
  ON positionskatalog(sort_order, text);
