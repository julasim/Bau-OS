-- ============================================================
-- Bau-OS — User-UI-Praeferenzen (Phase 6f)
-- ============================================================
-- Pro User gespeicherte UI-Einstellungen: Theme (Light/Dark/System),
-- Akzentfarbe, Schriftgroesse, kompakte UI, Wochenstart, Datums-
-- Format, Standard-Calendar-View, Telegram-Notification-Filter.
--
-- Speicherung als JSONB statt einzelner Spalten — UI-Preferences
-- wachsen oft, JSONB erspart Migrations bei jedem neuen Toggle.
--
-- Frontend liest die Werte beim Login + watched ueber Storage-Event
-- damit Theme-Wechsel auch in anderen Tabs sofort sichtbar wird.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ui_preferences JSONB NOT NULL DEFAULT '{
    "theme": "system",
    "accentColor": "#111827",
    "fontSize": "medium",
    "compactUI": false,
    "weekStart": "monday",
    "calendarDefaultView": "month",
    "dateFormat": "DD.MM.YYYY",
    "telegramNotifications": {
      "termine": true,
      "tasks": true,
      "meetings": true,
      "bautagebuch": false
    }
  }'::jsonb;

COMMENT ON COLUMN users.ui_preferences IS 'Phase 6f: Pro User UI-Settings (Theme, Akzentfarbe, Schriftgroesse, Kalender-Defaults, Telegram-Filter). JSONB ohne festes Schema — Defaults siehe Migration.';
