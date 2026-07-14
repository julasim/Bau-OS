-- ============================================================
-- PATIO — Multi-Calendar-Support fuer Microsoft Graph (Phase 5c)
-- ============================================================
-- Bisher: pro User EIN Outlook-Kalender (calendar_id +
-- calendar_mode auf user_microsoft_accounts). Neu: M:N — der User
-- waehlt aus seinen Outlook-Kalendern beliebig viele aus, jeder
-- bekommt seine eigene Webhook-Subscription.
--
-- Use-Case: ein User hat in Outlook "Privat", "PATIO-Projekte" und
-- "Architektenkammer" — er will alle drei in PATIO sehen, aber
-- nicht den Privat-Kalender. Mit dieser Junction-Table aktiviert er
-- per Checkbox welche.
--
-- WICHTIG: ein Kalender ist immer genau einem User zugeordnet
-- (Microsoft-IDs sind tenant-/account-spezifisch). Daher PK
-- (user_id, calendar_id) — verhindert dass derselbe Kalender
-- versehentlich zweimal gemappt wird.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_microsoft_calendars (
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id              TEXT NOT NULL,
  display_name             TEXT,
  -- 'true' = User will diesen Kalender mit PATIO syncen, Subscription
  -- ist aktiv. 'false' = pausiert (keine Subscription, keine Sync-Calls,
  -- aber Eintrag bleibt damit wir die User-Auswahl nicht verlieren).
  enabled                  BOOLEAN NOT NULL DEFAULT true,
  -- Direction: 'both' | 'pull-only' | 'push-only'. Default beidseitig;
  -- pull-only ist sinnvoll fuer fremde geteilte Kalender ("ich will sehen
  -- aber nichts schreiben"). Phase-5c-light: nur 'both', Spalte fuer
  -- spaetere Erweiterung.
  direction                TEXT NOT NULL DEFAULT 'both'
                             CHECK (direction IN ('both', 'pull-only', 'push-only')),
  -- Webhook-Subscription pro Kalender (analog zu user_microsoft_accounts).
  subscription_id          TEXT,
  subscription_expires_at  TIMESTAMPTZ,
  -- Sync-Diagnose pro Kalender (User sieht in der UI welche genau hakt).
  last_sync_at             TIMESTAMPTZ,
  last_sync_error          TEXT,
  added_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, calendar_id)
);

-- Renewal-Cron-Index: alle Subs die in <12h ablaufen.
CREATE INDEX IF NOT EXISTS idx_umc_sub_expires
  ON user_microsoft_calendars(subscription_expires_at)
  WHERE subscription_id IS NOT NULL AND enabled = true;

-- Webhook-Receiver-Index: subscriptionId → User+Calendar in O(log n).
CREATE UNIQUE INDEX IF NOT EXISTS uq_umc_subscription_id
  ON user_microsoft_calendars(subscription_id)
  WHERE subscription_id IS NOT NULL;

-- updated_at via Trigger.
CREATE OR REPLACE FUNCTION trg_umc_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS umc_updated_at ON user_microsoft_calendars;
CREATE TRIGGER umc_updated_at
  BEFORE UPDATE ON user_microsoft_calendars
  FOR EACH ROW EXECUTE FUNCTION trg_umc_set_updated_at();

-- ── Backfill: bestehende Single-Calendar-Konfiguration uebertragen ──────────
-- Wenn ein User schon einen calendar_id auf user_microsoft_accounts hatte
-- (Phase 1-4), uebernehmen wir den als ersten Eintrag in der Junction.
-- subscription_id wandert mit, damit der Webhook nicht verlernt wird.
INSERT INTO user_microsoft_calendars (
  user_id, calendar_id, display_name, enabled,
  subscription_id, subscription_expires_at,
  last_sync_at, last_sync_error, added_at
)
SELECT
  user_id,
  calendar_id,
  CASE calendar_mode WHEN 'bau-os' THEN 'Bau-OS' ELSE 'Default-Kalender' END,
  sync_enabled,
  subscription_id,
  subscription_expires_at,
  last_sync_at,
  last_sync_error,
  COALESCE(created_at, now())
FROM user_microsoft_accounts
WHERE calendar_id IS NOT NULL
ON CONFLICT (user_id, calendar_id) DO NOTHING;

COMMENT ON TABLE user_microsoft_calendars IS 'Phase 5c: M:N User → Outlook-Kalender. Pro Kalender eine eigene Webhook-Subscription. Ersetzt die single-calendar-Felder auf user_microsoft_accounts (die bleiben aber befuellt fuer Backward-Compat bis die Apps migriert sind).';
COMMENT ON COLUMN user_microsoft_calendars.direction IS 'both = bidirektional; pull-only = nur Outlook → Bau-OS (z.B. fremde geteilte Kalender); push-only = nur Bau-OS → Outlook.';
