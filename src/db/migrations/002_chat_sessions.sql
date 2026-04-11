-- ============================================================
-- Bau-OS — Chat Sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent TEXT NOT NULL DEFAULT 'Main',
  title TEXT NOT NULL DEFAULT 'Neuer Chat',
  source TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent ON chat_sessions(agent);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

DROP TRIGGER IF EXISTS trg_chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER trg_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- tools Array fuer einfache Abfragen
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tools TEXT[] DEFAULT '{}';
