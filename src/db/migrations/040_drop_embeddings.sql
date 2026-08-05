-- ============================================================
-- PATIO — Embedding-Spalten und HNSW-Indizes entfernen
-- ============================================================
-- WARUM:
-- Mit AP0 (Umbau zum Firmenserver) sind LLM-Laufzeit, Embedding-Erzeugung
-- und die semantische Suche ersatzlos entfallen. Die Volltextsuche laeuft
-- ueber src/data/db-search.ts (derzeit ILIKE, spaeter tsvector) und hat mit
-- Vektoren nichts mehr zu tun. Uebrig blieben nur noch die Schema-Reste aus
-- Migration 001:
--   files.embedding  VECTOR(768)  + idx_files_embedding  (HNSW)
--   notes.embedding  VECTOR(768)  + idx_notes_embedding  (HNSW)
-- Kein einziger Codepfad liest oder schreibt diese Spalten. Sie kosten
-- ausschliesslich: die HNSW-Indizes werden bei jedem INSERT/UPDATE auf
-- files und notes mitgepflegt, und das Schema haelt die Installation an
-- die pgvector-Extension gebunden.
--
-- ZIEL: PATIO soll auf einem gewoehnlichen `postgres:16` laufen koennen —
-- auf einem Firmenserver ohne Internet ist das Spezial-Image
-- `pgvector/pgvector:pg16` schlicht nicht zu beschaffen.
--
-- WICHTIGE EINSCHRAENKUNG (bitte lesen, bevor das DB-Image gewechselt wird):
-- Diese Migration raeumt BESTEHENDE Datenbanken auf. Eine FRISCHE
-- Installation laeuft weiterhin zuerst durch Migration 001, und die beginnt
-- in Zeile 7 mit `CREATE EXTENSION IF NOT EXISTS vector` und legt in Zeile
-- 50/65 die VECTOR(768)-Spalten an. Ohne verfuegbare pgvector-Extension
-- scheitert 001 dort, und der Boot bricht ab, bevor 040 ueberhaupt an die
-- Reihe kommt. Forward-only heisst hier: der Wechsel auf `postgres:16`
-- braucht zusaetzlich eine Anpassung von 001 (bedingtes Anlegen oder
-- Entfernen der vector-Teile) — das ist bewusst NICHT Teil dieser Migration.
--
-- Die Extension selbst wird NICHT gedroppt:
--   * Nach dem Drop der beiden Spalten nutzt zwar kein Objekt mehr den
--     vector-Typ (geprueft ueber information_schema.columns: genau diese
--     zwei Spalten waren die einzigen udt_name='vector').
--   * Aber ein DROP EXTENSION ist unumkehrbar-teuer und bringt nichts:
--     auf Bestandsinstallationen ist pgvector ohnehin vorhanden, und
--     Migration 001 wuerde sie bei jeder Neuinstallation wieder anlegen.
--     Ausserdem koennten in einer gewachsenen DB manuell angelegte Objekte
--     daran haengen, die diese Migration nicht kennt.
--
-- Forward-only, idempotent (IF EXISTS ueberall).
-- ============================================================

-- (1) HNSW-Indizes zuerst — sie haengen an den Spalten und wuerden sonst
--     implizit mitgedroppt. Explizit ist klarer und macht den Lauf lesbar.
DROP INDEX IF EXISTS idx_files_embedding;
DROP INDEX IF EXISTS idx_notes_embedding;

-- (2) Die Vektor-Spalten selbst.
ALTER TABLE files DROP COLUMN IF EXISTS embedding;
ALTER TABLE notes DROP COLUMN IF EXISTS embedding;
