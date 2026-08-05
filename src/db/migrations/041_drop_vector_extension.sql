-- ============================================================
-- PATIO — Registrierung der pgvector-Extension entfernen
-- ============================================================
-- WARUM:
-- 040 hat die beiden VECTOR-Spalten und ihre HNSW-Indizes entfernt, 001
-- legt sie bei Neuinstallationen gar nicht mehr an. Auf einer BESTANDS-
-- datenbank bleibt danach trotzdem ein Eintrag `vector` in `pg_extension`
-- stehen — angelegt von der alten Fassung von 001.
--
-- Im laufenden Betrieb stoert der nicht. Er wird aber zur Falle, sobald
-- das DB-Image auf `postgres:16` wechselt (genau das Ziel des Umbaus):
--   * Der Server startet normal, weil die Shared Library erst bei
--     Benutzung geladen wuerde — und benutzt wird nichts mehr.
--   * `pg_dump` schreibt aber weiterhin `CREATE EXTENSION vector` in den
--     Dump. Ein Restore auf einem gewoehnlichen `postgres:16` scheitert
--     daran. Auf einem Firmenserver ohne Internet ist das der schlechteste
--     denkbare Zeitpunkt, das zu merken — dort laesst sich pgvector nicht
--     eben nachinstallieren.
-- Erst wenn dieser Eintrag weg ist, gilt die Zusage "das Schema haengt
-- nicht mehr an pgvector" auch fuer gewachsene Datenbanken.
--
-- WARUM SEPARAT VON 040 UND ABGESICHERT:
-- Ein `DROP EXTENSION` laeuft per Default mit RESTRICT und scheitert,
-- sobald irgendein Objekt daran haengt — etwa eine von Hand angelegte
-- Vektor-Spalte, von der diese Migration nichts weiss. Ein Fehler wuerde
-- die Migration abbrechen und damit den Boot verhindern. Weil dieser
-- Schritt reine Hygiene ist und nichts am Betrieb aendert, darf er das
-- nicht koennen. Deshalb:
--   (1) Extension gar nicht vorhanden (Neuinstallation) → sofort raus.
--   (2) Irgendeine Spalte nutzt noch den vector-Typ       → stehen lassen.
--   (3) Sonst DROP — und falls der wider Erwarten doch scheitert, wird
--       der Fehler abgefangen und nur als NOTICE gemeldet.
-- Die Extension bleibt dann eben stehen; das ist der Zustand von vorher.
--
-- REIHENFOLGE BEIM UMSTELLEN (wichtig):
-- Erst die App aktualisieren (Migrationen laufen dabei gegen die noch
-- vorhandene pgvector-Installation, der DROP funktioniert sauber), DANN
-- das DB-Image auf `postgres:16` wechseln. Umgekehrt fehlt beim DROP
-- moeglicherweise die Library — dann greift Fall (3) und der Eintrag
-- bleibt liegen.
--
-- Forward-only, idempotent: laeuft auf einer frischen Datenbank als No-op.
-- ============================================================

DO $$
DECLARE
  vector_columns INTEGER;
BEGIN
  -- (1) Neuinstallation: 001 legt die Extension nicht mehr an.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RETURN;
  END IF;

  -- (2) Haengt noch eine Spalte am vector-Typ (auch als Array `_vector`)?
  --     Bewusst ueber pg_attribute statt information_schema: das erfasst
  --     auch Spalten in Schemas, auf die der Migrationsbenutzer sonst
  --     keinen Blick haette.
  SELECT count(*) INTO vector_columns
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE t.typname IN ('vector', '_vector')
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND c.relkind IN ('r', 'p', 'm', 'v', 'f');

  IF vector_columns > 0 THEN
    RAISE NOTICE 'pgvector bleibt bestehen: % Spalte(n) nutzen den vector-Typ noch.', vector_columns;
    RETURN;
  END IF;

  -- (3) Nichts haengt mehr dran → Registrierung entfernen (RESTRICT).
  EXECUTE 'DROP EXTENSION vector';
  RAISE NOTICE 'pgvector-Extension entfernt — Schema haengt nicht mehr an pgvector.';
EXCEPTION
  WHEN OTHERS THEN
    -- Reine Hygiene: darf niemals den Start der Anwendung verhindern.
    RAISE NOTICE 'pgvector-Extension konnte nicht entfernt werden (%). Sie bleibt bestehen; der Betrieb ist davon unbeeinflusst.', SQLERRM;
END $$;
