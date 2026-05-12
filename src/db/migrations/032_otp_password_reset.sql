-- ============================================================
-- Migration 032 — OTP purpose: 'password-reset' hinzufügen
-- ============================================================
-- Der CHECK-Constraint auf email_otp_tokens.purpose erlaubte
-- bisher nur 'login', 'email-setup', 'magic-link'.
-- Der neue Passwort-Reset-Flow (server.ts, auth.ts) schreibt
-- purpose='password-reset' — was den Constraint verletzte.
-- ============================================================

ALTER TABLE email_otp_tokens DROP CONSTRAINT IF EXISTS email_otp_tokens_purpose_check;

ALTER TABLE email_otp_tokens
  ADD CONSTRAINT email_otp_tokens_purpose_check
  CHECK (purpose IN ('login', 'email-setup', 'magic-link', 'password-reset'));

COMMENT ON COLUMN email_otp_tokens.purpose IS
  'Verwendungszweck des OTP: login, email-setup, magic-link, password-reset';
