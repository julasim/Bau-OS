import "dotenv/config";
import { createBot } from "./bot.js";
import { startHeartbeat } from "./heartbeat.js";
import { startDashboard } from "./dashboard.js";
import { logInfo } from "./logger.js";
import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const vaultPath = process.env.VAULT_PATH;

if (!token) throw new Error("BOT_TOKEN fehlt in .env");
if (!vaultPath) throw new Error("VAULT_PATH fehlt in .env");

const bot = createBot(token) as Bot;

// Heartbeat: sendet Ergebnis direkt via Telegram API
startHeartbeat(async (chatId, text) => {
  const { fmt } = await import("./format.js");
  try {
    await bot.api.sendMessage(chatId, fmt(text), { parse_mode: "HTML" });
  } catch {
    await bot.api.sendMessage(chatId, text);
  }
});

startDashboard();
bot.start();
logInfo("Bau-OS gestartet");
