// ============================================================
// PATIO — Datenbank-Modul Tests
// Testet Config, Client-Guard, Barrel-Export und die Migrationen.
// ============================================================
//
// Zwei Altlasten sind hier bewusst ausgeraeumt worden:
//
// 1. Die Guard-Tests begannen frueher mit `if (process.env.DATABASE_URL)
//    return;` — im DB-Lauf (dem einzigen, der die vollstaendige Suite
//    ausfuehrt) pruefte diese Datei damit gar nichts und meldete trotzdem
//    gruen. Jetzt `describe.skipIf(...)`: ohne DB laufen sie, mit DB werden
//    sie als UEBERSPRUNGEN ausgewiesen statt als bestanden.
//
// 2. Drei Tests haben aktiv festgeschrieben, dass Migration 001 die
//    pgvector-Extension, VECTOR(768)-Spalten und HNSW-Indizes enthaelt.
//    Das schuetzte in die falsche Richtung: Ziel ist der Betrieb OHNE
//    pgvector. Sie sind durch Tests auf Migration 040 ersetzt.
//
// 3. Inzwischen sind die vektor-abhaengigen Anweisungen auch aus 001 selbst
//    entfernt (sonst scheitert jede FRISCHE Installation auf einem
//    gewoehnlichen postgres:16, bevor 040 an die Reihe kommt) und 041
//    entfernt die Extension-Registrierung aus Bestandsdatenbanken. Die
//    tragende Zusage lautet damit: KEINE Migration setzt pgvector voraus.
//    Genau das prueft "keine Migration setzt pgvector voraus" ueber alle
//    Dateien — die ist der eigentliche Regressionsschutz, weil sie auch
//    ohne Datenbank laeuft.
//
// .env muss VOR der skipIf-Auswertung geladen sein — die passiert zur
// Collection-Zeit, bevor config.ts spaeter selbst dotenv importiert.
import "dotenv/config";
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const HAS_DB = !!process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.join(import.meta.dirname ?? process.cwd(), "..", "src", "db", "migrations");

function readMigration(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf-8");
}

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Entfernt SQL-Kommentare, damit Muster-Pruefungen nur auf ausfuehrbaren
 * Anweisungen greifen. Die Migrationen 040/041 erklaeren in ihren
 * Kommentarkoepfen ausfuehrlich, was frueher an pgvector haing — ohne diesen
 * Schritt wuerde genau diese Dokumentation die Tests rot faerben.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

describe("DB Config", () => {
  it("DB_ENABLED spiegelt DATABASE_URL", async () => {
    const config = await import("../src/config.js");
    expect(config.DB_ENABLED).toBe(HAS_DB);
  });

  it("DATABASE_URL ist Pflicht — Boot bricht ohne sie ab", async () => {
    // Regressionsschutz fuer den Filesystem-Modus-Zombie: index.ts darf bei
    // fehlendem DATABASE_URL NICHT weiterlaufen. Der Abbruch selbst wird
    // gegen den gebauten Prozess verifiziert (Exit-Code 1); hier wird nur
    // festgehalten, dass der Entrypoint den Check ueberhaupt enthaelt und
    // niemand versehentlich einen else-Zweig zurueckbaut.
    const entry = fs.readFileSync(path.join(import.meta.dirname ?? process.cwd(), "..", "src", "index.ts"), "utf-8");
    // Der Check muss direkt in den Abbruch laufen — kein Logging-und-weiter.
    expect(entry).toMatch(/if\s*\(!DB_ENABLED\)\s*\{\s*abortBoot\(/);
    // Und es darf keinen Log-Pfad geben, der einen Filesystem-Modus verspricht.
    // (Bewusst auf den Logger-Aufruf gemuenzt, nicht auf das blosse Wort —
    // die Kommentare in index.ts erklaeren den entfernten Modus ja gerade.)
    expect(entry).not.toMatch(/log(Info|Warn)\([^)]*Filesystem-Modus/);
  });
});

// Ohne DATABASE_URL muessen die Guards greifen. Mit DATABASE_URL sind die
// Aussagen gegenstandslos — dann werden sie uebersprungen und auch so
// gemeldet, statt still durchzurutschen.
describe.skipIf(HAS_DB)("DB Client Guard (nur ohne DATABASE_URL)", () => {
  it("getDb() wirft Fehler wenn DB nicht konfiguriert", async () => {
    const { getDb } = await import("../src/db/client.js");
    expect(() => getDb()).toThrow("Datenbank nicht konfiguriert");
  });

  it("checkDbHealth() gibt false zurueck wenn DB nicht konfiguriert", async () => {
    const { checkDbHealth } = await import("../src/db/client.js");
    await expect(checkDbHealth()).resolves.toBe(false);
  });
});

describe("DB Client Guard (immer)", () => {
  it("closeDb() laeuft fehlerfrei ohne aktive Verbindung", async () => {
    const { closeDb } = await import("../src/db/client.js");
    await expect(closeDb()).resolves.toBeUndefined();
  });
});

describe("DB Index Barrel Export", () => {
  it("exportiert alle erwarteten Funktionen", async () => {
    const db = await import("../src/db/index.js");
    expect(typeof db.getDb).toBe("function");
    expect(typeof db.checkDbHealth).toBe("function");
    expect(typeof db.closeDb).toBe("function");
    expect(typeof db.runMigrations).toBe("function");
    expect(typeof db.migrationStatus).toBe("function");
  });
});

describe("Migration Files", () => {
  it("001_init.sql existiert", () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain("001_init.sql");
  });

  it("001_init.sql enthaelt CREATE TABLE Statements", () => {
    const content = readMigration("001_init.sql");

    expect(content).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS projects");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS files");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS notes");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS tasks");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS termine");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS agent_logs");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS chat_messages");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS team_members");
  });

  it("001_init.sql enthaelt updated_at Trigger", () => {
    const content = readMigration("001_init.sql");
    expect(content).toContain("update_updated_at");
    expect(content).toContain("CREATE TRIGGER");
  });

  it("040 entfernt die Embedding-Spalten und HNSW-Indizes", () => {
    const content = readMigration("040_drop_embeddings.sql");

    expect(content).toContain("DROP INDEX IF EXISTS idx_files_embedding");
    expect(content).toContain("DROP INDEX IF EXISTS idx_notes_embedding");
    expect(content).toContain("ALTER TABLE files DROP COLUMN IF EXISTS embedding");
    expect(content).toContain("ALTER TABLE notes DROP COLUMN IF EXISTS embedding");
  });

  it("040 droppt die vector-Extension NICHT — das erledigt 041", () => {
    // Bewusste Trennung: ein DROP EXTENSION kann an fremden, hier unbekannten
    // Objekten scheitern und wuerde dann die Aufraeum-Migration mitreissen.
    const content = stripSqlComments(readMigration("040_drop_embeddings.sql"));
    expect(content).not.toMatch(/DROP\s+EXTENSION/i);
  });

  it("041 entfernt die vector-Extension abgesichert", () => {
    // Der Drop ist reine Hygiene (sonst schreibt pg_dump weiterhin
    // `CREATE EXTENSION vector` in den Dump, was auf einem postgres:16 nicht
    // mehr einspielbar ist). Er darf deshalb unter keinen Umstaenden den
    // Boot verhindern — die drei Absicherungen werden hier festgeschrieben.
    const content = readMigration("041_drop_vector_extension.sql");
    const sql = stripSqlComments(content);

    expect(sql).toMatch(/DROP\s+EXTENSION\s+vector/i);
    // (1) Neuinstallation: Extension gar nicht vorhanden → No-op.
    expect(sql).toMatch(/pg_extension/);
    // (2) Fremde Objekte nutzen den Typ noch → stehen lassen.
    expect(sql).toMatch(/pg_attribute/);
    // (3) Alles andere wird abgefangen statt zu eskalieren.
    expect(sql).toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
  });

  it("keine Migration setzt pgvector voraus", () => {
    // DIE tragende Zusage dieses Umbaus, und der einzige Test dafuer, der
    // ohne Datenbank laeuft: eine Neuinstallation muss auf einem
    // gewoehnlichen `postgres:16` komplett durchlaufen. Sobald irgendeine
    // Migration wieder die Extension anlegt, eine VECTOR-Spalte erzeugt oder
    // eine pgvector-Operatorklasse benutzt, scheitert der allererste Start
    // auf dem Firmenserver — dort ist pgvector nicht nachinstallierbar.
    // Gilt ausdruecklich auch fuer 001: eine nachgelagerte Migration kann
    // einen Fehler in 001 prinzipiell nicht heilen.
    for (const file of migrationFiles()) {
      const sql = stripSqlComments(readMigration(file));

      expect(sql, `${file} legt die vector-Extension an`).not.toMatch(/CREATE\s+EXTENSION[^;]*\bvector\b/i);
      expect(sql, `${file} legt eine VECTOR-Spalte an`).not.toMatch(/\bVECTOR\s*\(\s*\d+\s*\)/i);
      expect(sql, `${file} legt einen Vektor-Index an`).not.toMatch(/USING\s+(hnsw|ivfflat)/i);
      expect(sql, `${file} nutzt eine pgvector-Operatorklasse`).not.toMatch(/vector_(cosine|l2|ip)_ops/i);
    }
  });

  it("001 legt weiterhin die drei benoetigten contrib-Extensions an", () => {
    // Gegenprobe zum Test darueber: beim Entfernen von `vector` darf nicht
    // versehentlich zu viel mitgegangen sein. uuid-ossp wird fuer jede
    // Primaerschluessel-Default gebraucht, pg_trgm fuer die Fuzzy-Suche.
    // Alle drei gehoeren zu postgresql-contrib und sind im offiziellen
    // postgres:16-Image enthalten.
    const sql = stripSqlComments(readMigration("001_init.sql"));

    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"uuid-ossp"/i);
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_trgm/i);
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+unaccent/i);
  });
});

// Gegen die echte DB: nach dem Migrationslauf darf nichts mehr an pgvector
// haengen. Das ist die eigentliche Aussage von 040/041 — die Datei-Tests
// oben pruefen nur den Wortlaut.
describe.skipIf(!HAS_DB)("Schema ohne pgvector (nur mit DATABASE_URL)", () => {
  it("die Datenbank kennt die vector-Extension nicht", async () => {
    // Die Zusage dieses Umbaus, gegen eine echte Datenbank geprueft.
    // Wichtig auch fuer BESTANDSdatenbanken: dort hatte die alte Fassung von
    // 001 die Extension angelegt. Sie bleibt sonst als Karteileiche in
    // `pg_extension` stehen — harmlos im Betrieb, aber `pg_dump` schreibt
    // dann weiter `CREATE EXTENSION vector` in den Dump, und der laesst sich
    // auf einem `postgres:16` nicht mehr einspielen. 041 raeumt das auf.
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    const rows = await db<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(rows).toEqual([]);
  });

  it("die drei benoetigten contrib-Extensions sind vorhanden", async () => {
    // Gegenprobe: der Umbau darf nicht zu viel entfernt haben.
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    const rows = await db<{ extname: string }[]>`
      SELECT extname FROM pg_extension
       WHERE extname IN ('uuid-ossp', 'pg_trgm', 'unaccent')
       ORDER BY extname
    `;
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "unaccent", "uuid-ossp"]);
  });

  it("keine vector-Spalten mehr im Schema", async () => {
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    const rows = await db<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND udt_name = 'vector'
    `;
    expect(rows).toEqual([]);
  });

  it("keine HNSW-Indizes mehr im Schema", async () => {
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    const rows = await db<{ indexname: string }[]>`
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = 'public' AND indexdef ILIKE '%hnsw%'
    `;
    expect(rows).toEqual([]);
  });
});
