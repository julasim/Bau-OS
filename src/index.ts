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
// ============================================================

import "dotenv/config";
import { createBot } from "./bot.js";
import { startHeartbeat } from "./heartbeat.js";
import { logInfo, logWarn, logError, flushLogsSync } from "./logger.js";
import { Bot } from "grammy";
import { DB_ENABLED, DB_AUTO_MIGRATE, ENCRYPTION_KEY_SET } from "./config.js";

const token = process.env.BOT_TOKEN;
const workspacePath = process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH;

if (!token) throw new Error("BOT_TOKEN fehlt in .env");
if (!workspacePath) throw new Error("WORKSPACE_PATH fehlt in .env");

// ── Datenbank initialisieren (wenn DATABASE_URL gesetzt) ─────────────────────
if (DB_ENABLED) {
  try {
    const { checkDbHealth, checkPgVector, runMigrations } = await import("./db/index.js");
    const healthy = await checkDbHealth();
    if (!healthy) {
      logError(
        "[DB]",
        "DATABASE_URL ist gesetzt aber die DB antwortet nicht. Entweder Postgres starten oder DATABASE_URL entfernen für FS-Modus.",
      );
      process.exit(1);
    }
    logInfo("[DB] PostgreSQL verbunden");
    const hasVector = await checkPgVector();
    if (hasVector) {
      logInfo("[DB] pgvector Extension aktiv");
      const { checkEmbeddingSchemaDims } = await import("./db/index.js");
      const dimsResult = await checkEmbeddingSchemaDims();
      if (!dimsResult.ok) {
        logError(
          "[DB] Embedding-Dimensionen stimmen nicht ueberein — Embeddings koennen fehlschlagen",
          new Error(
            `Konfiguriert: ${dimsResult.configured}, Schema: notes=${dimsResult.schema?.notes ?? "n/a"}, files=${dimsResult.schema?.files ?? "n/a"}${dimsResult.error ? ` (${dimsResult.error})` : ""}`,
          ),
        );
      }
    } else {
      logInfo("[DB] pgvector Extension nicht gefunden — Embeddings deaktiviert");
    }
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
} else {
  logInfo("[DB] Kein DATABASE_URL gesetzt — nur Filesystem-Modus");
}

const bot = createBot(token) as Bot;

// Default-Bot bei Bot-Manager registrieren — Notifications-Modul nutzt
// ihn als Fallback fuer User ohne eigenen Bot. setDefaultBot ruft auch
// getMe() auf, damit der Username fuers UI bekannt ist.
const { setDefaultBot } = await import("./bot-manager.js");
await setDefaultBot(bot);

const { fmt } = await import("./format.js");

// MCP-Server verbinden (wenn mcp.json vorhanden)
import { initMcp } from "./mcp.js";
await initMcp();

bot.start();
logInfo("PATIO gestartet");

// SEC-4: Hinweis, wenn die Feld-Verschluesselung noch am JWT_SECRET haengt.
// Kein harter Abbruch — der Rueckfall funktioniert, ist aber nicht das Ziel.
if (DB_ENABLED && !ENCRYPTION_KEY_SET) {
  logWarn(
    IS_PRODUCTION
      ? "ENCRYPTION_KEY nicht gesetzt — Feld-Verschluesselung nutzt JWT_SECRET als Rueckfall. Eigenen Key setzen + `npm run db:reencrypt` laufen (docs/sec-4-crypto-migration.md)."
      : "ENCRYPTION_KEY nicht gesetzt — Dev nutzt JWT_SECRET-Rueckfall fuer die Feld-Verschluesselung.",
    "SEC-4",
  );
}

// Heartbeat NACH bot.start() starten — bot.api.sendMessage() braucht eine aktive Verbindung
startHeartbeat(async (chatId, text) => {
  try {
    await bot.api.sendMessage(chatId, fmt(text), { parse_mode: "HTML" });
  } catch {
    await bot.api.sendMessage(chatId, text);
  }
});

// Phase 6: per-User-Bots aus DB starten (parallel zum env-Bot).
// Wirft nur Logs, kein process.exit — wenn ein User-Bot kaputt ist,
// soll der Rest weiterlaufen.
if (DB_ENABLED) {
  try {
    const { startBotManager } = await import("./bot-manager.js");
    await startBotManager();
  } catch (err) {
    logError("[BotManager]", err);
  }
}

// Web-API starten (nur wenn JWT_SECRET gesetzt)
import { API_ENABLED, API_PORT, JWT_SECRET_OK, IS_PRODUCTION } from "./config.js";
if (API_ENABLED) {
  // Production-Hardening: schwaches Secret = harter Stop. Dev-Modus warnt nur,
  // damit lokale Smoke-Tests mit Default-Configs noch starten.
  if (!JWT_SECRET_OK) {
    if (IS_PRODUCTION) {
      logError(
        "[API] JWT_SECRET zu kurz (<32 Zeichen). Production-Start verweigert.",
        new Error("Bitte ein starkes Secret setzen: openssl rand -base64 48"),
      );
      process.exit(1);
    } else {
      logInfo("[API] WARN — JWT_SECRET ist <32 Zeichen. In Production wuerde der Start verweigert.");
    }
  }
  const { startApi } = await import("./api/server.js");
  startApi();
} else {
  logInfo("[API] Web-API deaktiviert (JWT_SECRET nicht gesetzt)");
}

// Maintenance-Cron (Audit-Log-Retention, abgelaufene Pair-Tokens etc.)
// Laeuft nur im DB-Modus, weil alle Tasks DB-getrieben sind.
if (DB_ENABLED) {
  const { startMaintenanceCron } = await import("./maintenance.js");
  startMaintenanceCron();
}

// Graceful Shutdown
async function shutdown(signal: string): Promise<void> {
  logInfo(`${signal} empfangen — fahre herunter...`);
  try {
    bot.stop();
  } catch {
    /* ignore */
  }
  const { disconnectAll } = await import("./mcp.js");
  try {
    await disconnectAll();
  } catch {
    /* ignore */
  }
  // Datenbank-Verbindung schliessen
  if (DB_ENABLED) {
    try {
      const { closeDb } = await import("./db/index.js");
      await closeDb();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// INF-13: beim Prozess-Ende die noch nicht async geschriebenen Log-Zeilen
// synchron rausschreiben. Feuert bei JEDEM Exit-Pfad (shutdown, process.exit
// aus den Fatal-Handlern, DB-Init-Fehler) — sonst gingen die letzten Logs,
// gerade die Fatal-Meldungen, verloren.
process.on("exit", flushLogsSync);

// Prozess-Level-Fehlerhandler: eine unbehandelte Promise-Rejection oder Exception
// (z.B. ein fehlgeschlagener Bot-Init) darf den Dienst nicht STILL runterreissen.
// Ursache mit Stack loggen, dann kontrolliert beenden — restart:always (Compose)
// faehrt den Prozess sauber wieder hoch. Kein Weiterlaufen in undefiniertem Zustand.
process.on("unhandledRejection", (reason) => {
  logError("[FATAL] Unhandled Promise Rejection — Prozess wird beendet", reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logError("[FATAL] Uncaught Exception — Prozess wird beendet", err);
  process.exit(1);
});
