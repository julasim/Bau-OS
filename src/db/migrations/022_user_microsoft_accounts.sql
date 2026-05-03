-- ============================================================
-- Bau-OS — Microsoft-Konto-Verknuepfung (Phase 1, OAuth)
-- ============================================================
-- Pro User EIN verknuepftes Microsoft-Konto fuer Outlook/Calendar-
-- Integration. Tokens (access + refresh) liegen verschluesselt
-- (AES-256-GCM via src/api/crypto.ts) — DB-Backup leakt keine
-- Live-Tokens.
--
-- Schema:
--   - user_id PK + FK CASCADE: ein User → max ein MS-Konto. Wenn
--     User geloescht wird, ist auch das MS-Pairing weg.
--   - ms_user_id: Microsoft-User-ID (oid) aus dem ID-Token. Eindeutig
--     je MS-Account, stabil ueber Refresh-Flows hinweg. UNIQUE damit
--     ein MS-Konto NICHT mit zwei Bau-OS-Konten verbunden werden kann.
--   - ms_email + ms_display_name: Anzeige-Felder fuer "Verbunden mit X".
--   - access_token_encrypted: AES-Encrypted, ~1h Lebensdauer.
--   - refresh_token_encrypted: AES-Encrypted, ~90 Tage Lebensdauer
--     (mit jedem Refresh wird auch das refresh_token erneuert).
--   - access_token_expires_at: timestamp wann das access_token ablaeuft.
--     Vor jedem Graph-Call pruefen wir ob noch >2 Min gueltig — sonst
--     refresh.
--   - calendar_id: User waehlt entweder den Default-Kalender ('default')
--     oder lass uns einen "Bau-OS"-Kalender anlegen (echte Calendar-ID).
--     NULL = noch nicht konfiguriert.
--   - calendar_mode: 'default' | 'bau-os' — UI-Vorgabe, aktuell.
--   - sync_enabled: Master-Schalter fuer den User. Default OFF damit
--     der User aktiv "ja, syncen" sagen muss.
--   - last_sync_at + last_sync_error: Diagnose-Felder fuer Sync-Worker
--     (wird in Phase 2 befuellt).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_microsoft_accounts (
  user_id                       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ms_user_id                    TEXT NOT NULL,
  ms_email                      TEXT NOT NULL,
  ms_display_name               TEXT,
  access_token_encrypted        TEXT NOT NULL,
  refresh_token_encrypted       TEXT NOT NULL,
  access_token_expires_at       TIMESTAMPTZ NOT NULL,
  scope                         TEXT,
  -- Calendar-Auswahl (fuellt Phase 2)
  calendar_id                   TEXT,
  calendar_mode                 TEXT NOT NULL DEFAULT 'default'
                                  CHECK (calendar_mode IN ('default', 'bau-os')),
  sync_enabled                  BOOLEAN NOT NULL DEFAULT false,
  -- Sync-Tracking (fuellt Phase 2)
  last_sync_at                  TIMESTAMPTZ,
  last_sync_delta_link          TEXT,
  last_sync_error               TEXT,
  -- Webhook-Subscription (fuellt Phase 4)
  subscription_id               TEXT,
  subscription_expires_at       TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ein MS-Konto darf nur mit EINEM Bau-OS-User verbunden sein.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_ms_accounts_ms_user_id
  ON user_microsoft_accounts(ms_user_id);

-- Index fuer Subscription-Renewal-Cron (Phase 4): "welche Subscriptions
-- laufen in den naechsten 24h aus?"
CREATE INDEX IF NOT EXISTS idx_user_ms_accounts_sub_expires
  ON user_microsoft_accounts(subscription_expires_at)
  WHERE subscription_id IS NOT NULL;

-- updated_at via Trigger automatisch pflegen, damit der DB-Layer
-- nicht jedes Mal manuell setzen muss.
CREATE OR REPLACE FUNCTION trg_user_ms_accounts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_ms_accounts_updated_at ON user_microsoft_accounts;
CREATE TRIGGER user_ms_accounts_updated_at
  BEFORE UPDATE ON user_microsoft_accounts
  FOR EACH ROW EXECUTE FUNCTION trg_user_ms_accounts_set_updated_at();

COMMENT ON TABLE user_microsoft_accounts IS 'Pro User ein verknuepftes Microsoft-Konto fuer Outlook-Calendar-Sync. Tokens AES-256-GCM verschluesselt.';
COMMENT ON COLUMN user_microsoft_accounts.calendar_mode IS 'default = User-Default-Kalender in Outlook; bau-os = eigener "Bau-OS"-Kalender (wird beim ersten Sync angelegt).';
