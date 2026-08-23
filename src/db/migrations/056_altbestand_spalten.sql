-- ============================================================
-- 056 — Die letzten Spalten der Bot- und Outlook-Aera
-- ============================================================
-- Migration 047 hat die TABELLEN der beiden abgeschalteten Anbindungen
-- abgeraeumt. Die SPALTEN, die dieselben Anbindungen an bestehende Tabellen
-- gehaengt hatten, sind dabei stehen geblieben:
--
--   users.telegram_chat_id, telegram_bot_token, telegram_bot_enabled  (aus 002/003)
--   termine.ms_event_id, ms_calendar_id, ms_etag, ms_last_sync_at,
--          ms_sync_status, ms_source, ms_owner_user_id                (aus 023)
--
-- Keine Zeile Code liest oder schreibt sie mehr. Wer heute das Schema oder
-- `types.ts` liest, haelt einen Telegram-Bot und einen Outlook-Abgleich fuer
-- vorhanden — beide sind mit AP0 entfallen.
--
-- ── Warum ein DROP hier vertretbar ist, in 047 aber nicht ──────────────────
--
-- 047 hat ganze Tabellen genommen; deren Inhalt waere unwiederbringlich
-- gewesen, deshalb dort die Bedingung „nur wenn leer". Hier faellt kein
-- Datensatz, sondern ein Feld an einem Datensatz, der bleibt. Trotzdem
-- dieselbe Vorsicht: gefuellte Spalten bleiben stehen und melden sich.
--
-- ── Der Grund, warum das Token besonders behandelt wird ────────────────────
--
-- `telegram_bot_token` ist ein GEHEIMNIS im Klartext. Es beim Aufraeumen still
-- mitzunehmen waere das Gegenteil von sauber: wer es einmal vergeben hat, muss
-- es WIDERRUFEN, nicht loeschen. Steht dort noch etwas, bleibt die Spalte, und
-- die Meldung sagt genau das.
--
-- Wiederholbar: ein zweiter Lauf findet nichts mehr vor und tut nichts.
-- ============================================================

-- ── 1. Termine: die sieben Outlook-Spalten ─────────────────────────────────
DO $$
DECLARE
  spalte TEXT;
  belegt BIGINT;
  offen  TEXT[] := '{}';
BEGIN
  IF to_regclass('public.termine') IS NULL THEN
    RETURN;
  END IF;

  FOREACH spalte IN ARRAY ARRAY[
    'ms_event_id', 'ms_calendar_id', 'ms_etag', 'ms_last_sync_at',
    'ms_sync_status', 'ms_source', 'ms_owner_user_id'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'termine' AND column_name = spalte
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM termine WHERE %I IS NOT NULL', spalte) INTO belegt;

    IF belegt = 0 THEN
      EXECUTE format('ALTER TABLE termine DROP COLUMN %I', spalte);
    ELSE
      offen := array_append(offen, spalte || ' (' || belegt || ' Zeilen)');
    END IF;
  END LOOP;

  IF array_length(offen, 1) > 0 THEN
    RAISE NOTICE
      'termine: NICHT entfernt, weil befuellt: %. Die Spalten werden von keiner Zeile Code mehr gelesen.',
      array_to_string(offen, ', ');
  END IF;
END $$;

-- Die Indizes aus 023 fallen mit ihren Spalten; die verbliebenen aufraeumen.
DROP INDEX IF EXISTS idx_termine_ms_event_id;
DROP INDEX IF EXISTS idx_termine_ms_sync_status;
DROP INDEX IF EXISTS idx_termine_ms_owner;

-- ── 2. Users: die drei Bot-Spalten ─────────────────────────────────────────
DO $$
DECLARE
  belegt BIGINT;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RETURN;
  END IF;

  -- Index und Unique-Constraint muessen VOR den Spalten fallen.
  DROP INDEX IF EXISTS idx_users_bot_token;
  ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_telegram_chat_id;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'users' AND column_name = 'telegram_bot_token') THEN
    SELECT count(*) INTO belegt FROM users WHERE telegram_bot_token IS NOT NULL;
    IF belegt = 0 THEN
      ALTER TABLE users DROP COLUMN telegram_bot_token;
    ELSE
      RAISE NOTICE
        'users.telegram_bot_token: % Zeile(n) tragen noch ein Token im Klartext. Die Spalte bleibt stehen. '
        'Das Token bitte beim Anbieter WIDERRUFEN und die Spalte danach von Hand entfernen: '
        'ALTER TABLE users DROP COLUMN telegram_bot_token;', belegt;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'users' AND column_name = 'telegram_chat_id') THEN
    SELECT count(*) INTO belegt FROM users WHERE telegram_chat_id IS NOT NULL;
    IF belegt = 0 THEN
      ALTER TABLE users DROP COLUMN telegram_chat_id;
    ELSE
      RAISE NOTICE 'users.telegram_chat_id: % Zeile(n) befuellt, Spalte bleibt stehen.', belegt;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'users' AND column_name = 'telegram_bot_enabled') THEN
    -- Ein boolescher Schalter ohne Bot ist auch dann bedeutungslos, wenn er
    -- auf `true` steht; hier gibt es nichts zu bewahren.
    ALTER TABLE users DROP COLUMN telegram_bot_enabled;
  END IF;
END $$;
