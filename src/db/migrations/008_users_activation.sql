-- ============================================================
-- Bau-OS — Users-Tabelle aktivieren, is_protected, Pair-Tokens
-- ============================================================
-- Bisher hat Bau-OS Auth aus users.json gelesen. Ab dieser Migration
-- wird die users-Tabelle (existiert seit 001_init.sql) aktiv genutzt:
--
--   - Web-Setup-Wizard legt den Erst-Admin direkt in der DB an
--   - users.json bleibt als Fallback bestehen, wird aber ignoriert,
--     sobald mindestens ein User in der DB existiert
--
-- Neu in dieser Migration:
--   - is_protected BOOLEAN — markiert den Erst-Admin, der NICHT
--     geloescht oder herabgestuft werden kann (Schutz gegen versehent-
--     liches Aussperren der gesamten Firma)
--   - telegram_pair_tokens — kurzlebige Tokens fuer Self-Pairing eines
--     Telegram-Chats mit einem User-Account (Phase 5).
--     telegram_chat_id existiert bereits in users (BIGINT), wird wie
--     bisher genutzt.
--
-- Idempotent: kann mehrfach laufen ohne Fehler.
-- ============================================================

-- 1) is_protected-Flag --------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false;

-- Partial-Index hilft bei "letzter Admin"-Checks und beim Enforcement,
-- dass es immer mindestens einen geschuetzten Admin geben muss.
CREATE INDEX IF NOT EXISTS idx_users_protected ON users(is_protected) WHERE is_protected;

-- 2) Telegram-Pair-Tokens ----------------------------------------------------
-- Kurzlebige Tokens — werden im Admin-UI generiert und vom User per
-- /pair <token> beim Bot eingeloest. Nach Einloesung oder Ablauf weg.
CREATE TABLE IF NOT EXISTS telegram_pair_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_pair_tokens_user    ON telegram_pair_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_pair_tokens_expires ON telegram_pair_tokens(expires_at);

-- 3) Cleanup-Helper-View fuer abgelaufene Pair-Tokens (Phase 5 Bot ruft das) -
-- Kein automatischer Cron — Bot loescht Tokens entweder bei Einloesung oder
-- bei der naechsten Pair-Anfrage (Lazy-Cleanup).
