// ============================================================
// Bau-OS — Bot-Manager (Phase 6)
// ============================================================
// Verwaltet die Lebenszyklen aller per-User-Telegram-Bots:
//   - Beim Start: alle aktivierten User-Bots aus der DB laden + spawnen
//   - Wenn User Token setzt/loescht via API: Bot spawnen/stoppen
//   - Bei Fehlern beim Start: loggen, andere Bots laufen weiter
//
// Synchronisation mit der DB laeuft via refresh()-Aufruf nach jeder
// Aenderung (statt poll-Loop) — direkt vom API-Handler getriggert.
// ============================================================

import type { Bot } from "grammy";
import { listBotEnabledUsers, type DbUser } from "./api/auth.js";
import { createBot } from "./bot.js";
import { logInfo, logError } from "./logger.js";

interface BotEntry {
  user: DbUser;
  bot: Bot;
  /** Promise des bot.start()-Calls. Wird beim stop() awaited. */
  running: Promise<void>;
}

const bots = new Map<string, BotEntry>();
let started = false;

/** Initialer Start: alle aktiven User-Bots aus der DB laden und spawnen. */
export async function startBotManager(): Promise<void> {
  if (started) return;
  started = true;
  await refresh();
  logInfo(`[BotManager] ${bots.size} per-User-Bot(s) gestartet`);
}

/** Synchronisiert die laufenden Bots mit dem DB-Stand:
 *   - Neue User mit Token, die noch nicht laufen → spawnen
 *   - Laufende Bots, die in DB nicht mehr aktiv sind → stoppen
 *   - Token-Wechsel: alten Bot stoppen, neuen spawnen
 *
 * Wird beim Boot (startBotManager) und nach jeder Token-Aenderung
 * via API aufgerufen. */
export async function refresh(): Promise<void> {
  const enabled = await listBotEnabledUsers();
  const enabledById = new Map(enabled.map((u) => [u.id, u]));

  // 1) Stoppen, was nicht mehr aktiv ist oder dessen Token sich geaendert hat.
  for (const [userId, entry] of bots.entries()) {
    const live = enabledById.get(userId);
    if (!live || live.telegramBotToken !== entry.user.telegramBotToken) {
      await stopBot(userId);
    }
  }

  // 2) Spawnen, was noch nicht laeuft.
  for (const user of enabled) {
    if (!user.telegramBotToken) {
      // user_id war in DB-Liste (mit telegram_bot_token IS NOT NULL), aber
      // nach Decryption ist Token null — typisch nach JWT_SECRET-Wechsel
      // oder beschaedigten Daten. User muss Token neu eintragen.
      logError(
        `[BotManager] Bot-Token fuer "${user.username}" ist nicht entschluesselbar — User muss Token neu eintragen.`,
        new Error("decrypt failed"),
      );
      continue;
    }
    if (bots.has(user.id)) continue;
    await spawnBot(user);
  }
}

async function spawnBot(user: DbUser): Promise<void> {
  if (!user.telegramBotToken) return;
  try {
    const bot = createBot(user.telegramBotToken, user);
    // grammy bot.start() ist long-running (poll loop) — wir wollen es nicht
    // awaiten, sondern als Promise speichern, damit wir es spaeter sauber
    // abbrechen koennen via bot.stop().
    const running = bot.start({ drop_pending_updates: true }).catch((err) => {
      logError(`[BotManager] Bot fuer ${user.username} ist abgestuerzt`, err);
      bots.delete(user.id);
    });
    bots.set(user.id, { user, bot, running });
    logInfo(`[BotManager] Bot fuer "${user.username}" gestartet`);
  } catch (err) {
    logError(`[BotManager] Konnte Bot fuer "${user.username}" nicht starten`, err);
  }
}

async function stopBot(userId: string): Promise<void> {
  const entry = bots.get(userId);
  if (!entry) return;
  try {
    await entry.bot.stop();
  } catch (err) {
    logError(`[BotManager] Fehler beim Stoppen des Bots fuer "${entry.user.username}"`, err);
  }
  bots.delete(userId);
  logInfo(`[BotManager] Bot fuer "${entry.user.username}" gestoppt`);
}

/** Liefert Statusinformationen fuer das Admin-UI / Settings-View. */
export function getBotStatus(userId: string): "running" | "stopped" | "unknown" {
  if (!started) return "unknown";
  return bots.has(userId) ? "running" : "stopped";
}

/** Anzahl aktuell laufender per-User-Bots — fuer das Dashboard / Healthcheck. */
export function getRunningBotCount(): number {
  return bots.size;
}
