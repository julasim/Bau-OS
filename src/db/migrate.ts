// ============================================================
// Bau-OS — Datenbank-Migrations-Runner
// Liest SQL-Dateien aus src/db/migrations/ und fuehrt sie aus.
// Tracking ueber _migrations Tabelle (idempotent).
// ============================================================

import fs from "fs";
import path from "path";
import { getDb } from "./client.js";
import { logInfo, logError } from "../logger.js";

const MIGRATIONS_DIR = path.join(import.meta.dirname ?? process.cwd(), "migrations");

/**
 * Erstellt die _migrations Tracking-Tabelle falls nicht vorhanden.
 */
async function ensureMigrationsTable(): Promise<void> {
  const db = getDb();
  await db`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `;
}

/**
 * Gibt alle bereits angewandten Migrations zurueck.
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const db = getDb();
  const rows = await db`SELECT name FROM _migrations ORDER BY id`;
  return new Set(rows.map((r) => r.name));
}

/**
 * Liest alle .sql Dateien aus dem migrations/ Verzeichnis.
 * Sortiert alphabetisch (001_, 002_, ...).
 */
function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logError("[DB]", `Migrations-Verzeichnis nicht gefunden: ${MIGRATIONS_DIR}`);
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Fuehrt alle ausstehenden Migrations aus.
 * @returns Anzahl der angewandten Migrations
 */
export async function runMigrations(): Promise<number> {
  const db = getDb();

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const files = getMigrationFiles();

  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sqlContent = fs.readFileSync(filePath, "utf-8");

    logInfo(`[DB] Migration: ${file} ...`);

    try {
      // Jede Migration in einer Transaktion
      await db.begin(async (tx) => {
        await tx.unsafe(sqlContent);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });

      logInfo(`[DB] Migration erfolgreich: ${file}`);
      count++;
    } catch (err) {
      logError(`[DB] Migration fehlgeschlagen: ${file}`, err);
      throw err; // Abbrechen bei Fehler
    }
  }

  if (count === 0) {
    logInfo("[DB] Keine ausstehenden Migrations");
  } else {
    logInfo(`[DB] ${count} Migration(s) angewandt`);
  }

  return count;
}

/**
 * Zeigt den Status aller Migrations an.
 */
export async function migrationStatus(): Promise<{ name: string; applied: boolean; appliedAt?: string }[]> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const files = getMigrationFiles();

  const db = getDb();
  const appliedRows = await db`SELECT name, applied_at FROM _migrations ORDER BY id`;
  const appliedMap = new Map(appliedRows.map((r) => [r.name, r.applied_at]));

  return files.map((f) => ({
    name: f,
    applied: applied.has(f),
    appliedAt: appliedMap.get(f)?.toISOString(),
  }));
}
