-- ============================================================
-- 059 — KI-Freigabe: was darf ein Sprachmodell sehen?
-- ============================================================
-- PATIO kann je Projekt ein Dossier erzeugen — eine lesbare Zusammenfassung,
-- die ein Sprachmodell (Claude) ueber MCP abfragt. Diese Tabelle steuert, was
-- darin landet.
--
-- ── Warum das in die Datenbank gehoert und nicht in eine Datei ─────────────
--
-- Weil es eine Datenschutz-Entscheidung fuers BUERO ist, keine Praeferenz
-- eines Arbeitsplatzes. Sie gilt fuer jeden, der sich verbindet, ist fuer alle
-- nachvollziehbar und ueberlebt eine Neuinstallation.
--
-- ── DENY BY DEFAULT ───────────────────────────────────────────────────────
--
-- Kein Eintrag heisst NICHT freigegeben. Ein neu angelegtes Projekt ist damit
-- automatisch gesperrt, und der Hauptschalter steht anfangs auf aus. Die
-- Umkehrung — „alles frei, bis jemand widerspricht" — waere bei Bauherrendaten
-- die falsche Voreinstellung.
--
-- ── Warum die Projekt-ID der Schluessel ist ───────────────────────────────
--
-- Ein Rename darf keine Freigabe verschieben. Waere der Name der Schluessel,
-- wuerde aus „Wohnhaus Mueller" nach einer Umbenennung ein Projekt ohne
-- Freigabe — und ein anderes, das zufaellig so heisst, bekaeme sie.
-- ============================================================

-- ── Der Hauptschalter, einzeilig ──────────────────────────────────────────
-- Muster wie `org_branding`: eine Tabelle mit genau einer Zeile. Die
-- CHECK-Bedingung auf `id` sorgt dafuer, dass es dabei bleibt.
CREATE TABLE IF NOT EXISTS ki_freigabe (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  aktiv         BOOLEAN NOT NULL DEFAULT false,
  -- 'keine' | 'namen-ohne-kontakt' | 'alle'
  personendaten TEXT NOT NULL DEFAULT 'namen-ohne-kontakt',
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ki_freigabe_personendaten_gueltig
    CHECK (personendaten IN ('keine', 'namen-ohne-kontakt', 'alle'))
);

INSERT INTO ki_freigabe (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Je Projekt eine Zeile je freigegebener Kategorie ──────────────────────
-- Bewusst NICHT als Array-Spalte am Projekt: so laesst sich eine einzelne
-- Kategorie freigeben und entziehen, ohne die anderen mitzuschreiben — und
-- ein Fremdschluessel raeumt beim Loeschen des Projekts mit auf.
CREATE TABLE IF NOT EXISTS ki_freigabe_projekt (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kategorie  TEXT NOT NULL,
  PRIMARY KEY (project_id, kategorie),
  CONSTRAINT ki_freigabe_kategorie_gueltig CHECK (kategorie IN (
    'stammdaten', 'phasen', 'aufgaben', 'termine', 'notizen',
    'meetings', 'bautagebuch', 'entscheidungen', 'rechnungen', 'beteiligte'
  ))
);
