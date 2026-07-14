// ============================================================
// PATIO — PostgreSQL Client (postgres.js)
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
 * Liefert Pool-Metriken (Connections insgesamt, idle, waiting).
 * Greift auf interne postgres.js-Felder zu — robust gegen das Fehlen einzelner
 * Felder in unterschiedlichen Versionen.
 */
export function getPoolStats(): {
  max: number;
  total: number | null;
  idle: number | null;
  waiting: number | null;
} {
  const fallback = { max: 20, total: null, idle: null, waiting: null } as const;
  if (!sql) return { ...fallback };
  try {
    // postgres.js legt eigene Pool-Infos intern ab. Typen reichen wir nicht
    // durch — lieber tolerant per "any" lesen, Default falls Feld fehlt.
    const anySql = sql as unknown as {
      options?: { max?: number };
      reserved?: unknown[];
      backlog?: unknown[];
      connections?: { all?: unknown[]; idle?: unknown[] };
    };
    return {
      max: anySql.options?.max ?? 20,
      total: anySql.connections?.all?.length ?? null,
      idle: anySql.connections?.idle?.length ?? null,
      waiting: anySql.backlog?.length ?? null,
    };
  } catch {
    return { ...fallback };
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

/**
 * Führt eine DB-Operation aus und retried bei transienten Connection-Fehlern
 * (ECONNREFUSED, ECONNRESET, Connection terminated, ...).
 * Exponential backoff: 200ms, 600ms, 1800ms. Max 3 Versuche.
 * Nicht für Queries mit Seiteneffekten (INSERT/UPDATE) ohne Transaktion!
 */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /ECONN|terminated|timeout|Connection/i.test(msg);
      if (!transient || i === tries - 1) throw err;
      const delay = 200 * Math.pow(3, i);
      logInfo(`[DB] Retry ${i + 1}/${tries} nach ${delay}ms (${msg.slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export { sql };
