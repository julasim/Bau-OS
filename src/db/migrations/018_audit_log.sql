-- ============================================================
-- Bau-OS — Audit-Log
-- ============================================================
-- Pre-Production: nachvollziehen wer wann welche sicherheitsrelevante
-- Aktion ausgefuehrt hat. Das ist:
--   - Logins (Erfolg + Fehler), 2FA-Schritte
--   - User-CRUD durch den Admin (anlegen, loeschen, Rolle aendern)
--   - Passwort-Aenderungen (eigenes + Admin-Reset)
--   - Bot-Token gesetzt/entfernt
--   - 2FA aktiviert/deaktiviert
--   - Admin-Einstellungen geaendert (Modell, Fast-Mode etc.)
--
-- KEIN Data-Layer-Audit (jeder Notiz/Aufgabe-Edit) — das wuerde die
-- Tabelle aufblasen ohne Mehrwert fuers Sicherheits-Review. Wenn das
-- spaeter mal gebraucht wird, kommt eine separate generic_audit-Tabelle.
--
-- Tabelle ist append-only fuer Code (nie UPDATE), aber DELETE bleibt
-- moeglich fuer Retention (z.B. monatlicher Cron loescht > 1 Jahr).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, ADD COLUMN nur falls fehlt.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- actor_username ist denormalisiert: wenn der User spaeter geloescht
  -- wird, soll im Audit-Log noch der Name lesbar sein. CASCADE/SET NULL
  -- auf der ID nimmt den FK-Bezug raus, der String bleibt.
  actor_username TEXT,
  actor_role    TEXT,
  ip            TEXT,
  user_agent    TEXT,
  event         TEXT NOT NULL,           -- z.B. 'login.success', '2fa.enable'
  target_user_id UUID,                   -- bei User-CRUD: das Ziel-Konto
  target_label  TEXT,                    -- denormalisierter Name/Beschreibung
  -- Details als JSONB: was genau geaendert wurde (z.B. neue Rolle, neues
  -- Feld). Kein Passwort, kein Token, keine Secrets — nur Metadaten.
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ok            BOOLEAN NOT NULL DEFAULT true
);

-- Indizes fuer typische Queries: Last-N pro User, Last-N pro Event-Typ,
-- IP-basierte Suche bei Vorfall-Analyse.
CREATE INDEX IF NOT EXISTS idx_audit_log_ts          ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor       ON audit_log(actor_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_event       ON audit_log(event, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_user ON audit_log(target_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_ip          ON audit_log(ip, ts DESC) WHERE ip IS NOT NULL;

COMMENT ON TABLE audit_log IS 'Sicherheitsrelevante Events: Login, User-CRUD, 2FA, Bot-Token. Append-only.';
COMMENT ON COLUMN audit_log.event IS 'Punktnotation: login.success | login.fail | 2fa.enable | 2fa.disable | 2fa.fail | password.change | user.create | user.delete | user.role | bot.token.set | bot.token.clear | pair.success | pair.fail';
COMMENT ON COLUMN audit_log.details IS 'JSONB-Detail-Objekt. KEINE Secrets — nur Metadaten (alte Rolle, neue Rolle, Reason etc.).';
