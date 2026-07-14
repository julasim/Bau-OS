-- ============================================================
-- PATIO — Zwei-Faktor-Authentifizierung (TOTP, RFC 6238)
-- ============================================================
-- Pre-Production-Hardening: zusaetzlich zu Username + Passwort
-- kann jeder User einen TOTP-Authenticator (Google Authenticator,
-- Aegis, 1Password, ...) hinterlegen. Beim Login wird nach dem
-- Passwort-Schritt nach einem 6-stelligen Token gefragt.
--
-- Schema:
--   - totp_secret_encrypted: AES-256-GCM verschluesselter Base32-Secret.
--     Schluesselableitung wie bei Bot-Tokens via JWT_SECRET (siehe
--     src/api/crypto.ts). NULL = nichts eingerichtet.
--   - totp_enabled: nur true sobald der User den Setup-Flow bestaetigt
--     hat (ersten gueltigen Token eingegeben). Vorher liegt zwar ein
--     Secret in der DB, der Login nutzt es aber nicht.
--   - totp_backup_codes: JSONB-Array mit bcrypt-Hashes der Recovery-
--     Codes. Beim Setup werden 10 Codes generiert, in der UI EINMAL
--     angezeigt, dann nur noch als Hash gespeichert. Jeder Code ist
--     genau einmal nutzbar (Hash wird nach Verwendung entfernt).
--   - totp_verified_at: Zeitstempel des erfolgreichen Setups, fuer
--     Audit-Zwecke und um zu erkennen wann 2FA aktiviert wurde.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — Migration darf mehrfach
-- laufen (Auto-Migrate beim Boot).
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ;

-- Index fuer schnellen Lookup beim Login: hat der User 2FA aktiv?
-- Partial-Index, weil 99% aller User keine 2FA haben — voller Index
-- waere Verschwendung.
CREATE INDEX IF NOT EXISTS idx_users_totp_enabled
  ON users(id) WHERE totp_enabled = true;

COMMENT ON COLUMN users.totp_secret_encrypted IS 'AES-256-GCM verschluesselter Base32-TOTP-Secret. NULL = nichts eingerichtet.';
COMMENT ON COLUMN users.totp_enabled IS 'Nur true nach erfolgreichem Setup-Bestaetigungsschritt.';
COMMENT ON COLUMN users.totp_backup_codes IS 'JSONB-Array mit bcrypt-Hashes der Recovery-Codes. Pro Code einmalig.';
