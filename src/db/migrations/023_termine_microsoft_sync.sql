-- ============================================================
-- Bau-OS — termine.ms_* fuer Outlook-Sync (Phase 1, Schema-Vorbereitung)
-- ============================================================
-- Tracking-Spalten damit jeder Termin weiss, ob/wo er in Microsoft
-- Graph existiert. Spalten werden in Phase 2 (Read-Sync) und Phase 3
-- (Write-Sync) aktiv befuellt — die Migration jetzt legt nur das
-- Schema, damit die DB-Struktur konsistent ist.
--
-- Spalten:
--   - ms_event_id: Microsoft Graph Event-ID. NULL = Termin existiert
--     nur in Bau-OS, noch nicht (oder nicht mehr) in Outlook.
--   - ms_calendar_id: in welchem MS-Kalender der Event liegt (Default
--     vs Bau-OS-Kalender).
--   - ms_owner_user_id: welcher Bau-OS-User "besitzt" den MS-Termin.
--     Wichtig fuer Multi-User-Termine: nur der Eigentuemer schreibt
--     Updates zu MS, andere User sehen den Termin via ihre eigene
--     MS-Sync-Verbindung.
--   - ms_etag: Microsoft Graph @odata.etag — fuer ETag-basierte
--     Conflict-Detection beim Update (Phase 3).
--   - ms_sync_status: 'pending' = wartet auf Push zu MS,
--                     'synced'  = aktuell, in beiden Systemen identisch,
--                     'conflict'= MS und Bau-OS divergieren (Phase 4),
--                     'error'   = letzter Sync-Versuch fehlgeschlagen.
--   - ms_last_sync_at: Zeitstempel letzter erfolgreicher Sync.
--   - ms_source: 'bau-os' = von Bau-OS erzeugt → wir pushen nach MS,
--                'microsoft' = aus MS importiert → MS ist die Quelle.
--                NULL = noch nicht synchronisiert.
-- ============================================================

ALTER TABLE termine ADD COLUMN IF NOT EXISTS ms_event_id     TEXT;
ALTER TABLE termine ADD COLUMN IF NOT EXISTS ms_calendar_id  TEXT;
ALTER TABLE termine ADD COLUMN IF NOT EXISTS ms_owner_user_id UUID
  REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE termine ADD COLUMN IF NOT EXISTS ms_etag         TEXT;
ALTER TABLE termine ADD COLUMN IF NOT EXISTS ms_sync_status  TEXT
  CHECK (ms_sync_status IN ('pending', 'synced', 'conflict', 'error'));
ALTER TABLE termine ADD COLUMN IF NOT EXISTS ms_last_sync_at TIMESTAMPTZ;
ALTER TABLE termine ADD COLUMN IF NOT EXISTS ms_source       TEXT
  CHECK (ms_source IN ('bau-os', 'microsoft'));

-- Index fuer "alle Bau-OS-Termine die noch nicht zu MS gepusht wurden"
-- (Phase 3 Sync-Worker).
CREATE INDEX IF NOT EXISTS idx_termine_ms_pending
  ON termine(ms_owner_user_id) WHERE ms_sync_status = 'pending';

-- Index fuer Conflict-View (Phase 4).
CREATE INDEX IF NOT EXISTS idx_termine_ms_conflict
  ON termine(ms_owner_user_id) WHERE ms_sync_status = 'conflict';

-- Eindeutigkeit: ein MS-Event kann nur einmal in einer DB-Zeile referenziert
-- werden. Verhindert versehentliche Duplikate beim Webhook-Re-Delivery.
CREATE UNIQUE INDEX IF NOT EXISTS uq_termine_ms_event_id
  ON termine(ms_event_id) WHERE ms_event_id IS NOT NULL;

COMMENT ON COLUMN termine.ms_source IS 'bau-os = von Bau-OS erzeugt (wir pushen nach MS); microsoft = aus MS importiert (MS ist Quelle der Wahrheit).';
COMMENT ON COLUMN termine.ms_etag IS 'Microsoft Graph @odata.etag — fuer If-Match-Header beim Update, verhindert Lost-Update-Konflikte.';
