// ============================================================
// Bau-OS — Datenbank-Modul Tests
// Testet Config, Client-Guard und Migration-Logik
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("DB Config", () => {
  it("DB_ENABLED ist false wenn DATABASE_URL leer", async () => {
    // Config wird beim Import ausgewertet, daher direkt pruefen
    const config = await import("../src/config.js");
    // Wenn DATABASE_URL nicht in der Test-Umgebung gesetzt ist, sollte DB_ENABLED false sein
    if (!process.env.DATABASE_URL) {
      expect(config.DB_ENABLED).toBe(false);
    } else {
      expect(config.DB_ENABLED).toBe(true);
    }
  });

  it("EMBEDDING_MODEL hat Standardwert", async () => {
    const config = await import("../src/config.js");
    expect(config.EMBEDDING_MODEL).toBe(process.env.EMBEDDING_MODEL || "nomic-embed-text");
  });

  it("EMBEDDING_DIMENSIONS ist 768", async () => {
    const config = await import("../src/config.js");
    expect(config.EMBEDDING_DIMENSIONS).toBe(parseInt(process.env.EMBEDDING_DIMENSIONS || "768", 10));
  });

  it("EMBEDDING_BATCH_SIZE ist definiert", async () => {
    const config = await import("../src/config.js");
    expect(config.EMBEDDING_BATCH_SIZE).toBeGreaterThan(0);
  });
});

describe("DB Client Guard", () => {
  it("getDb() wirft Fehler wenn DB nicht konfiguriert", async () => {
    // Nur testen wenn DB nicht konfiguriert ist
    if (process.env.DATABASE_URL) return;

    const { getDb } = await import("../src/db/client.js");
    expect(() => getDb()).toThrow("Datenbank nicht konfiguriert");
  });

  it("checkDbHealth() gibt false zurueck wenn DB nicht konfiguriert", async () => {
    if (process.env.DATABASE_URL) return;

    const { checkDbHealth } = await import("../src/db/client.js");
    const result = await checkDbHealth();
    expect(result).toBe(false);
  });

  it("checkPgVector() gibt false zurueck wenn DB nicht konfiguriert", async () => {
    if (process.env.DATABASE_URL) return;

    const { checkPgVector } = await import("../src/db/client.js");
    const result = await checkPgVector();
    expect(result).toBe(false);
  });

  it("closeDb() laeuft fehlerfrei ohne aktive Verbindung", async () => {
    const { closeDb } = await import("../src/db/client.js");
    // Sollte nicht crashen, auch wenn kein Pool existiert
    await expect(closeDb()).resolves.toBeUndefined();
  });
});

describe("DB Index Barrel Export", () => {
  it("exportiert alle erwarteten Funktionen", async () => {
    const db = await import("../src/db/index.js");
    expect(typeof db.getDb).toBe("function");
    expect(typeof db.checkDbHealth).toBe("function");
    expect(typeof db.checkPgVector).toBe("function");
    expect(typeof db.closeDb).toBe("function");
    expect(typeof db.runMigrations).toBe("function");
    expect(typeof db.migrationStatus).toBe("function");
  });
});

describe("Migration Files", () => {
  it("001_init.sql existiert", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const migrationsDir = path.join(import.meta.dirname ?? process.cwd(), "..", "src", "db", "migrations");
    const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith(".sql"));
    expect(files).toContain("001_init.sql");
  });

  it("001_init.sql enthaelt CREATE TABLE Statements", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(import.meta.dirname ?? process.cwd(), "..", "src", "db", "migrations", "001_init.sql");
    const content = fs.readFileSync(filePath, "utf-8");

    // Alle erwarteten Tabellen pruefen
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

  it("001_init.sql enthaelt pgvector Extension", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(import.meta.dirname ?? process.cwd(), "..", "src", "db", "migrations", "001_init.sql");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(content).toContain("VECTOR(768)");
  });

  it("001_init.sql enthaelt HNSW-Indizes fuer Embeddings", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(import.meta.dirname ?? process.cwd(), "..", "src", "db", "migrations", "001_init.sql");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("USING hnsw (embedding vector_cosine_ops)");
  });

  it("001_init.sql enthaelt updated_at Trigger", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.join(import.meta.dirname ?? process.cwd(), "..", "src", "db", "migrations", "001_init.sql");
    const content = fs.readFileSync(filePath, "utf-8");

    expect(content).toContain("update_updated_at");
    expect(content).toContain("CREATE TRIGGER");
  });
});
