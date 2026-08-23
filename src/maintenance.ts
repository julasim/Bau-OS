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
import { TIMEZONE, AUDIT_RETENTION_DAYS, RANG4_VERFALL_TAGE, MELDUNGEN_AUFBEWAHREN_TAGE } from "./config.js";
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

/** Raeumt gelesene Meldungen weg. Ungelesene bleiben — siehe
 *  `MELDUNGEN_AUFBEWAHREN_TAGE` in src/config.ts. */
async function meldungenAufraeumen(): Promise<number | null> {
  if (MELDUNGEN_AUFBEWAHREN_TAGE <= 0) return null;
  const { benachrichtigungenRepo } = await import("./data/index.js");
  return benachrichtigungenRepo.aufraeumen(MELDUNGEN_AUFBEWAHREN_TAGE);
}

/**
 * Meldet faellige Aufgaben — einmal taeglich, an die zugewiesene Person.
 *
 * ── Warum genau einmal, und warum am Faelligkeitstag ──────────────────────
 *
 * Eine Erinnerung, die jeden Tag wiederkommt, wird nach drei Tagen
 * weggeklickt, ohne gelesen zu werden. Deshalb genau an dem Tag, an dem die
 * Aufgabe faellig ist — und nur, wenn es fuer diese Aufgabe an diesem Tag noch
 * keine Meldung gibt (der Lauf koennte zweimal starten, etwa nach einem
 * Neustart des Containers).
 */
async function faelligeAufgabenMelden(): Promise<number> {
  const { getDb } = await import("./db/client.js");
  const { benachrichtigungenRepo } = await import("./data/index.js");
  const db = getDb();

  // Die Bruecke team_members.user_id (Migration 013) steht IM SQL: eine
  // Aufgabe zeigt auf ein Team-Mitglied, eine Meldung auf ein Konto.
  const faellig = await db`
    SELECT t.id, t.text, t.project_id, tm.user_id
      FROM tasks t
      JOIN team_members tm ON tm.id = t.assignee_id
     WHERE t.status <> 'done'
       AND t.deleted_at IS NULL
       AND t.date = to_char(now() AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD')
       AND tm.user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM benachrichtigungen b
          WHERE b.ziel_id = t.id AND b.anlass = 'aufgabe-faellig'
            AND b.erstellt_am > now() - interval '20 hours'
       )`;

  if (faellig.length === 0) return 0;
  return benachrichtigungenRepo.anlegen(
    faellig.map((r) => ({
      empfaengerId: String(r.user_id),
      anlass: "aufgabe-faellig" as const,
      titel: `Heute fällig: ${String(r.text).slice(0, 60)}`,
      // Kein Ausloeser: das war niemand, das war der Kalender.
      ausloeser: null,
      zielTyp: "task",
      zielId: String(r.id),
      projectId: r.project_id ? String(r.project_id) : null,
    })),
  );
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
    const gemeldet = await faelligeAufgabenMelden();
    if (gemeldet > 0) parts.push(`Faellig heute: ${gemeldet} Meldung(en)`);
  } catch (err) {
    logError("[Maintenance] Faellige Aufgaben", err);
    parts.push("Faelligkeits-Meldungen: FEHLER (siehe Log)");
  }

  try {
    const weg = await meldungenAufraeumen();
    if (weg !== null && weg > 0) parts.push(`Meldungen: ${weg} gelesene > ${MELDUNGEN_AUFBEWAHREN_TAGE}d weg`);
  } catch (err) {
    logError("[Maintenance] Meldungen aufraeumen", err);
    parts.push("Meldungen aufraeumen: FEHLER (siehe Log)");
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
