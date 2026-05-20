-- ============================================================
-- PATIO — Migration 034: chat_messages.session_id TEXT -> UUID
-- ============================================================
--
-- Bug: chat_messages.session_id wurde in 001_init.sql als TEXT
-- angelegt, chat_sessions.id ist aber UUID (002_chat_sessions.sql).
-- Solange der Web-Chat im Dateisystem lag, fiel das nicht auf. Seit
-- 033_chat_db_sharing.sql laeuft der Chat ueber die DB -- und jeder
-- JOIN chat_messages.session_id = chat_sessions.id wirft
--   "operator does not exist: text = uuid".
-- Folge: dbChat.listSessions() crasht, die Chat-Seitenleiste im WebUI
-- bleibt leer, und der Auto-Title-Check in addMessage() schlaegt still
-- fehl (Titel bleibt "Neuer Chat").
--
-- Fix: Spalte auf UUID umstellen + den fehlenden Foreign Key auf
-- chat_sessions setzen. Bestehende Werte stammen aus chat_sessions.id
-- und sind damit gueltige UUIDs -- der USING-Cast greift sauber.

-- 1) Verwaiste Messages entfernen (session_id ohne passende Session) --
--    sonst scheitert der FK-Constraint weiter unten.
DELETE FROM chat_messages
 WHERE session_id NOT IN (SELECT id::text FROM chat_sessions);

-- 2) Spaltentyp TEXT -> UUID. Guard: nur ausfuehren, wenn noch TEXT.
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
     WHERE table_name = 'chat_messages' AND column_name = 'session_id'
  ) = 'text' THEN
    ALTER TABLE chat_messages
      ALTER COLUMN session_id TYPE UUID USING session_id::uuid;
  END IF;
END $$;

-- 3) Fehlenden Foreign Key ergaenzen (war in 001 nie gesetzt). Mit
--    ON DELETE CASCADE werden Messages beim Loeschen einer Session
--    automatisch mitgeloescht.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_messages_session'
  ) THEN
    ALTER TABLE chat_messages
      ADD CONSTRAINT fk_chat_messages_session
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;
  END IF;
END $$;
