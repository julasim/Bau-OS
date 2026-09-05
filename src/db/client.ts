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
/**
 * Ein Wert fuer eine `jsonb`-Spalte.
 *
 * ── Warum es diesen Helfer gibt, und zwar an EINER Stelle ─────────────────
 *
 * Im Haus stand siebenmal `${JSON.stringify(x)}::jsonb`. Das sieht richtig aus
 * und ist es nicht: postgres.js serialisiert die uebergebene ZEICHENKETTE noch
 * einmal, in der Spalte landet ein JSON-String statt eines Objekts. Am Treiber
 * nachgemessen (02.09.2026, postgres 3.4.9 — die installierte Fassung; in
 * `package.json` steht `^3.4.7`, das ist nur die Untergrenze):
 *
 *   ${JSON.stringify(x)}::jsonb   ->   jsonb_typeof = 'string'
 *   ${sql.json(x)}                ->   jsonb_typeof = 'object' bzw. 'array'
 *
 * Folgenreich war das an drei Stellen: das Pruefprotokoll zeigte zu jedem
 * Eintrag `{}` (alle 2839), **jeder Kontaktvermerk eines Team-Mitglieds war
 * unsichtbar** (223 von 223 Zeilen), und die Einstellungen eines Kontos gingen
 * beim naechsten Speichern verloren, weil dieselbe Funktion sie MERGT.
 *
 * ── Warum der Cast noetig ist ─────────────────────────────────────────────
 *
 * `sql.json()` verlangt `postgres.JSONValue`. Ein typisiertes Array
 * (`InvoicePosition[]`, `EntscheidungAlternative[]`) laesst sich darauf nicht
 * einengen — TypeScript vermisst die Index-Signatur. Der Cast sagt dem
 * Compiler, was der Aufrufvertrag ohnehin verlangt: JSON-taugliches Material.
 * Er steht hier einmal statt an sieben Aufrufstellen.
 *
 * Nachgemessen: ein ARRAY wird dabei zu jsonb, **nicht** zu einem
 * Postgres-Array — `jsonb_typeof` sagt `array`.
 */
export function jsonb(wert: unknown): postgres.Parameter {
  return getDb().json(wert as postgres.JSONValue);
}

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
        // `bigint` als JS-BigInt statt als Zeichenkette — betrifft `count(*)`
        // und die Groessenangaben in den Kennzahlen.
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

// `withRetry()` stand hier — eine Wiederholung bei kurzzeitigen
// Verbindungsfehlern, die nie ein Aufrufer benutzt hat (geprueft ueber src,
// web, tests, scripts). postgres.js baut die Verbindung von sich aus neu auf;
// was hier fehlte, war der Fall „Datenbank dauerhaft weg", und den beantwortet
// die Anwendung mit einem Fehler an den Aufrufer, nicht mit Warten.
//
// `export { sql }` stand ebenfalls hier und war doppelt irrefuehrend: keinen
// Importeur, und bis zum ersten `getDb()` ist die Variable `null`.
