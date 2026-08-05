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
-- GELTUNGSBEREICH (die frueher hier notierte Einschraenkung ist erledigt):
-- Diese Migration raeumt BESTEHENDE Datenbanken auf. Der zweite, hier nicht
-- loesbare Teil — eine FRISCHE Installation laeuft zuerst durch 001, und die
-- begann mit `CREATE EXTENSION vector` samt VECTOR(768)-Spalten — ist
-- inzwischen direkt in `001_init.sql` behoben: die vier vektor-abhaengigen
-- Anweisungen sind dort entfernt. Das ist ohne Risiko fuer Bestandsdaten,
-- weil der Runner per Dateiname trackt und 001 dort nie wieder laeuft
-- (Begruendung ausfuehrlich im Kommentarkopf von 001).
--
-- Die Extension selbst wird HIER NICHT gedroppt — das erledigt, bewusst
-- getrennt und abgesichert, Migration 041:
--   * Nach dem Drop der beiden Spalten nutzt kein Objekt mehr den
--     vector-Typ (geprueft ueber information_schema.columns: genau diese
--     zwei Spalten waren die einzigen udt_name='vector').
--   * Ein `DROP EXTENSION` gehoert aber nicht in dieselbe Migration wie der
--     Spalten-Drop: es kann an fremden, hier unbekannten Objekten scheitern
--     und wuerde dann diese Aufraeum-Migration mitreissen. 041 prueft
--     deshalb vorher und faengt den Fehlerfall ab.
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
