-- ============================================================
-- 044 — Papierkorb: Loeschen wird umkehrbar
-- ============================================================
-- Bis hierher war Loeschen endgueltig, und zwar mit zwei verschiedenen,
-- gleichermassen unangenehmen Folgen — gemessen an den Fremdschluesseln der
-- laufenden Datenbank, nicht aus der Dokumentation abgeschrieben:
--
--   ZERSTOERT (ON DELETE CASCADE):
--     bautagebuch · meetings · time_entries · project_phases ·
--     project_invoices · project_team_members · user_projects
--
--   VERWAIST (ON DELETE SET NULL):
--     notes · tasks · termine · files · team_members.project_id ·
--     projects.parent_id
--
-- Ein versehentlich geloeschtes Projekt riss also das halbe Bautagebuch, alle
-- Besprechungsprotokolle, die erfassten Stunden und die Rechnungen mit — und
-- liess Notizen, Aufgaben, Termine und Dateien ohne Projektbezug zurueck. Der
-- einzige Rueckweg war die naechtliche Sicherung, also bis zu einem Tag Arbeit.
--
-- ── Warum ein Zeitstempel und keine Kopie in eine Papierkorb-Tabelle ────────
--
-- Weil die Kaskaden sonst trotzdem feuern. Eine Kopie waere ein zweites Schema,
-- das mit jeder Migration mitgepflegt werden muesste, und beim
-- Zurueckschreiben stimmten die UUID-Bezuege nicht mehr. Mit `deleted_at`
-- passiert schlicht KEIN Loeschen: die Zeile bleibt liegen, alle Bezuege
-- bleiben intakt, und das Zurueckholen ist ein `SET deleted_at = NULL`.
--
-- Die Kaskaden bleiben unveraendert. Sie greifen weiterhin — aber erst beim
-- endgueltigen Leeren des Papierkorbs, und dort sind sie richtig: dann SOLL
-- alles mitgehen.
--
-- `status = 'archiviert'` bleibt daneben bestehen und meint etwas anderes:
-- abgeschlossen, aber weiterhin auffindbar. Der Papierkorb meint „weg".
-- ============================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN projects.deleted_at IS
  'Im Papierkorb seit diesem Zeitpunkt. NULL = in Verwendung. Endgueltiges Loeschen ist ein eigener Schritt.';

-- Der Index deckt den Normalfall ab: alle Listen fragen "nicht im Papierkorb".
-- Als Teilindex bleibt er klein — er enthaelt nur die geloeschten Zeilen.
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at
  ON projects (deleted_at)
  WHERE deleted_at IS NOT NULL;
