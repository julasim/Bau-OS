-- ============================================================
-- Bau-OS — Migration 033: Chat-Sessions in DB + Sharing
-- ============================================================

-- A) user_id auf chat_sessions (bisher nur im FS-Chat gespeichert)
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);

-- B) file_shares existiert bereits ab Migration 009 — kein CREATE noetig.

-- C) Chat-Session-Sharing: wer darf eine Session (zusaetzlich zum Ersteller) lesen
CREATE TABLE IF NOT EXISTS chat_session_shares (
  session_id UUID    NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id    UUID    NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_session_shares_user ON chat_session_shares(user_id);
