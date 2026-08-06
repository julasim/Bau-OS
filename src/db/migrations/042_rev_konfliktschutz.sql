-- ============================================================
-- 042 — Konfliktschutz beim gleichzeitigen Bearbeiten
-- ============================================================
-- Auf dem Firmenserver arbeiten mehrere Leute gleichzeitig. Ohne Schutz gilt
-- „wer zuletzt speichert, gewinnt" — und der andere merkt nichts: seine
-- Aenderung ist weg, ohne Meldung, ohne Spur.
--
-- Jeder bearbeitbare Datensatz bekommt deshalb einen Zaehler. Wer bearbeitet,
-- bekommt ihn mitgeliefert und schickt ihn beim Speichern zurueck; die
-- Anweisung greift nur, solange er noch stimmt (siehe src/data/konflikt.ts).
--
-- DEFAULT 1 statt 0: der erste gespeicherte Stand ist Fassung 1, nicht die
-- nullte. Bestandsdatensaetze starten damit ebenfalls bei 1, ohne Backfill.
--
-- ── Welche Tabellen und warum ────────────────────────────────────────────
--
-- Aufgenommen sind die neun Tabellen, hinter denen ein `update()` im
-- Datenlayer steht — also genau die Stellen, an denen zwei Personen denselben
-- Datensatz bearbeiten koennen.
--
-- BEWUSST NICHT aufgenommen:
--   templates, export_templates, org_branding, project_module_config
--     → Konfiguration. Wird selten und praktisch nie gleichzeitig geaendert;
--       „zuletzt gewinnt" ist hier die richtige und einfachere Antwort.
--   files
--     → geaendert werden nur Metadaten (Stern, Auswertung), kein vom
--       Menschen bearbeiteter Text.
--   users
--     → Passwort und Einstellungen gehoeren genau einer Person.
--
-- Sollte sich das aendern, ist der Nachtrag eine Zeile pro Tabelle.
-- ============================================================

ALTER TABLE notes            ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE tasks            ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE termine          ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE meetings         ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE projects         ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE team_members     ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE project_phases   ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
ALTER TABLE time_entries     ADD COLUMN IF NOT EXISTS rev INT NOT NULL DEFAULT 1;
