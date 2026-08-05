// ============================================================
// PATIO — Boot-Entrypoint
// ============================================================
// PATIO ist ein Planungswerkzeug für Architektur- und Planungsbüros.
// Zielnutzer sind Architekten, Projektleiter, Statiker und Sachbearbeiter
// im Buero, nicht der Polier auf dem Geruest.
//
// Stundenerfassung, Bautagebuch und Meetings dienen der Doku IM BUERO,
// retrospektiv (abends, nach der Begehung, am Schreibtisch). Echtzeit-
// Schnelleingabe vom Bauwagen ist nicht das Designziel.
//
// Startreihenfolge: .env → Datenbank (Healthcheck + Migrationen) → Web-API.
// Frueher stand hier der Telegram-Bot an erster Stelle und die API kam
// nebenbei; seit dem Umbau zum Firmenserver ist die API der einzige Dienst.
// ============================================================

import "dotenv/config";
import { logInfo, logWarn, logError, flushLogsSync } from "./logger.js";
import {
  DB_ENABLED,
  DB_AUTO_MIGRATE,
  ENCRYPTION_KEY_SET,
  ENCRYPTION_KEY_OK,
  API_ENABLED,
  JWT_SECRET_OK,
  IS_PRODUCTION,
} from "./config.js";

// INF-13: den Log-Flush GANZ FRUEH registrieren — noch vor den Pre-Flight-
// Checks. Sonst gingen genau die Zeilen verloren, die erklaeren, warum der
// Boot abgebrochen hat (das JSONL-Log puffert; console.* schreibt sofort).
process.on("exit", flushLogsSync);

/**
 * Pre-Flight-Abbruch: Meldung rausschreiben, Prozess mit Exit-Code 1 beenden.
 * Bewusst KEIN Weiterlaufen — ein Dienst, der ohne seine Pflicht-Konfiguration
 * startet, sieht fuer Docker/systemd gesund aus und ist trotzdem tot.
 */
function abortBoot(context: string, message: string): never {
  logError(context, message);
  process.exit(1);
}

const workspacePath = process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH;
if (!workspacePath) {
  abortBoot(
    "[BOOT]",
    "WORKSPACE_PATH fehlt in .env. PATIO legt Dokumente als Dateien ab und braucht dafuer ein Verzeichnis.",
  );
}

// ── Datenbank initialisieren (PFLICHT) ───────────────────────────────────────
// Es gibt seit dem Umbau zum Firmenserver KEINEN Filesystem-Modus mehr:
// src/data/index.ts bindet hart die db-*-Repos, und getDb() wirft ohne
// DATABASE_URL. Frueher lief der Prozess hier einfach weiter und loggte
// "nur Filesystem-Modus" — der Server hoerte dann auf Port 3000, der
// Container galt als healthy, und JEDER Datenzugriff endete in einem 500.
// Genau dieser stille Zombie-Zustand ist der Grund fuer den harten Abbruch.
if (!DB_ENABLED) {
  abortBoot(
    "[DB]",
    "DATABASE_URL fehlt in .env. PATIO laeuft ausschliesslich gegen PostgreSQL — " +
      "einen Filesystem-Modus gibt es nicht mehr. Ohne DATABASE_URL waere jeder " +
      "Datenzugriff ein 500er. Beispiel: DATABASE_URL=postgres://patio:PASSWORT@localhost:5432/patio",
  );
}

try {
  const { checkDbHealth, runMigrations } = await import("./db/index.js");
  const healthy = await checkDbHealth();
  if (!healthy) {
    abortBoot(
      "[DB]",
      "DATABASE_URL ist gesetzt, aber die Datenbank antwortet nicht. " +
        "Postgres starten bzw. Host/Port/Zugangsdaten in DATABASE_URL pruefen.",
    );
  }
  logInfo("[DB] PostgreSQL verbunden");

  // Auto-Migrate beim Start — per DB_AUTO_MIGRATE=false abschaltbar
  if (DB_AUTO_MIGRATE) {
    await runMigrations();
  } else {
    logInfo("[DB] DB_AUTO_MIGRATE=false — Migrations uebersprungen");
  }

  // Legacy-JSON-User in die DB nachziehen (idempotent). Nach dem
  // Migrations-Run, weil das users-Schema dann garantiert bereitsteht.
  try {
    const { importLegacyJsonUsers } = await import("./api/auth.js");
    const result = await importLegacyJsonUsers();
    if (result.imported > 0) {
      logInfo(`[DB] ${result.imported} Legacy-JSON-User in die DB importiert (${result.skipped} schon vorhanden)`);
    }
  } catch (err) {
    logError("[DB] Legacy-User-Import fehlgeschlagen", err);
    // Nicht fatal — Server kann trotzdem starten, JSON-Fallback bleibt aktiv.
  }
} catch (err) {
  logError("[DB]", err);
  process.exit(1);
}

// SEC-4: Hinweis, wenn die Feld-Verschluesselung noch am JWT_SECRET haengt.
// Kein harter Abbruch — der Rueckfall funktioniert, ist aber nicht das Ziel.
if (!ENCRYPTION_KEY_SET) {
  logWarn(
    IS_PRODUCTION
      ? "ENCRYPTION_KEY nicht gesetzt — Feld-Verschluesselung nutzt JWT_SECRET als Rueckfall. Eigenen Key setzen + `npm run db:reencrypt` laufen (docs/sec-4-crypto-migration.md)."
      : "ENCRYPTION_KEY nicht gesetzt — Dev nutzt JWT_SECRET-Rueckfall fuer die Feld-Verschluesselung.",
    "SEC-4",
  );
}

// SEC-4: ENCRYPTION_KEY ist zwar gesetzt, aber zu kurz. Bisher lief so ein
// schwacher Schluessel still durch (ENCRYPTION_KEY_OK war toter Code). Nur
// warnen — kein harter Abbruch, damit der Deploy nicht blockiert.
if (ENCRYPTION_KEY_SET && !ENCRYPTION_KEY_OK) {
  logWarn("ENCRYPTION_KEY ist zu kurz (<32 Zeichen) — schwacher Schluessel, bitte >=32 Zeichen setzen.", "SEC-4");
}

// ── Web-API starten (PFLICHT) ────────────────────────────────────────────────
// JWT_SECRET leer hiess bisher: API wird uebersprungen, der Maintenance-Cron
// unten haelt den Event-Loop aber offen. Ergebnis war ein Prozess ohne Dienst —
// er laeuft, hoert auf nichts und faellt in keinem Monitoring auf. Da die API
// der EINZIGE Dienst ist (Bot und Agenten-Laufzeit sind mit AP0 entfallen),
// ist ein fehlendes JWT_SECRET genauso fatal wie eine fehlende DATABASE_URL.
if (!API_ENABLED) {
  abortBoot(
    "[API]",
    "JWT_SECRET fehlt in .env. Die Web-API ist der einzige Dienst von PATIO — " +
      "ohne Secret gaebe es keinen Login und damit keinen Dienst, der Prozess " +
      "wuerde nur noch den Maintenance-Cron offen halten. " +
      "Secret erzeugen: openssl rand -base64 48",
  );
}

// Production-Hardening: schwaches Secret = harter Stop. Dev-Modus warnt nur,
// damit lokale Smoke-Tests mit Default-Configs noch starten.
if (!JWT_SECRET_OK) {
  if (IS_PRODUCTION) {
    abortBoot(
      "[API]",
      "JWT_SECRET zu kurz (<32 Zeichen). Production-Start verweigert. " +
        "Bitte ein starkes Secret setzen: openssl rand -base64 48",
    );
  } else {
    logWarn("JWT_SECRET ist <32 Zeichen. In Production wuerde der Start verweigert.", "API");
  }
}

const { startApi } = await import("./api/server.js");
startApi();
logInfo("PATIO gestartet");

// Maintenance-Cron (Audit-Log-Retention, abgelaufene Pair-Tokens etc.).
// Alle Tasks sind DB-getrieben — die DB ist an dieser Stelle garantiert da,
// sonst waere der Boot oben schon abgebrochen.
const { startMaintenanceCron } = await import("./maintenance.js");
startMaintenanceCron();

// Graceful Shutdown — die DB-Verbindung ist ab hier immer offen.
async function shutdown(signal: string): Promise<void> {
  logInfo(`${signal} empfangen — fahre herunter...`);
  try {
    const { closeDb } = await import("./db/index.js");
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Prozess-Level-Fehlerhandler: eine unbehandelte Promise-Rejection oder Exception
// darf den Dienst nicht STILL runterreissen. Ursache mit Stack loggen, dann
// kontrolliert beenden — restart:always (Compose) faehrt den Prozess sauber
// wieder hoch. Kein Weiterlaufen in undefiniertem Zustand.
process.on("unhandledRejection", (reason) => {
  logError("[FATAL] Unhandled Promise Rejection — Prozess wird beendet", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logError("[FATAL] Uncaught Exception — Prozess wird beendet", err);
  process.exit(1);
});
