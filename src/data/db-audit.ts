// ============================================================
// PATIO — Audit-Log Repository (Migration 018)
// ============================================================
// Append-only API: logEvent() schreibt einen Eintrag. listEvents()
// fuer Admin-UI mit Filter (User, Event-Typ, Zeitraum). Es gibt
// bewusst kein update() — Audit-Log ist immutable.
//
// logEvent() schluckt Fehler still (logError, kein throw). Ein
// kaputter Audit-Insert darf NIE den eigentlichen Request brechen.
// Im Zweifel verlieren wir lieber einen Audit-Eintrag, als dass wir
// ein Login crashen weil pg gerade hickup hat.
// ============================================================

import { getDb } from "../db/client.js";
import { logError } from "../logger.js";

export type AuditEvent =
  | "login.success"
  | "login.fail"
  | "login.2fa.success"
  | "login.2fa.fail"
  | "login.email.sent"
  | "login.email.fail"
  | "login.email_setup_required"
  | "login.magic_link.sent"
  | "login.magic_link.success"
  | "login.magic_link.fail"
  | "ms.connect"
  | "ms.disconnect"
  | "ms.callback.fail"
  | "email_setup.code_sent"
  | "email_setup.code_fail"
  | "email_setup.success"
  | "2fa.enable"
  | "2fa.disable"
  | "2fa.setup.start"
  | "password.change"
  | "password.admin_reset"
  | "user.create"
  | "user.delete"
  | "user.role"
  | "user.update"
  | "bot.token.set"
  | "bot.token.clear"
  | "pair.create"
  | "pair.success"
  | "pair.fail";

export interface AuditEntry {
  id: string;
  ts: string;
  actorUserId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  event: AuditEvent | string;
  targetUserId: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  ok: boolean;
}

export interface AuditWriteInput {
  actorUserId?: string | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  event: AuditEvent | string;
  targetUserId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown>;
  ok?: boolean;
}

function rowToEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: String(row.id),
    ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    actorUsername: row.actor_username ? String(row.actor_username) : null,
    actorRole: row.actor_role ? String(row.actor_role) : null,
    ip: row.ip ? String(row.ip) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
    event: String(row.event),
    targetUserId: row.target_user_id ? String(row.target_user_id) : null,
    targetLabel: row.target_label ? String(row.target_label) : null,
    details: row.details && typeof row.details === "object" ? (row.details as Record<string, unknown>) : {},
    ok: row.ok !== false,
  };
}

/** Schreibt einen Audit-Eintrag. Fehlertolerant — Probleme nur loggen,
 *  niemals werfen. Im DB-deaktivierten Modus (FS-only) ein No-op. */
export async function logEvent(input: AuditWriteInput): Promise<void> {
  try {
    const db = getDb();
    await db`
      INSERT INTO audit_log (
        actor_user_id, actor_username, actor_role,
        ip, user_agent,
        event, target_user_id, target_label, details, ok
      ) VALUES (
        ${input.actorUserId ?? null},
        ${input.actorUsername ?? null},
        ${input.actorRole ?? null},
        ${input.ip ?? null},
        ${input.userAgent ?? null},
        ${input.event},
        ${input.targetUserId ?? null},
        ${input.targetLabel ?? null},
        ${JSON.stringify(input.details ?? {})}::jsonb,
        ${input.ok ?? true}
      )
    `;
  } catch (err) {
    logError("[Audit] Insert fehlgeschlagen", err);
  }
}

export interface AuditListOptions {
  limit?: number;
  offset?: number;
  actorUserId?: string;
  targetUserId?: string;
  event?: string;
  /** Substring-Match auf event (z.B. "2fa." liefert alle 2FA-Events) */
  eventPrefix?: string;
  since?: string; // ISO timestamp
  until?: string;
  ip?: string;
}

/** Liefert die letzten Audit-Eintraege, sortiert absteigend nach Zeit.
 *  Filter sind alle optional und kombinierbar. */
export async function listEvents(opts: AuditListOptions = {}): Promise<AuditEntry[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const db = getDb();

  // postgres.js Tagged-Templates lassen sich nicht trivial mit dynamischen
  // WHERE-Klauseln kombinieren. Wir bauen die Query mit `db` als Funktion +
  // mehreren Conditional-Joins, das bleibt SQL-injection-sicher weil
  // postgres.js jede Variable parametrisiert.
  const rows = await db`
    SELECT * FROM audit_log
     WHERE 1=1
       ${opts.actorUserId ? db`AND actor_user_id = ${opts.actorUserId}` : db``}
       ${opts.targetUserId ? db`AND target_user_id = ${opts.targetUserId}` : db``}
       ${opts.event ? db`AND event = ${opts.event}` : db``}
       ${opts.eventPrefix ? db`AND event LIKE ${opts.eventPrefix + "%"}` : db``}
       ${opts.since ? db`AND ts >= ${opts.since}` : db``}
       ${opts.until ? db`AND ts <= ${opts.until}` : db``}
       ${opts.ip ? db`AND ip = ${opts.ip}` : db``}
     ORDER BY ts DESC
     LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map(rowToEntry);
}

/** Loescht Audit-Eintraege aelter als der angegebene ISO-Timestamp.
 *  Fuer Retention-Cron. Liefert die Anzahl der geloeschten Zeilen. */
export async function deleteOlderThan(iso: string): Promise<number> {
  const db = getDb();
  const result = await db`DELETE FROM audit_log WHERE ts < ${iso}`;
  return result.count;
}
