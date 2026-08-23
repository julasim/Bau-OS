-- ============================================================
-- 058 — Benachrichtigungen
-- ============================================================
-- Bis hierher hatte PATIO keinen Weg, jemandem etwas ZU SAGEN. Es gab zwei
-- Dinge, die danach aussahen, und beide taugen dafuer nicht:
--
--   * Der Live-Kanal (src/api/events.ts) ist ein In-Memory-Set ohne Speicher
--     und ohne Nachliefern. Wer im Moment der Aenderung nicht verbunden war,
--     erfaehrt sie nie. Er taugt als AUSLOESER, nicht als Speicher.
--   * Die Aktivitaet (src/data/db-aktivitaet.ts) ist bewusst ABGELEITET —
--     sie liest die Datensaetze selbst. Genau deshalb kann sie keinen
--     Lesestatus je Person tragen: es gibt keine Zeile, an die er gehoert.
--
-- Der Unterschied, um den es geht: die Aktivitaet sagt „im Buero ist etwas
-- passiert". Eine Benachrichtigung sagt „DIR wurde etwas zugewiesen". Das
-- erste ist eine Liste, das zweite eine Adressierung — und nur die zweite
-- darf man verpassen.
--
-- ── Warum der Text hier fertig steht ──────────────────────────────────────
--
-- `titel` ist der lesbare Satz, nicht ein Schluessel zum Nachschlagen. Und
-- `ausloeser_name` steht als NAME da, nicht als Verweis auf `users`.
--
-- Das ist die Lehre aus dem Audit-Log: dort steht die Benutzer-ID, und nach
-- dem Loeschen eines Kontos stand in den Eintraegen nichts mehr. Eine
-- Meldung, die nach einem Personalwechsel „(geloescht) hat Ihnen etwas
-- zugewiesen" sagt, ist wertlos.
--
-- Der Preis ist eine Kopie des Namens. Die ist hier richtig: die Meldung
-- beschreibt einen Moment in der Vergangenheit, und der aendert sich nicht,
-- wenn jemand spaeter heiratet oder das Buero verlaesst.
-- ============================================================

CREATE TABLE IF NOT EXISTS benachrichtigungen (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- An WEN. Faellt das Konto, faellt die Meldung — sie hat dann keinen
  -- Adressaten mehr.
  empfaenger_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Warum. Bestimmt, ob die Meldung ueberhaupt erzeugt wird (Einstellung je
  -- Person) und welches Zeichen sie in der Liste bekommt.
  anlass        TEXT NOT NULL,
  -- Der fertige Satz, den der Nutzer liest.
  titel         TEXT NOT NULL,
  -- Wer es ausgeloest hat, als NAME (siehe Kopfkommentar).
  ausloeser     TEXT,
  -- Wohin der Klick fuehrt.
  ziel_typ      TEXT,
  ziel_id       UUID,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  erstellt_am   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = ungelesen. Ein eigener Zeitpunkt statt eines Schalters: „wann
  -- gesehen" beantwortet auch die Frage, ob jemand die Meldung erst nach drei
  -- Tagen bemerkt hat.
  gelesen_am    TIMESTAMPTZ
);

-- Die einzige Abfrage, die haeufig laeuft: „meine ungelesenen, neueste zuerst".
CREATE INDEX IF NOT EXISTS idx_benachrichtigungen_empfaenger
  ON benachrichtigungen (empfaenger_id, erstellt_am DESC);

-- Der Zaehler an der Glocke — er laeuft bei jedem Seitenaufruf.
CREATE INDEX IF NOT EXISTS idx_benachrichtigungen_ungelesen
  ON benachrichtigungen (empfaenger_id) WHERE gelesen_am IS NULL;
