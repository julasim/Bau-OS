// ============================================================
// Bau-OS — PostgreSQL Client (postgres.js)
// Singleton Connection Pool mit Health-Check
// ============================================================

import postgres from "postgres";
import { DATABASE_URL, DB_ENABLED } from "../config.js";
import { logInfo, logError } from "../logger.js";

let sql: postgres.Sql | null = null;

/**
 * Gibt die aktive PostgreSQL-Verbindung zurueck.
 * Erstellt den Pool beim ersten Aufruf (Lazy Init).
 * Wirft einen Fehler wenn DB_ENABLED=false.
 */
export function getDb(): postgres.Sql {
  if (!DB_ENABLED) {
    throw new Error("Datenbank nicht konfiguriert. Setze DATABASE_URL in .env");
  }
  if (!sql) {
    sql = postgres(DATABASE_URL, {
      max: 20, // Max Connections im Pool
      idle_timeout: 30, // Sekunden bis idle Connection geschlossen wird
      connect_timeout: 10, // Sekunden bis Connect-Timeout
      transform: {
        undefined: null, // undefined → NULL in SQL
      },
      types: {
        // pgvector: float4[] als number[] parsen
        bigint: postgres.BigInt,
      },
    });
    logInfo("[DB] PostgreSQL Connection Pool erstellt");
  }
  return sql;
}

/**
 * Health-Check: Testet ob die DB erreichbar ist.
 * @returns true wenn die Verbindung funktioniert
 */
export async function checkDbHealth(): Promise<boolean> {
  if (!DB_ENABLED) return false;
  try {
    const db = getDb();
    const result = await db`SELECT 1 as ok`;
    return result[0]?.ok === 1;
  } catch (err) {
    logError("[DB] Health-Check fehlgeschlagen", err);
    return false;
  }
}

/**
 * Prueft ob pgvector Extension installiert ist.
 */
export async function checkPgVector(): Promise<boolean> {
  if (!DB_ENABLED) return false;
  try {
    const db = getDb();
    const result = await db`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Schliesst den Connection Pool sauber.
 * Aufruf bei Graceful Shutdown.
 */
export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
    logInfo("[DB] Connection Pool geschlossen");
  }
}

export { sql };
