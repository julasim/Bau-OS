// ============================================================
// PATIO — Microsoft-Account Repository (Migration 022)
// ============================================================
// CRUD-Operationen fuer user_microsoft_accounts. Tokens werden
// transparent verschluesselt/entschluesselt via crypto.ts (gleicher
// AES-256-GCM-Key wie Bot-Tokens).
//
// Wichtig: keine Plaintext-Tokens jemals nach aussen geben — die
// public-Shape (MsAccountPublic) hat KEINE Token-Felder, nur Status.
// Die internen Funktionen (loadDecryptedTokens) sind explizit als
// "decrypt" benannt damit Caller wissen sie haben Geheimes in der Hand.
// ============================================================

import { getDb } from "../db/client.js";
import { DB_ENABLED } from "../config.js";
import { encryptString, decryptString } from "../api/crypto.js";

export interface MsAccountPublic {
  userId: string;
  msUserId: string;
  msEmail: string;
  msDisplayName: string | null;
  scope: string | null;
  calendarId: string | null;
  calendarMode: "default" | "patio";
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  /** True wenn das access_token in der DB noch nicht abgelaufen ist
   *  (mit 60s Sicherheitsmarge). Caller benutzt das fuer "muss refreshed
   *  werden?"-Entscheidungen. */
  accessTokenValid: boolean;
  /** Microsoft-Graph-Subscription fuer Push-Webhooks (Phase 4). NULL =
   *  noch nicht subscribed (Polling-Fallback aktiv); gesetzt = Instant-
   *  Sync via Webhook. */
  subscriptionId: string | null;
  /** Wann die Subscription bei Microsoft ablaeuft. Renewal-Cron erneuert
   *  sie kurz davor. */
  subscriptionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MsAccountTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scope: string | null;
}

export interface UpsertMsAccountInput {
  userId: string;
  msUserId: string;
  msEmail: string;
  msDisplayName: string | null;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scope: string | null;
}

function rowToPublic(row: Record<string, unknown>): MsAccountPublic {
  const expiresAt =
    row.access_token_expires_at instanceof Date
      ? row.access_token_expires_at
      : new Date(String(row.access_token_expires_at));
  return {
    userId: String(row.user_id),
    msUserId: String(row.ms_user_id),
    msEmail: String(row.ms_email),
    msDisplayName: row.ms_display_name ? String(row.ms_display_name) : null,
    scope: row.scope ? String(row.scope) : null,
    calendarId: row.calendar_id ? String(row.calendar_id) : null,
    calendarMode: (row.calendar_mode === "patio" ? "patio" : "default") as MsAccountPublic["calendarMode"],
    syncEnabled: row.sync_enabled === true,
    lastSyncAt:
      row.last_sync_at instanceof Date
        ? row.last_sync_at.toISOString()
        : row.last_sync_at
          ? String(row.last_sync_at)
          : null,
    lastSyncError: row.last_sync_error ? String(row.last_sync_error) : null,
    accessTokenValid: expiresAt.getTime() > Date.now() + 60_000,
    subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
    subscriptionExpiresAt:
      row.subscription_expires_at instanceof Date
        ? row.subscription_expires_at.toISOString()
        : row.subscription_expires_at
          ? String(row.subscription_expires_at)
          : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** Holt den verbundenen MS-Account eines Users — null wenn nicht verbunden. */
export async function getMsAccount(userId: string): Promise<MsAccountPublic | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`
    SELECT * FROM user_microsoft_accounts WHERE user_id = ${userId} LIMIT 1
  `;
  return row ? rowToPublic(row) : null;
}

/** Internal — gibt die entschluesselten Tokens fuer den Graph-Call zurueck.
 *  Nur intern verwenden, nie ueber API exposen. */
export async function loadDecryptedTokens(userId: string): Promise<MsAccountTokens | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`
    SELECT access_token_encrypted, refresh_token_encrypted, access_token_expires_at, scope
      FROM user_microsoft_accounts WHERE user_id = ${userId} LIMIT 1
  `;
  if (!row) return null;
  const accessToken = decryptString(String(row.access_token_encrypted));
  const refreshToken = decryptString(String(row.refresh_token_encrypted));
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt:
      row.access_token_expires_at instanceof Date
        ? row.access_token_expires_at
        : new Date(String(row.access_token_expires_at)),
    scope: row.scope ? String(row.scope) : null,
  };
}

/** Insert oder Update — wenn schon ein MS-Account fuer diesen User existiert,
 *  werden Tokens ueberschrieben (z.B. nach Re-Connect oder Refresh).
 *  Nutzt ON CONFLICT auf user_id-PK. */
export async function upsertMsAccount(input: UpsertMsAccountInput): Promise<MsAccountPublic> {
  if (!DB_ENABLED) throw new Error("DB-Modus erforderlich");
  const db = getDb();

  const accessEnc = encryptString(input.accessToken);
  const refreshEnc = encryptString(input.refreshToken);
  if (!accessEnc || !refreshEnc) throw new Error("Token-Verschluesselung fehlgeschlagen");

  const [row] = await db`
    INSERT INTO user_microsoft_accounts (
      user_id, ms_user_id, ms_email, ms_display_name,
      access_token_encrypted, refresh_token_encrypted, access_token_expires_at, scope
    ) VALUES (
      ${input.userId}, ${input.msUserId}, ${input.msEmail}, ${input.msDisplayName},
      ${accessEnc}, ${refreshEnc}, ${input.accessTokenExpiresAt.toISOString()}, ${input.scope}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      ms_user_id              = EXCLUDED.ms_user_id,
      ms_email                = EXCLUDED.ms_email,
      ms_display_name         = EXCLUDED.ms_display_name,
      access_token_encrypted  = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      scope                   = EXCLUDED.scope,
      last_sync_error         = NULL
    RETURNING *
  `;
  return rowToPublic(row);
}

/** Nach Refresh-Flow nur die Tokens updaten, nicht die Profil-Felder. */
export async function updateMsTokens(
  userId: string,
  tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: Date; scope: string | null },
): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  const accessEnc = encryptString(tokens.accessToken);
  const refreshEnc = encryptString(tokens.refreshToken);
  if (!accessEnc || !refreshEnc) throw new Error("Token-Verschluesselung fehlgeschlagen");

  await db`
    UPDATE user_microsoft_accounts SET
      access_token_encrypted  = ${accessEnc},
      refresh_token_encrypted = ${refreshEnc},
      access_token_expires_at = ${tokens.accessTokenExpiresAt.toISOString()},
      scope                   = ${tokens.scope}
    WHERE user_id = ${userId}
  `;
}

/** User trennt MS-Verbindung. CASCADE auf user_microsoft_accounts loescht
 *  alles. Termine mit ms_event_id bleiben in PATIO — sie sind dann
 *  einfach nicht mehr in MS gespiegelt. */
export async function deleteMsAccount(userId: string): Promise<boolean> {
  if (!DB_ENABLED) return false;
  const db = getDb();
  const result = await db`DELETE FROM user_microsoft_accounts WHERE user_id = ${userId}`;
  return result.count > 0;
}

/** User aendert Calendar-Mode oder Sync-Schalter. */
export async function updateMsAccountSettings(
  userId: string,
  patch: { calendarMode?: "default" | "patio"; syncEnabled?: boolean; calendarId?: string | null },
): Promise<MsAccountPublic | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [current] = await db`SELECT * FROM user_microsoft_accounts WHERE user_id = ${userId}`;
  if (!current) return null;
  const calendarMode = "calendarMode" in patch ? patch.calendarMode : current.calendar_mode;
  const syncEnabled = "syncEnabled" in patch ? patch.syncEnabled : current.sync_enabled;
  const calendarId = "calendarId" in patch ? patch.calendarId : current.calendar_id;
  const [row] = await db`
    UPDATE user_microsoft_accounts SET
      calendar_mode = ${calendarMode},
      sync_enabled = ${syncEnabled},
      calendar_id  = ${calendarId}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return row ? rowToPublic(row) : null;
}

// ── Sync-Worker-Helper (Phase 2) ─────────────────────────────────────────────

/** Liste aller User mit aktivem Sync — der Cron iteriert die. Liefert genug
 *  Felder fuer den Sync-Worker, ohne Tokens (die laedt loadDecryptedTokens). */
export async function listSyncEnabledUsers(): Promise<
  Array<{ userId: string; calendarMode: "default" | "patio"; calendarId: string | null }>
> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const rows = await db`
    SELECT user_id, calendar_mode, calendar_id
      FROM user_microsoft_accounts
     WHERE sync_enabled = true
  `;
  return rows.map((r) => ({
    userId: String(r.user_id),
    calendarMode: r.calendar_mode === "patio" ? "patio" : "default",
    calendarId: r.calendar_id ? String(r.calendar_id) : null,
  }));
}

/** Schreibt last_sync_at + raeumt last_sync_error nach einem erfolgreichen
 *  Sync-Lauf. Im Error-Fall via setSyncError. */
export async function markSyncSuccess(userId: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_accounts SET
      last_sync_at = now(),
      last_sync_error = NULL
    WHERE user_id = ${userId}
  `;
}

/** Schreibt last_sync_error fuer Diagnose im UI ("zuletzt Sync fehlgeschlagen"). */
export async function markSyncError(userId: string, error: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_accounts SET
      last_sync_error = ${error.slice(0, 500)}
    WHERE user_id = ${userId}
  `;
}

/** Persistiert die Calendar-ID nach Lazy-Create im 'patio'-Mode. */
export async function setCalendarId(userId: string, calendarId: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_accounts SET calendar_id = ${calendarId}
    WHERE user_id = ${userId}
  `;
}

// ── Subscription-Helper (Phase 4: Webhooks) ──────────────────────────────────

/** Findet einen User anhand der MS-Subscription-ID. Wird vom Webhook-
 *  Endpoint genutzt: Notification kommt rein → subscriptionId → User. */
export async function findUserBySubscriptionId(subscriptionId: string): Promise<{
  userId: string;
  calendarId: string | null;
  calendarMode: "default" | "patio";
} | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`
    SELECT user_id, calendar_id, calendar_mode
      FROM user_microsoft_accounts
     WHERE subscription_id = ${subscriptionId}
     LIMIT 1
  `;
  if (!row) return null;
  return {
    userId: String(row.user_id),
    calendarId: row.calendar_id ? String(row.calendar_id) : null,
    calendarMode: row.calendar_mode === "patio" ? "patio" : "default",
  };
}

/** Speichert eine neue oder erneuerte Subscription. */
export async function setSubscription(
  userId: string,
  patch: { subscriptionId: string; expiresAt: Date },
): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_accounts SET
      subscription_id         = ${patch.subscriptionId},
      subscription_expires_at = ${patch.expiresAt.toISOString()}
    WHERE user_id = ${userId}
  `;
}

/** Loescht die Subscription-Felder lokal (z.B. nach Disconnect oder
 *  wenn MS sie revoked hat). */
export async function clearSubscription(userId: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_accounts SET
      subscription_id         = NULL,
      subscription_expires_at = NULL
    WHERE user_id = ${userId}
  `;
}

/** Liste aller Subscriptions die in den naechsten N Stunden ablaufen.
 *  Renewal-Cron iteriert die. */
export async function listExpiringSubscriptions(
  withinHours: number,
): Promise<Array<{ userId: string; subscriptionId: string }>> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const cutoff = new Date(Date.now() + withinHours * 60 * 60 * 1000).toISOString();
  const rows = await db`
    SELECT user_id, subscription_id
      FROM user_microsoft_accounts
     WHERE subscription_id IS NOT NULL
       AND subscription_expires_at < ${cutoff}
       AND sync_enabled = true
  `;
  return rows.map((r) => ({
    userId: String(r.user_id),
    subscriptionId: String(r.subscription_id),
  }));
}

// ── Multi-Calendar (Phase 5c) ────────────────────────────────────────────────
//
// Junction-Table user_microsoft_calendars (Migration 024) erlaubt es, dass
// ein User mehrere Outlook-Kalender mit PATIO verbindet. Single-Calendar-
// Felder auf user_microsoft_accounts (calendar_id, calendar_mode,
// subscription_id) bleiben fuer Legacy-Kompatibilitaet bestehen, sind aber
// nicht mehr Source-of-Truth.

export interface UserCalendar {
  userId: string;
  calendarId: string;
  displayName: string | null;
  enabled: boolean;
  direction: "both" | "pull-only" | "push-only";
  subscriptionId: string | null;
  subscriptionExpiresAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  addedAt: string;
}

function rowToCalendar(row: Record<string, unknown>): UserCalendar {
  return {
    userId: String(row.user_id),
    calendarId: String(row.calendar_id),
    displayName: row.display_name ? String(row.display_name) : null,
    enabled: row.enabled === true,
    direction: (row.direction as UserCalendar["direction"]) ?? "both",
    subscriptionId: row.subscription_id ? String(row.subscription_id) : null,
    subscriptionExpiresAt:
      row.subscription_expires_at instanceof Date
        ? row.subscription_expires_at.toISOString()
        : row.subscription_expires_at
          ? String(row.subscription_expires_at)
          : null,
    lastSyncAt:
      row.last_sync_at instanceof Date
        ? row.last_sync_at.toISOString()
        : row.last_sync_at
          ? String(row.last_sync_at)
          : null,
    lastSyncError: row.last_sync_error ? String(row.last_sync_error) : null,
    addedAt: row.added_at instanceof Date ? row.added_at.toISOString() : String(row.added_at),
  };
}

/** Liste aller Kalender eines Users (egal ob enabled oder nicht). */
export async function listUserCalendars(userId: string): Promise<UserCalendar[]> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const rows = await db`
    SELECT * FROM user_microsoft_calendars WHERE user_id = ${userId}
    ORDER BY display_name NULLS LAST, calendar_id
  `;
  return rows.map((r) => rowToCalendar(r));
}

/** Nur die aktiven Kalender — fuer den Sync-Worker. */
export async function listEnabledCalendars(userId: string): Promise<UserCalendar[]> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const rows = await db`
    SELECT * FROM user_microsoft_calendars
     WHERE user_id = ${userId} AND enabled = true
    ORDER BY added_at
  `;
  return rows.map((r) => rowToCalendar(r));
}

/** Insert oder Update eines Kalender-Eintrags. Wird beim Discovery
 *  (refresh from MS) sowie beim Toggle aufgerufen. Existing-Werte fuer
 *  enabled/direction werden NICHT ueberschrieben wenn nicht im Patch. */
export async function upsertUserCalendar(input: {
  userId: string;
  calendarId: string;
  displayName?: string | null;
  enabled?: boolean;
  direction?: "both" | "pull-only" | "push-only";
}): Promise<UserCalendar> {
  if (!DB_ENABLED) throw new Error("DB-Modus erforderlich");
  const db = getDb();

  // Existiert schon? Dann selektives Update — sonst Insert.
  const [existing] = await db`
    SELECT * FROM user_microsoft_calendars
    WHERE user_id = ${input.userId} AND calendar_id = ${input.calendarId}
  `;
  if (existing) {
    const [row] = await db`
      UPDATE user_microsoft_calendars SET
        display_name = ${input.displayName !== undefined ? input.displayName : (existing.display_name as string | null)},
        enabled = ${input.enabled !== undefined ? input.enabled : (existing.enabled as boolean)},
        direction = ${input.direction !== undefined ? input.direction : (existing.direction as string)}
      WHERE user_id = ${input.userId} AND calendar_id = ${input.calendarId}
      RETURNING *
    `;
    return rowToCalendar(row);
  }
  const [row] = await db`
    INSERT INTO user_microsoft_calendars (user_id, calendar_id, display_name, enabled, direction)
    VALUES (
      ${input.userId},
      ${input.calendarId},
      ${input.displayName ?? null},
      ${input.enabled ?? true},
      ${input.direction ?? "both"}
    )
    RETURNING *
  `;
  return rowToCalendar(row);
}

/** Toggle nur das enabled-Flag (Settings-UI Checkbox). */
export async function setCalendarEnabled(
  userId: string,
  calendarId: string,
  enabled: boolean,
): Promise<UserCalendar | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`
    UPDATE user_microsoft_calendars SET enabled = ${enabled}
    WHERE user_id = ${userId} AND calendar_id = ${calendarId}
    RETURNING *
  `;
  return row ? rowToCalendar(row) : null;
}

/** Loescht einen Kalender-Eintrag (nicht den Outlook-Calendar selbst). */
export async function deleteUserCalendar(userId: string, calendarId: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`DELETE FROM user_microsoft_calendars WHERE user_id = ${userId} AND calendar_id = ${calendarId}`;
}

/** Webhook-Receiver: Subscription-ID → User+Calendar. */
export async function findCalendarBySubscriptionId(subscriptionId: string): Promise<{
  userId: string;
  calendarId: string;
} | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`
    SELECT user_id, calendar_id
      FROM user_microsoft_calendars
     WHERE subscription_id = ${subscriptionId}
     LIMIT 1
  `;
  return row ? { userId: String(row.user_id), calendarId: String(row.calendar_id) } : null;
}

/** Subscription-State pro Kalender pflegen. */
export async function setCalendarSubscription(
  userId: string,
  calendarId: string,
  patch: { subscriptionId: string; expiresAt: Date },
): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_calendars SET
      subscription_id         = ${patch.subscriptionId},
      subscription_expires_at = ${patch.expiresAt.toISOString()}
    WHERE user_id = ${userId} AND calendar_id = ${calendarId}
  `;
}

export async function clearCalendarSubscription(userId: string, calendarId: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_calendars SET
      subscription_id         = NULL,
      subscription_expires_at = NULL
    WHERE user_id = ${userId} AND calendar_id = ${calendarId}
  `;
}

/** Renewal-Cron Helper: alle Subs die in <N Stunden ablaufen. */
export async function listExpiringCalendarSubscriptions(
  withinHours: number,
): Promise<Array<{ userId: string; calendarId: string; subscriptionId: string }>> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const cutoff = new Date(Date.now() + withinHours * 60 * 60 * 1000).toISOString();
  const rows = await db`
    SELECT user_id, calendar_id, subscription_id
      FROM user_microsoft_calendars
     WHERE subscription_id IS NOT NULL
       AND subscription_expires_at < ${cutoff}
       AND enabled = true
  `;
  return rows.map((r) => ({
    userId: String(r.user_id),
    calendarId: String(r.calendar_id),
    subscriptionId: String(r.subscription_id),
  }));
}

export async function markCalendarSyncSuccess(userId: string, calendarId: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_calendars SET
      last_sync_at = now(),
      last_sync_error = NULL
    WHERE user_id = ${userId} AND calendar_id = ${calendarId}
  `;
}

export async function markCalendarSyncError(userId: string, calendarId: string, error: string): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  await db`
    UPDATE user_microsoft_calendars SET
      last_sync_error = ${error.slice(0, 500)}
    WHERE user_id = ${userId} AND calendar_id = ${calendarId}
  `;
}
