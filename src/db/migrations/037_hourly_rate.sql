-- ============================================================
-- PATIO — Stundensatz fuer den Deckungsbeitrag
-- ============================================================
-- Honorar-Oekonomie je Phase braucht Ist-Kosten = Stunden * Satz.
-- Der Satz lebt am Mitarbeiter (Standardsatz), optional je Zeiteintrag
-- ueberschreibbar. Effektiver Satz = time_entry.hourly_rate
--                                     ?? team_member.hourly_rate ?? 0.
-- NUMERIC(10,2) EUR/h, NULL = nicht gesetzt.
-- Forward-only, idempotent.
-- ============================================================

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10,2);
