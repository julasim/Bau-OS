-- ============================================================
-- Bau-OS — Per-User Telegram-Bots
-- ============================================================
-- Bisher: ein gemeinsamer BOT_TOKEN aus der env, alle User pairen ihre
-- Chat-ID dazu (Phase 5).
-- Ab jetzt: jeder User kann seinen eigenen Bot via @BotFather anlegen
-- und das Token im Web eintragen. Sein Bot ist nur fuer ihn da, alle
-- LLM-Tools laufen automatisch mit seinem User-Kontext.
--
-- Der env-BOT_TOKEN bleibt als Default-Bot bestehen — fuer Setups die
-- noch nicht migriert sind oder einen "shared" Admin-Bot wollen.
--
-- telegram_bot_token wird im Klartext gespeichert. Begruendung: die DB
-- ist firm-intern, der Token erlaubt nur Bot-API-Calls (nicht User-Auth).
-- Encryption-at-rest kann spaeter via pgcrypto nachgeruestet werden.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT,
  ADD COLUMN IF NOT EXISTS telegram_bot_enabled BOOLEAN NOT NULL DEFAULT true;

-- Lookups laufen ueber bot_token (z.B. Bot-Manager startet alle aktiven
-- Bots beim Boot). Index spart einen Sequential-Scan, auch wenn die
-- Tabelle klein bleibt.
CREATE INDEX IF NOT EXISTS idx_users_bot_token
  ON users(telegram_bot_token)
  WHERE telegram_bot_token IS NOT NULL;
