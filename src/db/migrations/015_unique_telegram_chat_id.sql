-- ============================================================
-- PATIO — UNIQUE-Constraint auf users.telegram_chat_id
-- ============================================================
-- Bug-Report: zwei PATIO-User waren versehentlich an dieselbe
-- Telegram-Chat-ID gepaired (admin + Test 1 → 5606448807).
-- Konsequenzen:
--   - Notifications fuer Empfaenger A landen bei Telegram-Account B
--     (oder umgekehrt) — Datenleck.
--   - findDbUserByChatId waehlt willkuerlich einen, der Bot reagiert
--     dann auf Nachrichten als "falscher" User.
--   - Sicherheitsrisiko: jemand koennte einen Pair-Code abfangen und
--     mit eigenem Telegram-Account einlösen → der ursprüngliche User
--     waere abgekoppelt, ohne es zu merken.
--
-- Diese Migration:
--   1) Loest existierende Duplikate auf — behaelt den User mit der
--      kleinsten id (deterministisch), setzt alle anderen Duplikate
--      in der Gruppe auf NULL. Diese User muessen neu pairen.
--   2) Setzt UNIQUE-Index (partial, nur NOT NULL) — verhindert
--      kuenftige Duplikate auf DB-Ebene. NULL bleibt mehrfach erlaubt
--      (User die noch nie gepaired haben).
-- ============================================================

-- 1) Duplikate aufloesen: pro Konflikt-Gruppe behalte einen.
WITH duplicates AS (
  SELECT telegram_chat_id, MIN(id::text) AS keep_id
    FROM users
   WHERE telegram_chat_id IS NOT NULL
   GROUP BY telegram_chat_id
  HAVING count(*) > 1
)
UPDATE users u
   SET telegram_chat_id = NULL
  FROM duplicates d
 WHERE u.telegram_chat_id = d.telegram_chat_id
   AND u.id::text <> d.keep_id;

-- 2) UNIQUE-Index. Partial damit NULL mehrfach erlaubt bleibt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_telegram_chat_id
  ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
