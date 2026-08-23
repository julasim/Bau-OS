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

-- ── 1. Bestand auffuellen ───────────────────────────────────────────────────
-- Eindeutig von Bauart wegen der UUID im Platzhalter.
UPDATE projects
   SET projektnummer = 'OHNE-NUMMER-' || left(id::text, 8)
 WHERE projektnummer IS NULL OR btrim(projektnummer) = '';

-- ── 2. Eindeutigkeit ────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_projektnummer_eindeutig
  ON projects (lower(projektnummer));

-- Der einfache Index aus Migration 004 bleibt bewusst stehen. Der neue liegt
-- auf `lower(projektnummer)` und hilft nur Abfragen, die ebenfalls `lower()`
-- benutzen — ein schlichtes `WHERE projektnummer = 'SAZTG-2026-014'` faellt
-- durch. Ihn hier wegzuwerfen waere eine Aufraeumaktion mit Nebenwirkung und
-- ohne Gewinn: ein Btree auf einer kurzen Textspalte kostet fast nichts.

-- ── 3. Pflicht ──────────────────────────────────────────────────────────────
-- Nur setzen, wenn Schritt 1 wirklich alles erwischt hat. Auf einer fremden
-- Datenbank kann etwas stehen, das hier niemand kennt; dann soll die
-- Migration durchlaufen und die Daten in Ruhe lassen, statt den Start des
-- Dienstes zu verhindern. Dieselbe Vorsicht wie in 051.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE projektnummer IS NULL) THEN
    ALTER TABLE projects ALTER COLUMN projektnummer SET NOT NULL;
  END IF;
END $$;

-- ── 4. Leerer Text ist keine Nummer ─────────────────────────────────────────
-- NOT NULL allein laesst `''` durch, und ein leerer String waere genau die
-- Luecke, die Schritt 1 gerade geschlossen hat — nur unsichtbar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_projektnummer_nicht_leer')
     AND NOT EXISTS (SELECT 1 FROM projects WHERE btrim(projektnummer) = '')
  THEN
    ALTER TABLE projects ADD CONSTRAINT projects_projektnummer_nicht_leer
      CHECK (btrim(projektnummer) <> '');
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
