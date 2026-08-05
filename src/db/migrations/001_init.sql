-- ============================================================
-- PATIO — Initiales Datenbank-Schema
-- Erstellt alle Kerntabellen fuer Phase 4
-- ============================================================
-- NACHTRAEGLICHE AENDERUNG (Umbau zum Firmenserver)
--
-- Diese Datei enthielt urspruenglich vier Dinge, die pgvector voraussetzen
-- (Zeilenangaben beziehen sich auf die alte Fassung):
--   * CREATE EXTENSION IF NOT EXISTS vector            (vormals Zeile 7)
--   * files.embedding  VECTOR(768)                     (vormals Zeile 50)
--   * notes.embedding  VECTOR(768)                     (vormals Zeile 65)
--   * zwei HNSW-Indizes darauf                         (vormals Zeile 162/163)
-- Alles davon ist hier entfernt.
--
-- WARUM ausgerechnet in DIESER Datei und nicht per neuer Migration:
-- Der Firmenserver steht ohne Internet im Buero — das Spezial-Image
-- `pgvector/pgvector:pg16` ist dort nicht zu beschaffen, es laeuft ein
-- gewoehnliches `postgres:16`. Migration 040 raeumt die Vektor-Reste zwar
-- aus BESTEHENDEN Datenbanken, aber eine FRISCHE Installation laeuft
-- zuerst durch diese Datei hier: ohne verfuegbare Extension scheitert sie
-- gleich in der ersten Anweisung, und der Boot bricht ab, bevor 040
-- ueberhaupt an die Reihe kommt. Eine nachgelagerte Migration kann das
-- prinzipiell nicht heilen.
--
-- Verworfene Alternative — bedingtes Anlegen (DO-Block + dynamisches
-- EXECUTE, je nachdem ob pgvector verfuegbar ist): erzeugt je nach
-- Maschine ein ANDERES Schema, und auf einem pgvector-faehigen Server
-- legt es genau die Spalten an, die 040 unmittelbar danach wieder
-- wegwirft. Jede spaetere Migration muesste dann mit beiden Varianten
-- rechnen. Kein Gewinn, nur Sonderfaelle.
--
-- WARUM Bestandsinstallationen das nicht beruehrt:
-- Der Runner (src/db/migrate.ts) trackt Migrationen per DATEINAME in
-- `_migrations` und bildet KEINE Pruefsumme. Wo `001_init.sql` bereits
-- angewandt ist, wird diese Datei nie wieder gelesen — der Eintrag bleibt
-- gueltig, das dortige Schema unveraendert. Aufgeraeumt wird dort weiter
-- durch 040 (Spalten/Indizes) und 041 (Extension). Beide Wege enden beim
-- identischen Schema:
--   frisch  : 001 ohne Vektoren        → 040 + 041 laufen als No-op
--   Bestand : 001 mit Vektoren (alt)   → 040 + 041 raeumen sie ab
--
-- Die drei verbleibenden Extensions sind unproblematisch: uuid-ossp,
-- pg_trgm und unaccent gehoeren zu postgresql-contrib und sind im
-- offiziellen `postgres:16`-Image enthalten.
-- ============================================================

-- Extensions sicherstellen (falls nicht durch init-Script erstellt)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ── Benutzer ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  telegram_chat_id BIGINT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Projekte ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv',
  color TEXT,
  tags TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Dateien ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  filetype TEXT,
  filesize BIGINT,
  mime_type TEXT,
  content_text TEXT,
  summary TEXT,
  tags TEXT[] DEFAULT '{}',
  analyzed BOOLEAN DEFAULT false,
  analysis_result JSONB,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Notizen ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  source TEXT DEFAULT 'web',
  pinned BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Aufgaben ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offen',
  priority TEXT DEFAULT 'mittel',
  assignee TEXT,
  date TEXT,
  due_date DATE,
  location TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Termine ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS termine (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  text TEXT NOT NULL,
  datum TEXT NOT NULL,
  uhrzeit TEXT,
  endzeit TEXT,
  location TEXT,
  assignees TEXT[] DEFAULT '{}',
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  recurring TEXT,
  color TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Agent-Logs (Tool-Aufrufe, Gedanken, Aktionen) ───────────
CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  parameters JSONB,
  result_summary TEXT,
  thought TEXT,
  error TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Chat-Nachrichten ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,
  source TEXT DEFAULT 'web',
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Team / Kontakte ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indizes
-- ============================================================

-- (Hier standen bis zum Firmenserver-Umbau die beiden HNSW-Indizes auf
--  files.embedding / notes.embedding — siehe Kommentarkopf oben.)

-- Fuzzy-Textsuche (pg_trgm)
CREATE INDEX IF NOT EXISTS idx_files_filename_trgm ON files USING gin (filename gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_notes_title_trgm ON notes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_notes_content_trgm ON notes USING gin (content gin_trgm_ops);

-- FK-Lookups
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_termine_project ON termine(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_session ON agent_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

-- Zeitbasierte Abfragen
CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_termine_datum ON termine(datum);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- ============================================================
-- Trigger: updated_at automatisch setzen
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_files_updated_at BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_notes_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_termine_updated_at BEFORE UPDATE ON termine
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_team_members_updated_at BEFORE UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
