-- ============================================================
-- 060 — termine.datum wird ein echtes Datum
-- ============================================================
-- `termine.datum` war seit `001_init.sql` eine TEXT-Spalte. Sie ist damit die
-- EINZIGE Datumsspalte des Hauses, die der Regel aus `src/data/zeitstempel.ts`
-- nicht folgt — und in ihr standen drei Schreibweisen nebeneinander:
--
--   * `TT.MM.JJJJ`      aus `db-termine.ts` (der Normalfall)
--   * `YYYY-MM-DD`      aus dem Auto-Meilenstein in `db-phases.ts`
--   * alles Uebrige     aus `scripts/import-vault.ts`, das nie geprueft hat
--
-- ── Was daran kaputt war, und zwar sichtbar ────────────────────────────────
--
-- Das Board im Besprechungsraum vergleicht `t.datum = <heute als ISO>`. Gegen
-- `15.09.2026` trifft das nie zu. **Kein von Hand angelegter Termin ist je auf
-- dem Board erschienen** — und weil es niemals einen Fehler warf, sah es aus
-- wie ein ruhiger Tag im Buero.
--
-- (Genau genommen erschienen die Auto-Meilensteine aus `db-phases.ts` sehr
-- wohl: die stehen seit jeher in ISO in derselben Spalte und trafen den
-- Vergleich. Hier stand zwischenzeitlich „keinen einzigen Termin" — das war
-- zu absolut und wird von der Liste drei Zeilen darueber selbst widerlegt.)
--
-- Ebenso: die Wochenansicht, die naechste Frist im Portfolio und der naechste
-- Termin in der Projektakte. Alle vier vergleichen Zeichenketten, und eine
-- Zeichenkette, die mit dem TAG beginnt, sortiert nach Tag-im-Monat.
--
-- ── Warum das nicht teilbar ist ────────────────────────────────────────────
--
-- Schema ohne Code ergibt `22007 invalid input syntax for type date`, Code
-- ohne Schema laesst die Vergleiche weiter ins Leere laufen. Migration und
-- Programm gehoeren in denselben Auslieferungsstand.
--
-- ⚠ **Nach dieser Migration ist ein Zurueckrollen des Programms allein nicht
-- moeglich.** Migrationen sind forward-only; der Rueckweg ist `restore.sh` mit
-- der Sicherung von vor dem Update. Das steht so in `docs/betrieb/updates.md`.
--
-- ── Warum unlesbare Zeilen gerettet und nicht abgewiesen werden ────────────
--
-- Diese Migration laeuft beim START des Dienstes (`DB_AUTO_MIGRATE`), auf
-- einem Rechner ohne Internet, an dem morgens ein Buero arbeiten will. Ein
-- `ALTER`, das an einer einzigen unlesbaren Zeile abbricht, heisst: das Buero
-- steht, und niemand ist da, der es aufmacht.
--
-- Deshalb wandern solche Zeilen in den Papierkorb (Migration 049) — mit ihrem
-- ROHWERT im Text. Nichts geht verloren, nichts wird erfunden, und das
-- Startprotokoll nennt jede betroffene Zeile mit ID.
--
-- ⚠ ── Und warum die Erkennung ueber eine Funktion laeuft ───────────────────
--
-- Weil die naheliegende Form beim ersten Prueflauf **an genau den Zeilen
-- gestorben ist, die sie finden sollte**. `to_date('31.02.2026','DD.MM.YYYY')`
-- wirft in PostgreSQL 16 `date/time field value out of range` — und der
-- Ausdruck laeuft, denn das Muster `\d{2}\.\d{2}\.\d{4}` passt ja. Eine
-- Klassifikation mit `count(*) FILTER (WHERE … to_date(…) …)` bricht damit
-- ab, bevor sie irgendetwas gemeldet hat: aus der Migration, die einen
-- Startabbruch verhindern soll, waere die Ursache dafuer geworden.
--
-- `m060_datum()` faengt den Fehler ab und liefert NULL. Der zusaetzliche
-- Rueckweg-Vergleich deckt die andere moegliche Treiberform ab — aeltere
-- PostgreSQL-Staende biegen `31.02.` still auf den 3. Maerz zurecht, statt zu
-- werfen. Beide Verhalten fuehren hier zu NULL, also in den Papierkorb.
--
-- Wiederholbar: ist die Spalte schon `date`, tut ein zweiter Lauf nichts.
-- ============================================================

-- ── 0. Der Umwandler, der nicht wirft ──────────────────────────────────────
--
-- Liegt in `pg_temp`: er wird nur waehrend dieser Migration gebraucht und
-- verschwindet mit der Sitzung. Eine dauerhafte Funktion waere Altbestand ab
-- dem Tag ihrer Entstehung.
CREATE FUNCTION pg_temp.m060_datum(roh TEXT) RETURNS date AS $fn$
DECLARE d date;
BEGIN
  IF roh ~ '^\d{4}-\d{2}-\d{2}$' THEN
    d := to_date(roh, 'YYYY-MM-DD');
    IF to_char(d, 'YYYY-MM-DD') <> roh THEN RETURN NULL; END IF;
  ELSIF roh ~ '^\d{2}\.\d{2}\.\d{4}$' THEN
    d := to_date(roh, 'DD.MM.YYYY');
    IF to_char(d, 'DD.MM.YYYY') <> roh THEN RETURN NULL; END IF;
  ELSE
    RETURN NULL;
  END IF;
  RETURN d;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

-- ── 1. Bestandsaufnahme und Rettung ────────────────────────────────────────
DO $$
DECLARE
  typ      TEXT;
  n_de     BIGINT;
  n_iso    BIGINT;
  n_kaputt BIGINT;
  liste    TEXT;
BEGIN
  SELECT data_type INTO typ
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'termine' AND column_name = 'datum';

  IF typ IS NULL THEN
    RAISE NOTICE '060: Tabelle termine oder Spalte datum fehlt — nichts zu tun.';
    RETURN;
  END IF;

  IF typ = 'date' THEN
    RAISE NOTICE '060: termine.datum ist bereits date — nichts zu tun.';
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE datum ~ '^\d{2}\.\d{2}\.\d{4}$' AND pg_temp.m060_datum(datum) IS NOT NULL),
         count(*) FILTER (WHERE datum ~ '^\d{4}-\d{2}-\d{2}$'   AND pg_temp.m060_datum(datum) IS NOT NULL),
         count(*) FILTER (WHERE pg_temp.m060_datum(datum) IS NULL)
    INTO n_de, n_iso, n_kaputt
    FROM termine;

  RAISE NOTICE '060: % Termine deutsch, % in ISO, % unlesbar.', n_de, n_iso, n_kaputt;

  IF n_kaputt > 0 THEN
    SELECT string_agg(id::text || ' = ' || quote_literal(datum), ', ')
      INTO liste
      FROM termine WHERE pg_temp.m060_datum(datum) IS NULL;

    RAISE WARNING '060: diese Termine wandern in den Papierkorb (Datum unlesbar): %', liste;

    -- Der Rohwert wandert in den TEXT — sonst waere er nach dem ALTER weg,
    -- und niemand koennte den Eintrag von Hand richtigstellen.
    --
    -- Das Datum wird hier noch im ALTEN Format geschrieben: die Spalte ist an
    -- dieser Stelle Text, das ALTER kommt erst darunter.
    UPDATE termine
       SET text       = text || ' [Datum unlesbar bei Migration 060: ' || quote_literal(datum) || ']',
           datum      = to_char(CURRENT_DATE, 'DD.MM.YYYY'),
           deleted_at = COALESCE(deleted_at, now())
     WHERE pg_temp.m060_datum(datum) IS NULL;
  END IF;
END $$;

-- ── 2. Der Typwechsel ──────────────────────────────────────────────────────
--
-- `idx_termine_datum` wird von Postgres beim Typwechsel selbst neu gebaut —
-- das fehlende Index-DDL ist Absicht, kein Versehen.
DO $$
DECLARE rest BIGINT;
BEGIN
  -- ⚠ `IS DISTINCT FROM` und nicht `<>`.
  --
  -- Fehlt die Tabelle, liefert die Unterabfrage NULL — und `NULL <> 'text'`
  -- ist NICHT wahr, sondern NULL. Das `IF` haette dann nicht gefeuert, das
  -- `RETURN` waere ausgeblieben, und der Block waere in
  -- `SELECT count(*) FROM termine` gelaufen: `relation "termine" does not
  -- exist`, Migration gescheitert, Dienst startet nicht.
  --
  -- Schritt 1 faengt denselben Fall sauber ab (`IF typ IS NULL`) und meldet
  -- „nichts zu tun" — die Migration haette also erst versprochen, dass sie
  -- diesen Weg kennt, und ihn zwei Bloecke spaeter gebrochen. Am 01.09.2026
  -- an einer Datenbank ohne die Tabelle nachgestellt.
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'termine' AND column_name = 'datum')
     IS DISTINCT FROM 'text'
  THEN
    RETURN;
  END IF;

  -- Guertel und Hosentraeger: Schritt 1 hat jede unlesbare Zeile geraeumt.
  -- Findet sich hier trotzdem eine, wird sie benannt, statt dass das ALTER
  -- mit einer Postgres-Meldung ohne Zeilenbezug abbricht.
  SELECT count(*) INTO rest FROM termine WHERE pg_temp.m060_datum(datum) IS NULL;
  IF rest > 0 THEN
    RAISE EXCEPTION '060: % Termine haben weiterhin ein unlesbares Datum — Abbruch vor dem Typwechsel.', rest;
  END IF;

  ALTER TABLE termine
    ALTER COLUMN datum TYPE date
    USING pg_temp.m060_datum(datum);

  RAISE NOTICE '060: termine.datum ist jetzt date.';
END $$;

-- Der Kommentar steht in einem DO-Block, weil `COMMENT ON COLUMN` auf einer
-- fehlenden Tabelle ebenfalls scheitert — und diese Migration soll auf einer
-- Datenbank ohne `termine` NICHTS tun, nicht den Start verhindern.
DO $$
BEGIN
  IF to_regclass('public.termine') IS NOT NULL THEN
    COMMENT ON COLUMN termine.datum IS
      'Datum des Termins. Bis Migration 060 (01.09.2026) eine TEXT-Spalte, in der drei Schreibweisen nebeneinander standen.';
  END IF;
END $$;
