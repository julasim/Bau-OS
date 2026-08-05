// ============================================================
// PATIO — Maintenance-Cron (Daily Cleanup)
// ============================================================
// Ein einzelner taeglicher Job, der "kleine Aufraeumarbeiten" macht,
// die nicht jedes mal beim Boot getriggert werden sollen:
//
//   - Audit-Log: Eintraege aelter als AUDIT_RETENTION_DAYS loeschen
//   - Telegram-Pair-Tokens: abgelaufene weg (zur Sicherheit, normal
//     putzt redeemPairToken die schon mit, aber wenn nie eingeloest
//     bleiben sie im Worst-Case bis ein neuer Token erstellt wird)
//
// Cron: jeden Tag um 03:15 Uhr (in TIMEZONE). Versetzt zur 03:00-Uhr-
// Backup-Zeit, damit der Dump nicht gerade waehrend einer DELETE-
// Welle gemacht wird (statistical gain, nicht kritisch).
//
// Kein Heartbeat-Mechanismus, kein replyFn — laeuft im Hintergrund,
// loggt nur. Wenn der Cron crashed, ist das nicht user-visible.
// ============================================================

import cron from "node-cron";
import { TIMEZONE, AUDIT_RETENTION_DAYS, DB_ENABLED } from "./config.js";
import { logInfo, logError } from "./logger.js";

/** Loescht Audit-Eintraege aelter als AUDIT_RETENTION_DAYS.
 *  Liefert die Anzahl der geloeschten Zeilen oder null bei Skip. */
async function cleanupAuditLog(): Promise<number | null> {
  if (!DB_ENABLED) return null;
  if (AUDIT_RETENTION_DAYS <= 0) return null; // 0 = nie loeschen

  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { deleteOlderThan } = await import("./data/db-audit.js");
  return deleteOlderThan(cutoff);
}

/** Loescht abgelaufene Telegram-Pair-Tokens. Idempotent — wenn keine
 *  da sind, ist das ein No-op. */
async function cleanupPairTokens(): Promise<number> {
  if (!DB_ENABLED) return 0;
  const { getDb } = await import("./db/client.js");
  const db = getDb();
  const result = await db`DELETE FROM telegram_pair_tokens WHERE expires_at < now()`;
  return result.count;
}

async function runMaintenance(): Promise<void> {
  try {
    const auditDeleted = await cleanupAuditLog();
    const pairDeleted = await cleanupPairTokens();
    const parts: string[] = [];
    if (auditDeleted !== null) parts.push(`Audit: ${auditDeleted} Eintraege > ${AUDIT_RETENTION_DAYS}d geloescht`);
    if (pairDeleted > 0) parts.push(`Pair-Tokens: ${pairDeleted} abgelaufene weg`);
    if (parts.length === 0) parts.push("nichts zu tun");
    logInfo(`[Maintenance] ${parts.join("; ")}`);
  } catch (err) {
    logError("[Maintenance]", err);
  }
}

/** Startet den Maintenance-Cron. Idempotent — mehrfache Calls registrieren
 *  trotzdem nur einen Job (boot-Time-only). */
let _registered = false;
export function startMaintenanceCron(): void {
  if (_registered) return;
  _registered = true;

  // 03:15 in TIMEZONE — versetzt zum 03:00-Backup, damit DELETE und
  // Backup-Dump nicht ueberlappen.
  cron.schedule(
    "15 3 * * *",
    () => {
      void runMaintenance();
    },
    { timezone: TIMEZONE },
  );
  logInfo(`[Maintenance] Cron registriert: 03:15 ${TIMEZONE} (Audit-Retention ${AUDIT_RETENTION_DAYS}d)`);

  // Beim ersten Boot einmal direkt ausfuehren — wenn die Installation
  // 6 Monate offline war, soll nicht erst auf 03:15 gewartet werden.
  // 60 Sekunden Delay damit die DB-Connection-Pool warm ist.
  setTimeout(() => {
    void runMaintenance();
  }, 60_000);
}
