import "dotenv/config";
import { createBot } from "./bot.js";
import { startHeartbeat } from "./heartbeat.js";
import { logInfo, logError } from "./logger.js";
import { Bot } from "grammy";
import { DB_ENABLED } from "./config.js";

const token = process.env.BOT_TOKEN;
const vaultPath = process.env.VAULT_PATH;

if (!token) throw new Error("BOT_TOKEN fehlt in .env");
if (!vaultPath) throw new Error("VAULT_PATH fehlt in .env");

// ── Datenbank initialisieren (wenn DATABASE_URL gesetzt) ─────────────────────
if (DB_ENABLED) {
  try {
    const { checkDbHealth, checkPgVector, runMigrations } = await import("./db/index.js");
    const healthy = await checkDbHealth();
    if (healthy) {
      logInfo("[DB] PostgreSQL verbunden");
      const hasVector = await checkPgVector();
      if (hasVector) {
        logInfo("[DB] pgvector Extension aktiv");
      } else {
        logInfo("[DB] pgvector Extension nicht gefunden — Embeddings deaktiviert");
      }
      // Auto-Migrate beim Start
      await runMigrations();
    } else {
      logInfo("[DB] PostgreSQL nicht erreichbar — Fallback auf Filesystem");
    }
  } catch (err) {
    logError("[DB]", err);
  }
} else {
  logInfo("[DB] Kein DATABASE_URL gesetzt — nur Filesystem-Modus");
}

const bot = createBot(token) as Bot;

startHeartbeat(async (chatId, text) => {
  const { fmt } = await import("./format.js");
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
