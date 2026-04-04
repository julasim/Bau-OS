import "dotenv/config";
import { createBot } from "./bot.js";

const token = process.env.BOT_TOKEN;
const vaultPath = process.env.VAULT_PATH;

if (!token) throw new Error("BOT_TOKEN fehlt in .env");
if (!vaultPath) throw new Error("VAULT_PATH fehlt in .env");

const bot = createBot(token);

console.log("Bau-OS gestartet...");
bot.start();
