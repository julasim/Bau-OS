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

  it("040 droppt die vector-Extension NICHT", () => {
    // Bewusste Entscheidung: 001 legt sie bei jeder Neuinstallation ohnehin
    // wieder an, und in einer gewachsenen DB koennten fremde Objekte daran
    // haengen. Ein DROP EXTENSION waere unumkehrbar ohne jeden Gewinn.
    const content = readMigration("040_drop_embeddings.sql");
    expect(content).not.toMatch(/^\s*DROP\s+EXTENSION/im);
  });

  it("keine Migration nach 001 fuehrt Embedding-Spalten wieder ein", () => {
    // Die Aufraeum-Migration 040 darf nicht durch eine spaetere Migration
    // still ausgehebelt werden.
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && f !== "001_init.sql")
      .sort();

    for (const file of files) {
      const content = readMigration(file);
      expect(content, `${file} fuegt eine VECTOR-Spalte hinzu`).not.toMatch(/ADD\s+COLUMN[^;]*VECTOR\s*\(/i);
      expect(content, `${file} legt einen HNSW-Index an`).not.toMatch(/USING\s+hnsw/i);
    }
  });
});

// Gegen die echte DB: nach dem Migrationslauf darf keine Spalte vom Typ
// `vector` mehr existieren. Das ist die eigentliche Aussage von 040 —
// die Datei-Tests oben pruefen nur den Wortlaut.
describe.skipIf(!HAS_DB)("Schema nach Migration 040 (nur mit DATABASE_URL)", () => {
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
