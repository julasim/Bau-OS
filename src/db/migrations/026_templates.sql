-- ============================================================
-- Bau-OS — Vorlagen (Phase 6c)
-- ============================================================
-- Markdown-Templates fuer Notizen, Meetings, Bautagebuch-Eintraege.
-- Verwendung:
--   1. Beim Anlegen einer Notiz/eines Meetings waehlt der User
--      eine Vorlage → der Body wird mit der gerenderten Vorlage
--      vorbefuellt (Placeholder werden ersetzt).
--   2. Placeholder-Syntax: {{Variable}} — z.B. {{Projekt}},
--      {{Datum}}, {{Bauherr}}, {{Firma}}, {{User}}.
--
-- is_default je kind: max. ein Default — beim Setzen werden andere
-- defaults derselben kind automatisch zurueckgesetzt (Trigger).
-- ============================================================

CREATE TABLE IF NOT EXISTS templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind            TEXT NOT NULL CHECK (kind IN ('note', 'meeting', 'bautagebuch')),
  name            TEXT NOT NULL,
  description     TEXT,
  body            TEXT NOT NULL,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_by_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_kind ON templates(kind);
CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_default_per_kind
  ON templates(kind) WHERE is_default = true;

-- updated_at Trigger
CREATE OR REPLACE FUNCTION trg_templates_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS templates_updated_at ON templates;
CREATE TRIGGER templates_updated_at BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION trg_templates_updated_at();

-- ── Default-Vorlagen seeden ─────────────────────────────────────────────────
-- Idempotent: nur wenn kind+name noch nicht existiert.

INSERT INTO templates (kind, name, description, body, is_default)
SELECT 'meeting', 'Bauherrenmeeting',
       'Standardprotokoll fuer Bauherrenmeetings — Anwesenheit, Tagesordnung, Beschluesse, Aufgaben.',
$$# Bauherrenmeeting — {{Projekt}}

**Datum:** {{Datum}}
**Ort:** {{Ort}}
**Bauherr:** {{Bauherr}}
**Protokollant:** {{User}}

## Anwesend

- ...

## Tagesordnung

1. ...

## Besprochene Punkte

### 1. ...

## Beschluesse

- ...

## Offene Aufgaben

- [ ] ... — verantwortlich: ... — bis: ...

## Naechster Termin

...
$$, true
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='meeting' AND name='Bauherrenmeeting');

INSERT INTO templates (kind, name, description, body)
SELECT 'meeting', 'Baubesprechung',
       'Wochenmeeting auf der Baustelle mit ausfuehrenden Firmen.',
$$# Baubesprechung — {{Projekt}}

**Datum:** {{Datum}}
**Bauleitung:** {{User}}

## Anwesende Firmen

- ...

## Bautenstand

...

## Offene Punkte

- ...

## Termine

- ...
$$
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='meeting' AND name='Baubesprechung');

INSERT INTO templates (kind, name, description, body)
SELECT 'meeting', 'Subunternehmer-Abstimmung',
       'Koordinierungstreffen mit einzelnen Gewerken / Subunternehmern.',
$$# Abstimmung — {{Projekt}}

**Datum:** {{Datum}}
**Gewerk / Firma:** ...

## Themen

- Schnittstellen
- Termine
- Material

## Vereinbarungen

- ...
$$
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='meeting' AND name='Subunternehmer-Abstimmung');

INSERT INTO templates (kind, name, description, body, is_default)
SELECT 'note', 'Tagesnotiz Bauleitung',
       'Schnelle Notiz fuer das Tagesende — was war heute, was ist offen.',
$$# Tagesnotiz — {{Datum}}

**Projekt:** {{Projekt}}
**Bauleitung:** {{User}}

## Was war heute

- ...

## Beobachtungen / Auffaelliges

- ...

## Was steht morgen an

- ...
$$, true
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='note' AND name='Tagesnotiz Bauleitung');

INSERT INTO templates (kind, name, description, body)
SELECT 'note', 'Aufmass-Notiz',
       'Kurznotiz nach einem Aufmass-Termin auf der Baustelle.',
$$# Aufmass — {{Projekt}}

**Datum:** {{Datum}}
**Vor Ort:** {{User}}

## Bereiche

- ...

## Gemessen / Notizen

- ...

## Offene Punkte

- ...
$$
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='note' AND name='Aufmass-Notiz');

INSERT INTO templates (kind, name, description, body, is_default)
SELECT 'bautagebuch', 'Standard-Bautagebuch',
       'Empty-Skelett fuer einen Tagesbericht (zusaetzlich zu den strukturierten Feldern).',
$$## Personal / Subunternehmer

- ...

## Maschinen / Geraete

- ...

## Taetigkeiten

- ...

## Vorkommnisse

(keine)
$$, true
WHERE NOT EXISTS (SELECT 1 FROM templates WHERE kind='bautagebuch' AND name='Standard-Bautagebuch');

COMMENT ON TABLE templates IS 'Markdown-Vorlagen fuer Notizen, Meetings, Bautagebuch-Eintraege. Placeholder via {{Variable}}.';
