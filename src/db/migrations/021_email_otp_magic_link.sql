-- ============================================================
-- PATIO — Magic-Link-Login (Migration 021)
-- ============================================================
-- Erweitert email_otp_tokens (Migration 020) um den Use-Case "magic-link".
-- Statt 6-stelligem Code kommt ein klickbarer Anmelde-Link in der Email.
-- Spar dem User das Code-Eintippen.
--
-- Schema-Aenderungen:
--   1. CHECK-Constraint auf purpose erweitert: 'magic-link' zugelassen.
--   2. code_hash nullable: bei magic-link gibt es keinen Code, der
--      Token IST der Secret. Stattdessen ist der gehashte Token in der
--      Spalte ticket — wir suchen ueber ticket = sha256(plain) und
--      brauchen kein bcrypt-Compare (256 Bit Token-Entropie reicht).
--
-- Sicherheit:
--   - Token = 32 Bytes random, URL-safe encoded → in der Email als
--     ?magic=<token>-Parameter.
--   - DB speichert nur den sha256-Hash davon (im ticket-Feld). DB-Leak
--     leakt keine nutzbaren Magic-Links.
--   - 15 Min Lebensdauer (kuerzer als OTP weil ein-Klick = "ich war's").
--   - Einmal-Use (used-Flag).
--   - attempts-Counter unbenutzt fuer magic-link (kein Brute-Force-Risiko
--     bei 256 Bit Entropie).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS, ALTER COLUMN IF NULLABLE-Pruefung.
-- ============================================================

-- 1. Alten CHECK weg (Postgres erlaubt nur einen mit dem Namen).
ALTER TABLE email_otp_tokens DROP CONSTRAINT IF EXISTS email_otp_tokens_purpose_check;

-- 2. Neuer CHECK mit 'magic-link' dabei.
ALTER TABLE email_otp_tokens
  ADD CONSTRAINT email_otp_tokens_purpose_check
  CHECK (purpose IN ('login', 'email-setup', 'magic-link'));

-- 3. code_hash nullable. NOT NULL war fuer OTP-Use sinnvoll, magic-link
--    braucht kein Code → NULL erlaubt.
ALTER TABLE email_otp_tokens ALTER COLUMN code_hash DROP NOT NULL;

COMMENT ON COLUMN email_otp_tokens.code_hash IS 'bcrypt-Hash des 6-stelligen Codes (purpose login/email-setup). NULL bei purpose=magic-link, dort steckt der Token-Hash im ticket-Feld.';
