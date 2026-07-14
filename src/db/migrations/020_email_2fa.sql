-- ============================================================
-- PATIO — Email-basierte 2FA (Pflicht)
-- ============================================================
-- Loest die TOTP-2FA aus Migration 017 ab. Begruendung: Email ist
-- niedrigschwelliger fuer Architekturbueros — kein Authenticator-App-
-- Setup, kein QR-Scan, jeder hat eine Mail-Adresse. Sicherheit ist
-- vergleichbar (E-Mail-Provider sind 2FA-geschuetzt, Code ist
-- kurzlebig + einmalig).
--
-- Schema:
--   - users.email: nullable. Bestehende User (vor dieser Migration)
--     haben kein email gesetzt — beim ersten Login werden sie auf
--     eine Setup-Seite gefuehrt, wo sie eine Email hinterlegen +
--     verifizieren muessen. Neuer User-Anlage (Admin-UI/Setup-Wizard)
--     wird Email Pflichtfeld.
--   - email_otp_tokens: kurzlebige Codes fuer den Login-Flow.
--     code_hash bcrypt-gehashed, damit ein Backup-Dump nicht direkt
--     die Live-Codes leakt (sind zwar nur 10 Min gueltig, aber besser).
--     used: nach erfolgreicher Verifikation auf true gesetzt — verhindert
--     Replay innerhalb der 10 Minuten Lebensdauer. Cron entfernt
--     abgelaufene/genutzte Eintraege spaeter.
--
-- TOTP-Spalten aus Migration 017 (totp_secret_encrypted, totp_enabled,
-- totp_backup_codes, totp_verified_at) bleiben in der DB stehen — sind
-- forward-only Schema. Code nutzt sie aber nicht mehr; spaeter koennen
-- sie via separater Migration entfernt werden, wenn alle User durch
-- Email durch sind.
--
-- Idempotent: alle Statements ADD COLUMN IF NOT EXISTS / CREATE TABLE
-- IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- Partial UNIQUE: jede Email genau einmal, aber NULL erlaubt fuer
-- Legacy-User die noch keine gesetzt haben.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email
  ON users(LOWER(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_otp_tokens (
  ticket      TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 6-stelliger numerischer Code, bcrypt-gehasht (kurzer Hash mit cost=8
  -- ist OK — Code ist nur 10 Min gueltig, hoher Cost waere uebertrieben).
  code_hash   TEXT NOT NULL,
  -- purpose: 'login' fuer 2FA-Login, 'email-setup' fuer Erstmaliges
  -- Email-Verifizieren oder Email-Wechsel.
  purpose     TEXT NOT NULL CHECK (purpose IN ('login', 'email-setup')),
  -- Bei email-setup: hier die NEUE Email speichern, die nach
  -- erfolgreicher Verifikation auf users.email geschrieben wird.
  pending_email TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT false,
  attempts    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_otp_user
  ON email_otp_tokens(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_otp_expires
  ON email_otp_tokens(expires_at) WHERE used = false;

COMMENT ON COLUMN users.email IS 'Email fuer 2FA-Login. Pflicht ab Migration 020 — bestehende NULL-Werte werden beim naechsten Login durch Setup-Flow gefuellt.';
COMMENT ON TABLE email_otp_tokens IS 'Kurzlebige 6-stellige Codes fuer Email-OTP-Login (Migration 020). bcrypt-gehasht, 10 Minuten gueltig, Einmal-Use.';
