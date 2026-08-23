-- ============================================================
-- 054 — Die Bereinigung aus 052 nachziehen
-- ============================================================
-- Migration 052 sollte den Bestand „genauso normalisieren, wie es die
-- Anwendung mit jeder Neueingabe tut". Das stimmte nicht. Gemessen an einer
-- echten Datenbank:
--
--     Eingabe          | 052 laesst uebrig | Anwendung laesst uebrig
--     -----------------+-------------------+------------------------
--     "  X  "          | "X"               | "X"
--     Tabulator + X    | Tab + X           | "X"
--     CR + X           | CR + X            | "X"
--     NBSP + X         | NBSP + X          | "X"
--     BOM + X          | BOM + X           | "X"
--
-- ── Warum ──────────────────────────────────────────────────────────────────
--
-- Zwei Postgres-Eigenheiten, beide nachgemessen:
--
--   * Einargumentiges `btrim(text)` entfernt AUSSCHLIESSLICH U+0020. Nicht
--     Tabulator, nicht CR, nicht LF. JavaScripts `.trim()` entfernt alle.
--   * `\s` in einer Postgres-Regex ist `[[:space:]]` — Tab, LF, VT, FF, CR,
--     Leerzeichen. Es trifft KEIN geschuetztes Leerzeichen (U+00A0) und keine
--     Byte-Reihenfolge-Marke (U+FEFF). JavaScripts `\s` trifft beide.
--
-- ── Was daraus folgte ──────────────────────────────────────────────────────
--
-- 1. **Dubletten trotz eindeutigem Index.** `<Tab>SAZTG-2026-001` und
--    `SAZTG-2026-001` sind fuer jeden Menschen dieselbe Akte, fuer
--    `lower()` zwei Schluessel. Der Dubletten-Waechter aus 052 meldete null
--    Gruppen, die Migration meldete Erfolg.
-- 2. **Der CHECK blieb still aus.** Eine Nummer aus reinem Tabulator wird von
--    052 zu einem einzelnen Leerzeichen — weder NULL noch leer, der
--    Platzhalter greift nicht. Schritt 4 zaehlt sie, gibt `RAISE WARNING` aus
--    und setzt die Bedingung NICHT. Die Migration gilt danach als angewandt;
--    ein zweiter Lauf holt nichts nach.
-- 3. **Die Bereinigung war kein Fixpunkt.** Gemessen: 15 Zeichen nach dem
--    ersten Durchgang, 14 nach dem zweiten. Ein Wiederholungslauf haette den
--    inzwischen bestehenden eindeutigen Index verletzt — mit der nackten
--    Postgres-Meldung, weil der Klartext-Waechter aus 052 vorher laeuft.
--
-- ── Erreichbarkeit ─────────────────────────────────────────────────────────
--
-- Ueber die Anwendung ist so ein Wert nicht herstellbar, POST und PATCH
-- trimmen in JavaScript. **Migration 004 erzeugt ihn selbst**: sie zieht die
-- Projektnummer per `regexp_match` aus dem Freitext der Bot-Aera und schuetzt
-- sie nur mit `NULLIF(TRIM(...),'')` — also wieder nur gegen Leerzeichen. Eine
-- Beschreibung mit CRLF-Zeilenenden hinterlaesst `2026-037` samt CR.
--
-- Fuer die heutige Datenbank ohne Folgen. Vor AP11 (Datenuebernahme) steigt
-- das Gewicht deutlich: 054 ist die Migration fuer FREMDEN Bestand, und aus
-- Excel-Listen oder handeditierten Dateien ist Rand-Leerraum der Normalfall.
--
-- ── Warum eine eigene Migration ────────────────────────────────────────────
--
-- 052 steht bereits in `_migrations`; der Runner trackt per Dateiname ohne
-- Pruefsumme, forward-only. Eine Korrektur IN 052 wuerde auf keiner Datenbank
-- mehr laufen, auf der 052 schon lief.
-- ============================================================

-- ── Die Zeichenklasse ───────────────────────────────────────────────────────
--
-- Deckungsgleich mit dem, was JavaScripts `.trim()` und `\s` entfernen.
-- Bewusst als lesbare Escape-Folge und NICHT als echte Zeichen im Quelltext:
-- eine Datei, die unsichtbare Zeichen enthaelt, um unsichtbare Zeichen zu
-- entfernen, ist beim naechsten Editor kaputt.
--
--   [:space:]  Tab, LF, VT, FF, CR, Leerzeichen
--   00A0       geschuetztes Leerzeichen   (Word, Outlook)
--   1680       Ogham-Trennzeichen
--   2000-200A  En/Em/Schmalraum-Familie   (Word)
--   2028/2029  Zeilen- und Absatztrenner
--   202F       schmales geschuetztes Leerzeichen
--   205F       mathematisches Leerzeichen
--   3000       ideografisches Leerzeichen
--   FEFF       Byte-Reihenfolge-Marke     (Excel-CSV-Export)
--
-- Nachgemessen: alle Faelle ergeben dasselbe Ergebnis wie JavaScript, und die
-- Umformung ist ein Fixpunkt (zweimal angewandt = einmal angewandt).
-- `normalize(..., NFC)` zuerst: `Ä` gibt es als ein Zeichen (U+00C4) und als
-- `A` plus kombinierendem Akzent (U+0041 U+0308). Beide sehen gleich aus und
-- waeren fuer den eindeutigen Index aus 052 zwei verschiedene Nummern.
-- `pruefeProjektnummer()` in der Anwendung tut seit derselben Runde dasselbe;
-- ein Test haelt beide Seiten gegeneinander.
CREATE OR REPLACE FUNCTION patio_nummer_normal(roh TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(
           regexp_replace(normalize(roh, NFC), '^' || k || '+|' || k || '+$', '', 'g'),
           k || '+', ' ', 'g')
    FROM (SELECT '[[:space:]' || U&'\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF' || ']') AS t(k);
$$;

COMMENT ON FUNCTION patio_nummer_normal(TEXT) IS
  'Bereinigt eine Projektnummer wie pruefeProjektnummer() in src/data/projektnummer.ts. Migration 054.';

-- ── 1. Bestand nachbereinigen ───────────────────────────────────────────────
-- Nur Zeilen anfassen, die sich wirklich aendern — sonst laeuft jede Migration
-- ueber die ganze Tabelle und schreibt die generierte Spalte `such_text` neu.
UPDATE projects
   SET projektnummer = patio_nummer_normal(projektnummer)
 WHERE projektnummer IS DISTINCT FROM patio_nummer_normal(projektnummer);

-- ── 2. Was dabei leer wurde, bekommt den Platzhalter ────────────────────────
-- Eine Nummer aus reinem Leerraum ist keine. 052 hat sie zu einem einzelnen
-- Leerzeichen gemacht und danach uebersehen.
UPDATE projects
   SET projektnummer = 'OHNE-NUMMER-' || left(id::text, 8)
 WHERE projektnummer IS NULL OR projektnummer = '';

-- ── 3. Dubletten, die dadurch erst sichtbar werden ─────────────────────────
--
-- Die Bereinigung KANN Dubletten erzeugen — genauer: sie macht versteckte
-- sichtbar. Wenn das passiert, ist Abbruch richtig: die Eindeutigkeit ist der
-- Zweck des Ganzen.
--
-- Die Meldung nennt die PROJEKTNAMEN, nicht den Indexwert. 052 nannte nur
-- `lower(projektnummer)` — ein Wert, der nach der zurueckgerollten
-- Normalisierung in keiner einzigen Zeile mehr steht. Der Betreiber suchte
-- danach und fand nichts.
DO $$
DECLARE
  dubletten TEXT;
BEGIN
  SELECT string_agg(t.zeile, E'\n  ')
    INTO dubletten
    FROM (
      SELECT lower(projektnummer) || ' → ' || string_agg(name, ', ' ORDER BY name) AS zeile
        FROM projects
       GROUP BY lower(projektnummer)
      HAVING count(*) > 1
    ) t;
  IF dubletten IS NOT NULL THEN
    RAISE EXCEPTION E'Migration 054: mehrfach vergebene Projektnummern:\n  %\nBitte in der Datenbank vereindeutigen und den Dienst erneut starten.', dubletten;
  END IF;
END $$;

-- ── 4. Die Pflicht durchsetzen, falls 052 sie ausgelassen hat ──────────────
--
-- Hier steht `RAISE EXCEPTION` und nicht `RAISE WARNING`. Die Begruendung ist
-- dieselbe, mit der 052 den Dubletten-Waechter hart macht: eine Datenbank, die
-- ohne die Zusicherung startet, waehrend die Anwendung sich darauf verlaesst,
-- ist schlechter als ein Dienst, der mit einer klaren Meldung stehen bleibt.
--
-- Nach den Schritten 1 und 2 ist der Fall unerreichbar; der Waechter ist die
-- Sicherung, nicht der Regelweg.
DO $$
DECLARE
  offen INT;
BEGIN
  SELECT count(*) INTO offen FROM projects WHERE projektnummer IS NULL OR btrim(projektnummer) = '';
  IF offen > 0 THEN
    RAISE EXCEPTION 'Migration 054: % Projekt(e) ohne brauchbare Nummer. Bitte nachtragen.', offen;
  END IF;

  ALTER TABLE projects ALTER COLUMN projektnummer SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'projects_projektnummer_nicht_leer' AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_projektnummer_nicht_leer
      CHECK (btrim(projektnummer) <> '');
  END IF;
END $$;

-- ── 5. Auffaellige Reste melden, nicht anfassen ────────────────────────────
--
-- Nummern, die laenger als 60 Zeichen sind oder Steuerzeichen enthalten,
-- lehnt `pruefeProjektnummer` ab. Sie hier abzuschneiden waere eine stille
-- Aenderung an einer Aktennummer — das entscheidet das Buero, nicht die
-- Migration. Betroffen ist nur, wer die NUMMER selbst aendern will; alle
-- uebrigen Stammdaten bleiben bearbeitbar.
DO $$
DECLARE
  auffaellig TEXT;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name)
    INTO auffaellig
    FROM projects
   WHERE length(projektnummer) > 60
      OR projektnummer ~ '[[:cntrl:]]';
  IF auffaellig IS NOT NULL THEN
    RAISE WARNING 'Migration 054: Projektnummern, die die Anwendung ablehnen wuerde (zu lang oder mit Steuerzeichen): %. Bitte im Programm korrigieren.', auffaellig;
  END IF;
END $$;
