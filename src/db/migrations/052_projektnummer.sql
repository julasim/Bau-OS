-- ============================================================
-- 052 — Die Projektnummer wird zur Kennung
-- ============================================================
-- Bis hierher war `projects.projektnummer` ein optionales Freitextfeld unter
-- den Stammdaten (Migration 004): nullable, nicht eindeutig, an drei Stellen
-- angezeigt und sonst folgenlos. Ab hier ist sie die Kennung, unter der ein
-- Projekt im Haus gefuehrt wird — im Buero von Julius Sima in der Form
-- `SAZTG-2026-000`, immer von Hand vergeben.
--
-- ── Was sie NICHT wird ──────────────────────────────────────────────────────
--
-- Sie wird **nicht** der Primaerschluessel. `projects.id` (UUID) bleibt der
-- interne Schluessel, an dem zwoelf Tabellen haengen — Aufgaben, Notizen,
-- Termine, Dateien, Phasen, Rechnungen, Zeiten und die uebrigen. Die
-- Projektnummer loest die UUID nur NACH AUSSEN ab: in Verweisen, Abfragen,
-- Adressen und Exporten.
--
-- Der Grund ist der Tippfehler. Eine von Hand vergebene Kennung wird
-- korrigiert — spaetestens beim ersten Zahlendreher. Waere sie der
-- Primaerschluessel, muesste diese Korrektur zwoelf Tabellen mitziehen, und
-- solange das laeuft, ist der Bestand angreifbar. So kostet dieselbe
-- Korrektur ein UPDATE auf eine Zeile, und kein einziger Verweis bricht.
--
-- ── Warum die Eindeutigkeit auf `lower()` liegt ─────────────────────────────
--
-- Gemessen an einer Probe: ohne `lower()` sind `SAZTG-2026-001` und
-- `saztg-2026-001` zwei verschiedene Projekte. Das sind sie fuer die
-- Datenbank, aber fuer niemanden sonst — und die beiden nebeneinander in
-- einer Liste zu sehen, waere der Anfang einer langen Fehlersuche.
--
-- ── Warum die Eindeutigkeit auch fuer den Papierkorb gilt ───────────────────
--
-- Der Index hat bewusst KEIN `WHERE deleted_at IS NULL`. Mit dieser
-- Einschraenkung gaebe ein geloeschtes Projekt seine Nummer frei — und das
-- Zurueckholen aus dem Papierkorb scheiterte in dem Moment, in dem die Nummer
-- inzwischen neu vergeben wurde. Eine Wiederherstellung, die fehlschlagen
-- kann, ist schlimmer als eine Nummer, die bis zum endgueltigen Entfernen
-- belegt bleibt: das eine ist Datenverlust, das andere eine Erklaerung.
--
-- ── Der Bestand ─────────────────────────────────────────────────────────────
--
-- Projekte ohne Nummer bekommen einen Platzhalter, damit die Spalte
-- anschliessend NOT NULL werden kann. Der Platzhalter ist bewusst so gebaut,
-- dass ihn niemand fuer eine Aktennummer haelt (`OHNE-NUMMER-<id>`) — die
-- Oberflaeche erkennt ihn und verlangt eine echte Nummer. Erfunden wird
-- nichts: eine Projektnummer ist eine Angabe des Bueros, kein Rechenergebnis.
-- ============================================================

-- ── 1. Bestand auffuellen UND bereinigen ────────────────────────────────────
--
-- Zwei Dinge in einem Schritt, und der zweite ist der wichtigere:
--
-- **Auffuellen.** Projekte ohne Nummer bekommen einen Platzhalter, damit die
-- Spalte anschliessend NOT NULL werden kann. Eindeutig von Bauart wegen der
-- UUID darin.
--
-- **Bereinigen.** Der Bestand wird genauso normalisiert, wie es die Anwendung
-- mit jeder Neueingabe tut (`pruefeProjektnummer` in
-- src/data/projektnummer.ts): Leerraum am Rand weg, mehrfacher Leerraum in
-- der Mitte zusammengezogen.
--
-- Ohne diesen zweiten Teil laufen Migration und Anwendung auseinander, und
-- der eindeutige Index unten faengt den Unterschied NICHT. Nachgemessen an
-- einer frisch migrierten Datenbank:
--
--     name | gespeichert       | index_wert
--     alt  | [ SAZTG-2026-001] |  saztg-2026-001
--     neu  | [SAZTG-2026-001]  | saztg-2026-001
--
-- Zwei Projekte, fuer jeden Menschen dieselbe Aktennummer, fuer den Index
-- zwei verschiedene. Genau der Fall, den 052 verhindern soll.
UPDATE projects
   SET projektnummer = regexp_replace(btrim(projektnummer), '\s+', ' ', 'g')
 WHERE projektnummer IS NOT NULL
   AND projektnummer <> regexp_replace(btrim(projektnummer), '\s+', ' ', 'g');

UPDATE projects
   SET projektnummer = 'OHNE-NUMMER-' || left(id::text, 8)
 WHERE projektnummer IS NULL OR projektnummer = '';

-- ── 2. Eindeutigkeit ────────────────────────────────────────────────────────
--
-- Vorher pruefen und mit Klartext scheitern. `CREATE UNIQUE INDEX` allein
-- meldet nur „duplicate key value violates unique constraint" und nennt EINE
-- Kollision; wer dann eine Datenbank mit zweihundert Projekten vor sich hat,
-- sucht die uebrigen von Hand.
--
-- Scheitern ist hier ausdruecklich richtig — anders als bei den weichen
-- Bedingungen in Migration 051. Die Eindeutigkeit IST das Vorhaben; eine
-- Datenbank, die ohne sie startet, waehrend die Anwendung sich auf sie
-- verlaesst, ist schlechter als ein Dienst, der mit einer klaren Meldung
-- stehen bleibt. Die Migration laeuft in einer Transaktion (src/db/migrate.ts)
-- — das Schema bleibt beim Abbruch unversehrt.
DO $$
DECLARE
  dubletten TEXT;
BEGIN
  SELECT string_agg(t.nr || ' (' || t.anzahl || 'x)', ', ')
    INTO dubletten
    FROM (
      SELECT lower(projektnummer) AS nr, count(*) AS anzahl
        FROM projects
       GROUP BY lower(projektnummer)
      HAVING count(*) > 1
    ) t;
  IF dubletten IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 052: mehrfach vergebene Projektnummern gefunden: %. Bitte in der Datenbank vereindeutigen und den Dienst erneut starten.',
      dubletten;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_projektnummer_eindeutig
  ON projects (lower(projektnummer));

-- Der einfache Index aus Migration 004 bleibt bewusst stehen. Der neue liegt
-- auf `lower(projektnummer)` und hilft nur Abfragen, die ebenfalls `lower()`
-- benutzen — ein schlichtes `WHERE projektnummer = 'SAZTG-2026-014'` faellt
-- durch. Ihn hier wegzuwerfen waere eine Aufraeumaktion mit Nebenwirkung und
-- ohne Gewinn: ein Btree auf einer kurzen Textspalte kostet fast nichts.

-- ── 3. Pflicht ──────────────────────────────────────────────────────────────
--
-- Der Guard ist nach Schritt 1 eigentlich unerreichbar — er bleibt als
-- Sicherung. Wenn er DOCH greift, darf das nicht still passieren: der Runner
-- schreibt den Dateinamen anschliessend in `_migrations`, ein zweiter Lauf
-- holt nichts nach, und zurueck bliebe eine Datenbank, in der die Pflicht nur
-- noch im Anwendungscode steht. Ein Unique-Index laesst beliebig viele NULL
-- zu — die Luecke waere also nicht einmal an doppelten Nummern zu erkennen.
DO $$
DECLARE
  offen INT;
BEGIN
  SELECT count(*) INTO offen FROM projects WHERE projektnummer IS NULL;
  IF offen = 0 THEN
    ALTER TABLE projects ALTER COLUMN projektnummer SET NOT NULL;
  ELSE
    RAISE WARNING
      'Migration 052: % Projekt(e) ohne Nummer — NOT NULL NICHT gesetzt. Die Pflicht gilt nur noch in der Anwendung; bitte nachtragen und eine Folge-Migration setzen.',
      offen;
  END IF;
END $$;

-- ── 4. Leerer Text ist keine Nummer ─────────────────────────────────────────
-- NOT NULL allein laesst `''` durch, und ein leerer String waere genau die
-- Luecke, die Schritt 1 gerade geschlossen hat — nur unsichtbar.
--
-- Der Guard prueft `conrelid` mit: `conname` allein ist in Postgres NICHT
-- eindeutig, eine gleichnamige Bedingung an einer anderen Tabelle liesse
-- diesen Schritt stillschweigend ausfallen.
DO $$
DECLARE
  leere INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'projects_projektnummer_nicht_leer'
       AND conrelid = 'projects'::regclass
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO leere FROM projects WHERE btrim(projektnummer) = '';
  IF leere = 0 THEN
    ALTER TABLE projects ADD CONSTRAINT projects_projektnummer_nicht_leer
      CHECK (btrim(projektnummer) <> '');
  ELSE
    RAISE WARNING 'Migration 052: % Projekt(e) mit leerer Nummer — CHECK NICHT gesetzt.', leere;
  END IF;
END $$;

-- ── 5. Suche nach Nummernteilen ─────────────────────────────────────────────
-- Die Volltextsuche (Migration 048) hat die Projektnummer bereits im Griff:
-- `such_text` ist eine GENERATED-Spalte und enthaelt `projektnummer` seit
-- jeher. Sie deckt aber nur ganze Woerter ab.
--
-- Gemessen an `to_tsvector('german', 'SAZTG-2026-014')`:
--
--     'saztg':1  '-2026':2  '-014':3
--
-- Damit findet die Volltextsuche `SAZTG-2026-014`, `SAZTG` und `SAZTG-2026` —
-- aber NICHT `2026-014`. Und genau so tippt jemand, der das Buerokuerzel
-- weglaesst, weil es ohnehin bei jedem Projekt gleich ist.
--
-- Fuer solche Teilstuecke ist ILIKE zustaendig; Migration 048 haelt das in
-- ihrem Kommentar ausdruecklich fest („wer 2026-01 tippt, meint einen
-- Nummernanfang, keinen Wortstamm") und legt fuer `projects.name` einen
-- Trigramm-Index an. Fuer `projektnummer` fehlte er — ohne ihn liefe die
-- Teilstueck-Suche als sequenzieller Scan ueber die Tabelle.
CREATE INDEX IF NOT EXISTS idx_projects_projektnummer_trgm
  ON projects USING GIN (projektnummer gin_trgm_ops);
