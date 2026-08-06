-- ============================================================
-- 047 — Tabellen aus der Bot- und Outlook-Aera entfernen
-- ============================================================
-- Sieben Tabellen sind mit AP0 funktionslos geworden. Kein Code liest oder
-- schreibt sie mehr (nachgezaehlt: null Treffer ausserhalb der Migrationen):
--
--   chat_sessions, chat_messages, chat_session_shares
--     → der Telegram-/LLM-Chat der Bot-Aera
--   agent_logs
--     → Protokoll der Agenten-Laufzeit
--   user_microsoft_accounts, user_microsoft_calendars
--     → der Outlook-Abgleich (Migrationen 022 und 024)
--
-- Sie kosten nichts, aber sie kosten Verstaendnis: wer das Schema liest, haelt
-- Funktionen fuer vorhanden, die es nicht gibt — und beim naechsten
-- `pg_dump` wandern sie in jede Sicherung.
--
-- ── Warum diese Migration keine Daten vernichten kann ───────────────────────
--
-- Ein blankes `DROP TABLE` waere unumkehrbar. Migrationen laufen automatisch
-- beim Start, auch auf Datenbanken, die niemand vorher angesehen hat — und auf
-- einer davon koennte in `chat_messages` durchaus noch Gespraechsverlauf aus
-- der Bot-Zeit liegen.
--
-- Deshalb faellt hier jede Tabelle NUR, wenn sie leer ist. Steht auch nur eine
-- Zeile drin, bleibt sie unangetastet und meldet sich im Migrationsprotokoll.
-- Dann entscheidet ein Mensch, ob der Inhalt weg darf — nicht ein Skript, das
-- um drei Uhr nachts durchlaeuft.
--
-- Das macht die Migration zugleich wiederholbar: ein zweiter Lauf findet
-- nichts mehr vor und tut nichts.
-- ============================================================

DO $$
DECLARE
  t   TEXT;
  n   BIGINT;
  offen TEXT[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'chat_session_shares',       -- zuerst: haengt per FK an chat_sessions
    'chat_messages',
    'chat_sessions',
    'agent_logs',
    'user_microsoft_calendars',  -- zuerst: haengt per FK an accounts
    'user_microsoft_accounts'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;  -- gibt es auf dieser Datenbank gar nicht
    END IF;

    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;

    IF n = 0 THEN
      EXECUTE format('DROP TABLE %I CASCADE', t);
      RAISE NOTICE 'Tabelle % entfernt (war leer).', t;
    ELSE
      offen := array_append(offen, t || ' (' || n || ' Zeilen)');
    END IF;
  END LOOP;

  IF array_length(offen, 1) > 0 THEN
    RAISE NOTICE
      'NICHT entfernt, weil nicht leer: %. Die Tabellen werden von keiner Zeile Code mehr gelesen. '
      'Wer den Inhalt nicht braucht, kann sie von Hand loeschen: DROP TABLE <name> CASCADE;',
      array_to_string(offen, ', ');
  END IF;
END $$;
