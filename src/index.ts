import "dotenv/config";
import { createBot } from "./bot.js";
import { startHeartbeat } from "./heartbeat.js";
import { logInfo, logError } from "./logger.js";
import { Bot } from "grammy";
import { DB_ENABLED, DB_AUTO_MIGRATE } from "./config.js";

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
    } else {
      logInfo("[DB] pgvector Extension nicht gefunden — Embeddings deaktiviert");
    }
    // Auto-Migrate beim Start — per DB_AUTO_MIGRATE=false abschaltbar
    if (DB_AUTO_MIGRATE) {
      await runMigrations();
    } else {
      logInfo("[DB] DB_AUTO_MIGRATE=false — Migrations uebersprungen");
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
// ihn als Fallback fuer User ohne eigenen Bot.
const { setDefaultBot } = await import("./bot-manager.js");
setDefaultBot(bot);

const { fmt } = await import("./format.js");
startHeartbeat(async (chatId, text) => {
  try {
    await bot.api.sendMessage(chatId, fmt(text), { parse_mode: "HTML" });
  } catch {
    await bot.api.sendMessage(chatId, text);
  }
});

// MCP-Server verbinden (wenn mcp.json vorhanden)
import { initMcp } from "./mcp.js";
await initMcp();

bot.start();
logInfo("Bau-OS gestartet");

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
import { API_ENABLED, API_PORT } from "./config.js";
if (API_ENABLED) {
  const { startApi } = await import("./api/server.js");
  startApi();
  // Supabase Realtime Bridge starten (wenn verfuegbar)
  const { startRealtimeBridge } = await import("./api/realtime-bridge.js");
  await startRealtimeBridge();
} else {
  logInfo("[API] Web-API deaktiviert (JWT_SECRET nicht gesetzt)");
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
