// ============================================================
// Bau-OS — Notifications via Telegram
// ============================================================
// Schickt Telegram-DMs an User wenn:
//   - sie zu einem Projekt hinzugefuegt werden
//   - ihnen eine Aufgabe zugewiesen wird
//   - sie zu einem Termin / Meeting eingeladen werden
//   - eine Datei mit ihnen geteilt wird
//
// Architektur:
//   - notifyUser(userId, message) ist der Core. Loadt den User aus der
//     DB, holt seine telegram_chat_id und sendet via Telegram-Bot.
//   - Bot-Auswahl: bevorzugt der User-eigene Bot (Phase 6, BotManager).
//     Fallback ist der Default-Bot aus Env BOT_TOKEN. Dadurch sieht der
//     User die Nachricht in seinem eigenen Bot-Chat — konsistent mit
//     dem Self-Pairing-Flow.
//   - Pre-Conditions: User muss telegramChatId haben + telegramBotEnabled
//     (sonst wurde der eigene Bot nicht gestartet, aber wir versuchen es
//     trotzdem ueber den Default-Bot fuer's Notifications-Receiving).
//   - Per-User-Settings.notifications: false → Opt-out, kein DM.
//   - Fail-soft: Telegram-API-Fehler werden geloggt aber NICHT durch-
//     gereicht. Eine fehlende Notification darf den User-facing Request
//     nie sprengen.
// ============================================================

import { findDbUserById } from "./api/auth.js";
import { getBot, getDefaultBot } from "./bot-manager.js";
import { logError, logInfo } from "./logger.js";
import { getDb } from "./db/client.js";
import { DB_ENABLED } from "./config.js";

interface NotifyOptions {
  /** "Markdown" macht *fett* + _kursiv_ + `code` lesbar. Default: kein
   *  Parsing — User-Inputs werden so 1:1 angezeigt, ohne Telegram zu
   *  zwingen, eckige Klammern oder Underscores zu eskapieren. */
  parseMode?: "Markdown" | "HTML";
}

/** Schickt einem User eine Telegram-DM. Liefert true wenn versendet,
 *  false wenn skipped (kein chat_id, opt-out, kein Bot verfuegbar). */
export async function notifyUser(userId: string, message: string, opts: NotifyOptions = {}): Promise<boolean> {
  try {
    const user = await findDbUserById(userId);
    if (!user) return false;
    if (!user.telegramChatId) return false; // nicht gepaired
    // Opt-out: Default ist "an" — User muss explizit notificationsEnabled=false
    // in seinen Settings haben, damit nicht benachrichtigt wird.
    if (user.settings?.notificationsEnabled === false) return false;

    // Bot-Auswahl: User-eigener Bot zuerst, sonst Default.
    const bot = getBot(userId) ?? getDefaultBot();
    if (!bot) {
      logInfo(`[Notify] Kein Bot verfuegbar fuer User ${user.username}`);
      return false;
    }

    await bot.api.sendMessage(user.telegramChatId, message, {
      parse_mode: opts.parseMode,
    });
    return true;
  } catch (err) {
    logError(`[Notify] Senden fehlgeschlagen fuer User ${userId}`, err);
    return false;
  }
}

/** Resolver: team_members.id → users.id (oder null wenn kein User-Link
 *  oder Team-Mitglied existiert nicht). Nutzt user_id-Spalte aus
 *  Migration 013. Im FS-Mode existiert die Tabelle nicht → null. */
export async function resolveUserIdsFromMembers(memberIds: string[]): Promise<string[]> {
  if (!DB_ENABLED || memberIds.length === 0) return [];
  try {
    const db = getDb();
    const rows = await db`
      SELECT user_id FROM team_members
       WHERE id = ANY(${memberIds}) AND user_id IS NOT NULL
    `;
    return rows.map((r) => String(r.user_id));
  } catch (err) {
    logError("[Notify] resolveUserIdsFromMembers fehlgeschlagen", err);
    return [];
  }
}

/** Single-Variante: team_members.id → users.id (oder null). */
export async function resolveUserIdFromMember(memberId: string): Promise<string | null> {
  const ids = await resolveUserIdsFromMembers([memberId]);
  return ids[0] ?? null;
}

/** Multi-Cast: schickt allen Usern parallel die gleiche Nachricht.
 *  Eigene Aktionen (currentUserId) werden uebersprungen — kein Self-Ping. */
export async function notifyUsers(
  userIds: string[],
  message: string,
  opts: NotifyOptions & { excludeUserId?: string | null } = {},
): Promise<void> {
  const targets = userIds.filter((id) => id && id !== opts.excludeUserId);
  if (targets.length === 0) return;
  await Promise.all(targets.map((id) => notifyUser(id, message, opts)));
}

// ── Spezialisierte Nachrichten-Formatter ─────────────────────────────────
// Pattern: jede Funktion baut den Text und ruft notifyUser/notifyUsers.
// Inhalte bleiben kompakt — Telegram Push-Notifications werden nur die
// ersten ~80 Zeichen anzeigen.

export async function notifyProjectAccessGranted(
  userId: string,
  projectName: string,
  byName?: string | null,
): Promise<void> {
  const lines = [`🔑 Du hast Zugriff auf das Projekt erhalten:`, projectName];
  if (byName) lines.push(`(freigegeben von ${byName})`);
  await notifyUser(userId, lines.join("\n"));
}

export async function notifyTaskAssigned(
  userId: string,
  task: { text: string; project?: string | null; date?: string | null },
  byName?: string | null,
): Promise<void> {
  const lines = [`✅ Neue Aufgabe für dich:`, task.text];
  if (task.project) lines.push(`📁 ${task.project}`);
  if (task.date) lines.push(`📅 fällig: ${task.date}`);
  if (byName) lines.push(`— von ${byName}`);
  await notifyUser(userId, lines.join("\n"));
}

export async function notifyTerminInvited(
  userIds: string[],
  termin: { text: string; datum: string; uhrzeit?: string | null; project?: string | null },
  excludeUserId: string | null,
  byName?: string | null,
): Promise<void> {
  const lines = [`📅 Termin-Einladung:`, termin.text, `${termin.datum}${termin.uhrzeit ? ` ${termin.uhrzeit}` : ""}`];
  if (termin.project) lines.push(`📁 ${termin.project}`);
  if (byName) lines.push(`— von ${byName}`);
  await notifyUsers(userIds, lines.join("\n"), { excludeUserId });
}

export async function notifyMeetingInvited(
  userIds: string[],
  meeting: {
    title: string;
    date: string;
    startTime?: string | null;
    location?: string | null;
    meetingType?: string | null;
    project?: string | null;
  },
  excludeUserId: string | null,
  byName?: string | null,
): Promise<void> {
  const typeStr = meeting.meetingType ? `[${meeting.meetingType}] ` : "";
  const lines = [
    `📋 Meeting-Einladung: ${typeStr}${meeting.title}`,
    `${meeting.date}${meeting.startTime ? ` ${meeting.startTime}` : ""}`,
  ];
  if (meeting.location) lines.push(`📍 ${meeting.location}`);
  if (meeting.project) lines.push(`📁 ${meeting.project}`);
  if (byName) lines.push(`— von ${byName}`);
  await notifyUsers(userIds, lines.join("\n"), { excludeUserId });
}

export async function notifyFileShared(
  userId: string,
  file: { filename: string; project?: string | null },
  canEdit: boolean,
  byName?: string | null,
): Promise<void> {
  const lines = [`📎 Datei wurde mit dir geteilt:`, file.filename, canEdit ? `(Lesen + Bearbeiten)` : `(nur Lesen)`];
  if (file.project) lines.push(`📁 ${file.project}`);
  if (byName) lines.push(`— von ${byName}`);
  await notifyUser(userId, lines.join("\n"));
}
