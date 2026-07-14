-- ============================================================
-- PATIO — Enum-Rebrand: alter Wert 'bau-os' -> neuer Wert 'patio'
-- ============================================================
-- Der interne Enum-Wert steckt in zwei CHECK-Constraints:
--   1. user_microsoft_accounts.calendar_mode  (alt: 'default' | 'bau-os')
--   2. termine.ms_source                       (alt: 'bau-os' | 'microsoft')
-- Die Migrationen 022/023 haben diese Constraints inline (unbenannt) mit
-- dem Alt-Wert angelegt. Diese Migration stellt beide auf 'patio' um und
-- migriert bestehende Zeilen. Forward-only, idempotent (DROP IF EXISTS +
-- unbedingtes ADD -> nach dem Lauf existiert immer exakt der neue Constraint).
--
-- Hinweis: Der Outlook-Anzeigename ist bereits "PATIO" (mit Legacy-Alias auf
-- den alten Kalendernamen, siehe sync/microsoft-sync.ts) - davon unberuehrt.
-- ============================================================

-- (1) user_microsoft_accounts.calendar_mode
ALTER TABLE user_microsoft_accounts
  DROP CONSTRAINT IF EXISTS user_microsoft_accounts_calendar_mode_check;

UPDATE user_microsoft_accounts
   SET calendar_mode = 'patio'
 WHERE calendar_mode = 'bau-os';

ALTER TABLE user_microsoft_accounts
  ADD CONSTRAINT user_microsoft_accounts_calendar_mode_check
  CHECK (calendar_mode IN ('default', 'patio'));

-- (2) termine.ms_source
ALTER TABLE termine
  DROP CONSTRAINT IF EXISTS termine_ms_source_check;

UPDATE termine
   SET ms_source = 'patio'
 WHERE ms_source = 'bau-os';

ALTER TABLE termine
  ADD CONSTRAINT termine_ms_source_check
  CHECK (ms_source IN ('patio', 'microsoft'));

COMMENT ON COLUMN user_microsoft_accounts.calendar_mode IS 'default = User-Default-Kalender in Outlook; patio = eigener "PATIO"-Kalender (wird beim ersten Sync angelegt).';
COMMENT ON COLUMN termine.ms_source IS 'patio = von PATIO erzeugt (wir pushen nach MS); microsoft = aus MS importiert (MS ist Quelle der Wahrheit).';
