// ============================================================
// PATIO — Bot-Manager (Phase 6)
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
  /** Telegram-Username (ohne @) — fuer UI-Anzeige (t.me/<username>). */
  username?: string | null;
}

const bots = new Map<string, BotEntry>();
let started = false;

// INF-5: Auto-Respawn abgestuerzter Bots mit Exponential-Backoff.
const RESTART_MAX_ATTEMPTS = 5;
const RESTART_BASE_MS = 5_000;
const RESTART_MAX_MS = 600_000; // 10 min Cap
const restartAttempts = new Map<string, number>();
const stopping = new Set<string>(); // bewusst gestoppte Bots -> kein Respawn

/** Default-Bot aus Env BOT_TOKEN. Wird von index.ts beim Boot per
 *  setDefaultBot() registriert und vom Notifications-Modul als Fallback
 *  benutzt, wenn ein User keinen eigenen Bot hat. */
let defaultBot: Bot | null = null;
let defaultBotUsername: string | null = null;

/** Registriert den Default-Bot. Versucht parallel, den Telegram-Username
 *  per getMe() zu laden — Fehler sind harmlos (UI faellt dann auf
 *  generischen Hinweis zurueck). */
export async function setDefaultBot(bot: Bot): Promise<void> {
  defaultBot = bot;
  try {
    const me = await bot.api.getMe();
    defaultBotUsername = me.username ?? null;
    if (defaultBotUsername) logInfo(`[BotManager] Default-Bot ist @${defaultBotUsername}`);
  } catch (err) {
    logError("[BotManager] getMe fuer Default-Bot fehlgeschlagen", err);
  }
}

export function getDefaultBot(): Bot | null {
  return defaultBot;
}

export function getDefaultBotUsername(): string | null {
  return defaultBotUsername;
}

/** Username des Bots, ueber den ein User benachrichtigt / gepairt wird:
 *  bevorzugt sein eigener Bot, sonst der Default. Fuer das UI wichtig,
 *  damit der Pair-Dialog den richtigen Bot-Namen anzeigt. */
export function getBotUsernameForUser(userId: string): string | null {
  return bots.get(userId)?.username ?? defaultBotUsername;
}

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
    // Username vorm Polling-Start abfragen — getMe() ist eine eigenstaendige
    // Telegram-API-Anfrage, braucht weder bot.start() noch eine offene
    // Connection. Wenn der Token ungueltig ist, kommt hier ein Fehler — wir
    // brechen dann ab und zeigen den Token gar nicht erst als "aktiv" an.
    let username: string | null = null;
    try {
      const me = await bot.api.getMe();
      username = me.username ?? null;
    } catch (err) {
      logError(
        `[BotManager] Bot-Token von "${user.username}" ist ungueltig (getMe fehlgeschlagen). Bot wird NICHT gestartet.`,
        err,
      );
      return;
    }
    // grammy bot.start() ist long-running (poll loop) — wir wollen es nicht
    // awaiten, sondern als Promise speichern, damit wir es spaeter sauber
    // abbrechen koennen via bot.stop().
    const running = bot.start({ drop_pending_updates: true }).catch((err) => {
      logError(`[BotManager] Bot fuer ${user.username} ist abgestuerzt`, err);
      bots.delete(user.id);
      scheduleRespawn(user);
    });
    bots.set(user.id, { user, bot, running, username });
    restartAttempts.delete(user.id); // erfolgreicher Start -> Zaehler zuruecksetzen
    logInfo(`[BotManager] Bot fuer "${user.username}" gestartet (@${username ?? "?"})`);
  } catch (err) {
    logError(`[BotManager] Konnte Bot fuer "${user.username}" nicht starten`, err);
  }
}

/** INF-5: Startet einen abgestuerzten Bot mit Exponential-Backoff neu. Kein
 *  Respawn, wenn der Bot bewusst gestoppt wurde (stopping-Flag) oder die
 *  Max-Versuche erreicht sind — dann bleibt er aus, bis ein refresh() (z.B.
 *  Token-Aenderung) ihn erneut spawnt. */
function scheduleRespawn(user: DbUser): void {
  if (stopping.has(user.id)) return; // bewusst gestoppt
  const attempt = (restartAttempts.get(user.id) ?? 0) + 1;
  if (attempt > RESTART_MAX_ATTEMPTS) {
    restartAttempts.delete(user.id);
    logError(
      `[BotManager] Bot fuer "${user.username}" nach ${RESTART_MAX_ATTEMPTS} Versuchen aufgegeben — erst naechster refresh() startet ihn erneut.`,
      new Error("Max-Respawn-Versuche erreicht"),
    );
    return;
  }
  restartAttempts.set(user.id, attempt);
  const delay = Math.min(RESTART_BASE_MS * 2 ** (attempt - 1), RESTART_MAX_MS);
  logInfo(
    `[BotManager] Bot fuer "${user.username}" Respawn ${attempt}/${RESTART_MAX_ATTEMPTS} in ${Math.round(delay / 1000)}s`,
  );
  const timer = setTimeout(() => {
    if (stopping.has(user.id) || bots.has(user.id)) return; // inzwischen gestoppt/wieder da
    void spawnBot(user);
  }, delay);
  timer.unref?.(); // Respawn-Timer soll den Prozess-Shutdown nicht blockieren
}

async function stopBot(userId: string): Promise<void> {
  const entry = bots.get(userId);
  if (!entry) return;
  stopping.add(userId); // verhindert Auto-Respawn durch den .catch
  try {
    await entry.bot.stop();
  } catch (err) {
    logError(`[BotManager] Fehler beim Stoppen des Bots fuer "${entry.user.username}"`, err);
  }
  bots.delete(userId);
  restartAttempts.delete(userId);
  stopping.delete(userId);
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

/** Liefert den grammy-Bot fuer einen User (oder null). Wird vom
 *  Notifications-Modul verwendet, um DMs ueber den User-eigenen Bot
 *  zu schicken — falls der laeuft. */
export function getBot(userId: string): Bot | null {
  return bots.get(userId)?.bot ?? null;
}
