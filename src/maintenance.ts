// ============================================================
// PATIO — Maintenance-Cron (Daily Cleanup)
// ============================================================
// Ein einzelner taeglicher Job, der "kleine Aufraeumarbeiten" macht,
// die nicht jedes mal beim Boot getriggert werden sollen:
//
//   - Audit-Log: Eintraege aelter als AUDIT_RETENTION_DAYS loeschen
//   - Rang-4-Verfall: was seit RANG4_VERFALL_TAGE niemand angefasst hat,
//     wandert in den Papierkorb (Aufgabensystem, Migration 050)
//
// Hier stand bis zuletzt ein dritter Punkt: das Aufraeumen abgelaufener
// Telegram-Pair-Tokens. Den Bot gibt es seit AP0 nicht mehr, in die Tabelle
// schreibt keine Zeile Code — der Job putzte jede Nacht einen Bestand, der
// nicht mehr waechst. Migration 055 raeumt die Tabelle selbst ab.
//
// Cron: jeden Tag um 03:15 Uhr (in TIMEZONE). Versetzt zur 03:00-Uhr-
// Backup-Zeit, damit der Dump nicht gerade waehrend einer DELETE-
// Welle gemacht wird (statistical gain, nicht kritisch).
//
// Kein Heartbeat-Mechanismus, kein replyFn — laeuft im Hintergrund,
// loggt nur. Wenn der Cron crashed, ist das nicht user-visible.
// ============================================================

import cron from "node-cron";
import { TIMEZONE, AUDIT_RETENTION_DAYS, RANG4_VERFALL_TAGE } from "./config.js";
import { logInfo, logError } from "./logger.js";

/** Loescht Audit-Eintraege aelter als AUDIT_RETENTION_DAYS.
 *  Liefert die Anzahl der geloeschten Zeilen oder null bei Skip. */
async function cleanupAuditLog(): Promise<number | null> {
  if (AUDIT_RETENTION_DAYS <= 0) return null; // 0 = nie loeschen

  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { deleteOlderThan } = await import("./data/db-audit.js");
  return deleteOlderThan(cutoff);
}

/** Laesst Rang-4-Aufgaben verfallen — in den Papierkorb, nicht ins Nichts.
 *  Begruendung der Frist und des Zeitmassstabs: `RANG4_VERFALL_TAGE` in
 *  src/config.ts. Liefert die Anzahl oder null bei abgeschaltetem Verfall. */
async function rang4Verfall(): Promise<number | null> {
  if (RANG4_VERFALL_TAGE <= 0) return null;
  const { aufgabensystemRepo } = await import("./data/index.js");
  return aufgabensystemRepo.rang4Verfall(RANG4_VERFALL_TAGE);
}

async function runMaintenance(): Promise<void> {
  // Jeder Schritt einzeln abgesichert. Vorher lagen sie in EINEM try: warf
  // der zweite, blieb die Erfolgsmeldung des ersten ungeschrieben, und im
  // Log stand nur der Fehler — der Lauf sah aus, als haette er gar nichts
  // getan. Jetzt scheitert hoechstens der eine Schritt.
  const parts: string[] = [];

  try {
    const auditDeleted = await cleanupAuditLog();
    if (auditDeleted !== null) parts.push(`Audit: ${auditDeleted} Eintraege > ${AUDIT_RETENTION_DAYS}d geloescht`);
  } catch (err) {
    logError("[Maintenance] Audit-Retention", err);
    parts.push("Audit: FEHLER (siehe Log)");
  }

  try {
    const verfallen = await rang4Verfall();
    if (verfallen !== null && verfallen > 0) {
      parts.push(`Rang 4: ${verfallen} Aufgabe(n) nach ${RANG4_VERFALL_TAGE}d in den Papierkorb`);
    }
  } catch (err) {
    logError("[Maintenance] Rang-4-Verfall", err);
    parts.push("Rang-4-Verfall: FEHLER (siehe Log)");
  }

  logInfo(`[Maintenance] ${parts.length ? parts.join("; ") : "nichts zu tun"}`);
}

// ── Tageswechsel (Aufgabensystem, Migration 050) ────────────────────────────
//
// Um Mitternacht wird `im_tagesplan` fuer ALLE zurueckgesetzt. Die Aufgaben
// selbst bleiben unveraendert.
//
// Das ist die wichtigste Regel des ganzen Systems und bewusst so hart: es gibt
// KEINE Rueckstandsliste und KEINE Uebertragung. Nicht Erledigtes faellt in
// sein Projekt zurueck und gilt ausdruecklich nicht als Rueckstand. Eine
// wachsende Liste von „gestern nicht geschafft" ist der schnellste Weg, ein
// Aufgabensystem aufzugeben — nach zwei Wochen sieht man nur noch das eigene
// Versagen und macht es zu.
//
// Eigener Cron, nicht im 03:15-Lauf: der Tag beginnt um 0 Uhr, nicht um
// viertel nach drei. Wer um 2 Uhr nachts arbeitet, soll noch den Plan von
// gestern sehen.
async function tageswechsel(): Promise<void> {
  try {
    const { aufgabensystemRepo } = await import("./data/index.js");
    const anzahl = await aufgabensystemRepo.tagesplanZuruecksetzen();
    logInfo(`[Tageswechsel] Tagesplan geleert: ${anzahl} Aufgabe(n) zurueckgesetzt.`);
  } catch (err) {
    logError("[Tageswechsel]", err);
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
  logInfo(
    `[Maintenance] Cron registriert: 03:15 ${TIMEZONE} (Audit-Retention ${AUDIT_RETENTION_DAYS}d, Rang-4-Verfall ${RANG4_VERFALL_TAGE > 0 ? `${RANG4_VERFALL_TAGE}d` : "aus"})`,
  );

  // Tageswechsel um Mitternacht — siehe Begruendung ueber `tageswechsel()`.
  cron.schedule(
    "0 0 * * *",
    () => {
      void tageswechsel();
    },
    { timezone: TIMEZONE },
  );
  logInfo(`[Tageswechsel] Cron registriert: 00:00 ${TIMEZONE}`);

  // Beim ersten Boot einmal direkt ausfuehren — wenn die Installation
  // 6 Monate offline war, soll nicht erst auf 03:15 gewartet werden.
  // 60 Sekunden Delay damit die DB-Connection-Pool warm ist.
  setTimeout(() => {
    void runMaintenance();
  }, 60_000);
}
