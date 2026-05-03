// ============================================================
// Bau-OS — Microsoft-Account Repository (Migration 022)
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
  calendarMode: "default" | "bau-os";
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  /** True wenn das access_token in der DB noch nicht abgelaufen ist
   *  (mit 60s Sicherheitsmarge). Caller benutzt das fuer "muss refreshed
   *  werden?"-Entscheidungen. */
  accessTokenValid: boolean;
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
    calendarMode: (row.calendar_mode === "bau-os" ? "bau-os" : "default") as MsAccountPublic["calendarMode"],
    syncEnabled: row.sync_enabled === true,
    lastSyncAt:
      row.last_sync_at instanceof Date
        ? row.last_sync_at.toISOString()
        : row.last_sync_at
          ? String(row.last_sync_at)
          : null,
    lastSyncError: row.last_sync_error ? String(row.last_sync_error) : null,
    accessTokenValid: expiresAt.getTime() > Date.now() + 60_000,
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
 *  alles. Termine mit ms_event_id bleiben in Bau-OS — sie sind dann
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
  patch: { calendarMode?: "default" | "bau-os"; syncEnabled?: boolean; calendarId?: string | null },
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
