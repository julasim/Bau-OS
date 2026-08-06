-- ============================================================
-- 045 — Entscheidungslog
-- ============================================================
-- Bisher lebten Projektentscheidungen in einem Freitextfeld am
-- Besprechungsprotokoll (`meetings.decisions`). Das hat drei Nachteile, die
-- im Buero teuer werden:
--
--   1. Wer eine Entscheidung sucht, muss alle Protokolle durchlesen. Es gibt
--      keine Liste „was haben wir in diesem Projekt entschieden".
--   2. Die BEGRUENDUNG geht verloren, und mit ihr die verworfenen
--      Alternativen. Ein halbes Jahr spaeter fragt der Bauherr „warum
--      eigentlich Fenster in Holz?" — und niemand weiss es mehr.
--   3. Entscheidungen fallen nicht nur in Besprechungen. Am Telefon, per
--      Mail, auf der Baustelle — das Freitextfeld erreicht sie gar nicht.
--
-- Deshalb ein eigener Datensatz mit Begruendung, strukturierten Alternativen
-- und Beteiligten. Der Bezug zur Besprechung bleibt moeglich, ist aber
-- optional.
--
-- `meetings.decisions` bleibt bewusst stehen: die Migrationen laufen nur
-- vorwaerts, und in Bestandsdaten steckt Text, den niemand verlieren will.
-- Die Oberflaeche fuehrt kuenftig hierher; das alte Feld wird nicht mehr
-- angeboten, aber weiter angezeigt, solange etwas drinsteht.
--
-- Portiert aus `apps/patio-app-lokal` (dort dateibasiert, AP9 vom
-- 2026-07-27). Uebernommen sind Feldschnitt und Semantik, nicht der Code —
-- hier ist es eine Tabelle mit Fremdschluesseln statt einer JSON-Datei.
-- ============================================================

CREATE TABLE IF NOT EXISTS entscheidungen (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  datum               DATE NOT NULL,
  titel               TEXT NOT NULL,
  begruendung         TEXT,
  -- [{ "text": "...", "verworfenWeil": "..." }] — als JSONB, weil die Zahl der
  -- Alternativen offen ist und nie einzeln abgefragt wird.
  alternativen        JSONB NOT NULL DEFAULT '[]'::jsonb,
  beteiligte_ids      UUID[] NOT NULL DEFAULT '{}',
  -- Beteiligte ohne Team-Eintrag (Bauherr, Behoerde, Fachplaner von aussen).
  beteiligte_extern   TEXT[] NOT NULL DEFAULT '{}',
  -- "entwurf" = vorlaeufig festgehalten, noch nicht bestaetigt.
  status              TEXT NOT NULL DEFAULT 'entwurf'
                        CHECK (status IN ('entwurf', 'bestaetigt')),
  -- Optionaler Bezug zur Besprechung, aus der die Entscheidung entstand.
  -- SET NULL statt CASCADE: eine geloeschte Besprechung darf die Entscheidung
  -- nicht mitnehmen — sie ist das Wertvollere von beiden.
  related_meeting_id  UUID REFERENCES meetings(id) ON DELETE SET NULL,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  rev                 INT NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entscheidungen_project_datum
  ON entscheidungen(project_id, datum DESC);

-- Fuer „an welchen Entscheidungen war Person X beteiligt?"
CREATE INDEX IF NOT EXISTS idx_entscheidungen_beteiligte
  ON entscheidungen USING GIN (beteiligte_ids);
