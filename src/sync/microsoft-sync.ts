// ============================================================
// Bau-OS — Microsoft Graph Calendar-Sync (Phase 2 + 3)
// ============================================================
// Bidirektionaler Sync zwischen Bau-OS-Termine und Outlook-Calendar.
//
// Read-Sync (pullFromOutlook):
//   1. Calendar bestimmen (Default vs Bau-OS-Kalender, Lazy-Create).
//   2. /me/[calendars/{id}/]events?$filter=lastModifiedDateTime gt
//      ${last_sync_at - 5min} holen — overlap damit nichts verloren geht
//      bei Cron-Skips. Bei erstem Lauf: -30 Tage bis +90 Tage Window.
//   3. Pro Event: Mapping zu Bau-OS-Termin → terminRepo.upsertFromMs().
//      ms_event_id ist UNIQUE → Update statt Duplicate.
//   4. last_sync_at = now() schreiben.
//
// Write-Sync (pushToOutlook):
//   1. Termin laden, ms_owner_user_id muss = aufrufender User sein.
//   2. Wenn ms_event_id NULL → POST /me/events (CREATE)
//      Sonst                  → PATCH /me/events/{id} (UPDATE) mit If-Match
//   3. Antwort: ms_event_id, ms_calendar_id, ms_etag, ms_sync_status='synced',
//      ms_last_sync_at=now() persistieren.
//
// Konflikt-Handling (Phase 3 light):
//   - Wenn PATCH 412 Precondition Failed → ms_sync_status='conflict'.
//     Phase 4 wird das im UI als Warnung darstellen — fuer jetzt: Log +
//     Status-Bit, kein Datenverlust.
//
// Triggers:
//   - Cron alle 5 Minuten: pullForAllUsers() + pushPendingForAllUsers()
//   - Bei Termin-Save/Update/Delete in routes/termine.ts: async pushToOutlook()
//     fire-and-forget. Falls fehlgeschlagen → ms_sync_status='pending', der
//     5-min-Cron versucht's beim naechsten Lauf nochmal.
// ============================================================

import { graphFetch, graphFetchAll, GraphError } from "../api/graph.js";
import {
  getMsAccount,
  listSyncEnabledUsers,
  markSyncSuccess,
  markSyncError,
  setCalendarId,
  type MsAccountPublic,
} from "../data/db-microsoft.js";
import { terminRepo } from "../data/index.js";
import { TIMEZONE, DB_ENABLED } from "../config.js";
import { logInfo, logError } from "../logger.js";
import { emit } from "../api/events.js";
import type { Termin } from "../data/types.js";

// ── Microsoft-Graph-Event-Shape ───────────────────────────────────────────────
// Nur die Felder die wir tatsaechlich auswerten — der Rest wird ignoriert.

interface MsEventDateTime {
  dateTime: string; // "2026-05-05T14:00:00.0000000"
  timeZone: string; // "Europe/Vienna" oder "UTC"
}

interface MsEvent {
  id: string;
  subject?: string;
  start?: MsEventDateTime;
  end?: MsEventDateTime;
  location?: { displayName?: string };
  isAllDay?: boolean;
  lastModifiedDateTime?: string;
  "@odata.etag"?: string;
}

interface MsCalendar {
  id: string;
  name: string;
  isDefaultCalendar?: boolean;
}

const BAU_OS_CAL_NAME = "Bau-OS";

// ── Helpers: Datum/Zeit-Mapping ──────────────────────────────────────────────

/** "2026-05-05T14:00:00.0000000" → "2026-05-05" */
function extractDate(dt: string): string {
  return dt.split("T")[0]!;
}

/** "2026-05-05T14:00:00.0000000" → "14:00" — mit Sekunden-Schnitt. */
function extractTime(dt: string): string {
  const t = dt.split("T")[1] ?? "";
  return t.slice(0, 5); // HH:MM
}

/** Bau-OS HH:MM zu MS-Graph dateTime: "YYYY-MM-DDTHH:MM:00".
 *  Fuer All-Day-Events gibt Microsoft 00:00 + isAllDay=true vor. */
function bauosToMsStart(termin: Termin): { start: MsEventDateTime; end: MsEventDateTime; isAllDay: boolean } {
  const datum = termin.datum;
  // All-Day: kein uhrzeit gesetzt
  if (!termin.uhrzeit) {
    // MS verlangt fuer All-Day: start.dateTime=YYYY-MM-DDT00:00:00, end=tag+1
    const startDate = new Date(`${datum}T00:00:00Z`);
    const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    const endIso = endDate.toISOString().slice(0, 10);
    return {
      start: { dateTime: `${datum}T00:00:00`, timeZone: TIMEZONE },
      end: { dateTime: `${endIso}T00:00:00`, timeZone: TIMEZONE },
      isAllDay: true,
    };
  }
  // Mit Uhrzeit. Endzeit fallback: +30min wenn nicht gesetzt.
  const startDt = `${datum}T${termin.uhrzeit}:00`;
  let endDt: string;
  if (termin.endzeit) {
    endDt = `${datum}T${termin.endzeit}:00`;
  } else {
    // +30 Minuten — naive Zeit-Arithmetik reicht hier
    const [h, m] = termin.uhrzeit.split(":").map(Number);
    const totalMinutes = h! * 60 + m! + 30;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    endDt = `${datum}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`;
  }
  return {
    start: { dateTime: startDt, timeZone: TIMEZONE },
    end: { dateTime: endDt, timeZone: TIMEZONE },
    isAllDay: false,
  };
}

/** Mapping Bau-OS Termin → MS-Graph-Body fuer POST/PATCH /me/events. */
function buildMsEventBody(termin: Termin): Record<string, unknown> {
  const { start, end, isAllDay } = bauosToMsStart(termin);
  const body: Record<string, unknown> = {
    subject: termin.text,
    start,
    end,
    isAllDay,
  };
  if (termin.location) {
    body.location = { displayName: termin.location };
  }
  return body;
}

// ── Calendar-Resolution ──────────────────────────────────────────────────────

/** Liefert die Calendar-URL fuer den User. Bei 'default' = "/me/events"
 *  (kein calendar-Pfad), bei 'bau-os' wird die ID lazy-resolved/created. */
async function resolveCalendarPath(account: MsAccountPublic): Promise<string> {
  if (account.calendarMode === "default") return "/me/events";

  // Bau-OS-Mode: wir brauchen eine calendar_id. Schon gesetzt? Dann nutzen.
  if (account.calendarId) {
    return `/me/calendars/${account.calendarId}/events`;
  }

  // Suche existierenden "Bau-OS"-Kalender, sonst lege ihn an.
  const calendars = await graphFetchAll<MsCalendar>(account.userId, "/me/calendars");
  let calId = calendars.find((c) => c.name === BAU_OS_CAL_NAME)?.id;
  if (!calId) {
    const { data } = await graphFetch<MsCalendar>(account.userId, "/me/calendars", {
      method: "POST",
      body: { name: BAU_OS_CAL_NAME },
    });
    if (!data?.id) throw new Error("Bau-OS-Kalender konnte nicht erstellt werden");
    calId = data.id;
    logInfo(`[MS-Sync] Bau-OS-Kalender fuer User ${account.userId} angelegt (${calId})`);
  }
  await setCalendarId(account.userId, calId);
  return `/me/calendars/${calId}/events`;
}

/** Fuer GETs ueber den Default-Calendar oder den Bau-OS-Kalender. Liefert
 *  die ID die wir auch in termine.ms_calendar_id schreiben. */
async function resolveCalendarIdForList(account: MsAccountPublic): Promise<{ path: string; calendarId: string }> {
  if (account.calendarMode === "default") {
    // Fuer den Default-Kalender holen wir einmal die ID, damit wir sie in
    // ms_calendar_id mit speichern (Phase 4 braucht das fuer Webhooks).
    const { data } = await graphFetch<{ id: string }>(account.userId, "/me/calendar");
    return { path: "/me/events", calendarId: data?.id ?? "" };
  }
  const path = await resolveCalendarPath(account);
  // Format: /me/calendars/{id}/events → calendarId = mittleres Segment
  const match = path.match(/\/me\/calendars\/([^/]+)\/events/);
  return { path, calendarId: match?.[1] ?? account.calendarId ?? "" };
}

// ── Pull (Outlook → Bau-OS) ──────────────────────────────────────────────────

/** Holt geaenderte Outlook-Events fuer einen User und upsert'd sie in Bau-OS.
 *  Verwendet $filter=lastModifiedDateTime gt {iso} um inkrementell zu sein. */
export async function pullFromOutlook(userId: string): Promise<{ pulled: number; errors: number }> {
  const account = await getMsAccount(userId);
  if (!account) {
    logInfo(`[MS-Sync] User ${userId} hat kein verbundenes MS-Konto`);
    return { pulled: 0, errors: 0 };
  }

  let pulled = 0;
  let errors = 0;

  try {
    const { path, calendarId } = await resolveCalendarIdForList(account);

    // Inkrementell: nur Events die seit letztem Sync (minus 5min Overlap)
    // geaendert wurden. Beim ersten Lauf: -30 Tage bis +90 Tage als Window.
    const since = account.lastSyncAt ? new Date(new Date(account.lastSyncAt).getTime() - 5 * 60 * 1000) : null;

    // ISO-Zeit fuer den Filter — Microsoft will UTC mit "Z".
    const sinceIso = since ? since.toISOString() : null;

    // Window-Filter: 30 Tage zurueck bis 90 Tage vorwaerts. Zur Reduktion
    // der Datenmenge — wer 5 Jahre alte Outlook-Termine hat, will die
    // wahrscheinlich nicht alle in Bau-OS sehen.
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    const filterParts: string[] = [`start/dateTime ge '${windowStart}'`, `start/dateTime le '${windowEnd}'`];
    if (sinceIso) {
      filterParts.push(`lastModifiedDateTime gt ${sinceIso}`);
    }
    const filter = filterParts.join(" and ");
    const select = "id,subject,start,end,location,isAllDay,lastModifiedDateTime";
    const query = `${path}?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=100`;

    const events = await graphFetchAll<MsEvent>(userId, query);
    logInfo(`[MS-Sync] User ${userId}: ${events.length} Outlook-Events seit letztem Sync`);

    for (const ev of events) {
      try {
        await importMsEventToBauOs(userId, calendarId, ev);
        pulled++;
      } catch (err) {
        errors++;
        logError(`[MS-Sync] Import-Fehler fuer Event ${ev.id}`, err);
      }
    }

    await markSyncSuccess(userId);
    if (pulled > 0) emit({ type: "termin", action: "synced" });
  } catch (err) {
    errors++;
    const msg = err instanceof Error ? err.message : String(err);
    await markSyncError(userId, msg);
    if (err instanceof GraphError) {
      logError(`[MS-Sync] Pull fuer User ${userId} fehlgeschlagen: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Sync] Pull fuer User ${userId} fehlgeschlagen`, err);
    }
  }

  return { pulled, errors };
}

/** Wandelt einen MS-Event in einen Bau-OS-Termin und upsert'd ihn. */
async function importMsEventToBauOs(userId: string, calendarId: string, ev: MsEvent): Promise<void> {
  if (!terminRepo.upsertFromMs) {
    throw new Error("upsertFromMs nicht verfuegbar — DB-Mode erforderlich");
  }

  if (!ev.start?.dateTime) {
    logInfo(`[MS-Sync] Event ${ev.id} ohne start.dateTime uebersprungen`);
    return;
  }

  // ETag aus @odata.etag — kommt im Format W/"datetime'2026-05-05T...'"
  const etag = ev["@odata.etag"] ?? null;

  const datum = extractDate(ev.start.dateTime);
  const isAllDay = ev.isAllDay === true;
  const uhrzeit = isAllDay ? null : extractTime(ev.start.dateTime);
  const endzeit = isAllDay || !ev.end?.dateTime ? null : extractTime(ev.end.dateTime);
  const location = ev.location?.displayName?.trim() || null;
  const text = ev.subject?.trim() || "(Kein Titel)";

  await terminRepo.upsertFromMs({
    text,
    datum,
    uhrzeit,
    endzeit,
    location,
    msEventId: ev.id,
    msCalendarId: calendarId || null,
    msOwnerUserId: userId,
    msEtag: etag,
  });
}

// ── Push (Bau-OS → Outlook) ──────────────────────────────────────────────────

/** Pusht einen Bau-OS-Termin nach Outlook. Erstellt oder aktualisiert je
 *  nach ob ms_event_id schon gesetzt ist. */
export async function pushToOutlook(userId: string, terminId: string): Promise<void> {
  if (!DB_ENABLED) return;
  if (!terminRepo.markMsSynced || !terminRepo.markMsSyncError) {
    throw new Error("Sync-Methoden nicht verfuegbar — DB-Mode erforderlich");
  }

  const account = await getMsAccount(userId);
  if (!account) {
    logInfo(`[MS-Sync] Push uebersprungen — User ${userId} hat kein MS-Konto`);
    return;
  }
  if (!account.syncEnabled) return;

  const termin = await terminRepo.get(terminId);
  if (!termin) return;

  // Termine die ausschliesslich aus MS kamen + lokal NICHT geaendert wurden,
  // wuerden hier zum Re-Push fuehren — ms_sync_status muss explizit 'pending'
  // sein damit wir pushen.
  if (termin.msSyncStatus !== "pending") return;

  try {
    const body = buildMsEventBody(termin);
    const { path: calPath, calendarId } = await resolveCalendarIdForList(account);

    if (!termin.msEventId) {
      // CREATE
      const { data, etag } = await graphFetch<MsEvent>(userId, calPath, {
        method: "POST",
        body,
      });
      if (!data?.id) throw new Error("Microsoft hat keine Event-ID zurueckgegeben");
      await terminRepo.markMsSynced(terminId, {
        msEventId: data.id,
        msCalendarId: calendarId || null,
        msEtag: data["@odata.etag"] ?? etag,
      });
      logInfo(`[MS-Sync] Termin ${terminId} → MS-Event ${data.id} angelegt`);
    } else {
      // UPDATE — mit If-Match wenn ETag vorhanden, sonst ohne (best-effort).
      const opts: Parameters<typeof graphFetch>[2] = { method: "PATCH", body };
      if (termin.msEtag) opts.ifMatch = termin.msEtag;
      try {
        const { data, etag } = await graphFetch<MsEvent>(userId, `/me/events/${termin.msEventId}`, opts);
        await terminRepo.markMsSynced(terminId, {
          msEventId: termin.msEventId,
          msCalendarId: termin.msCalendarId ?? null,
          msEtag: data?.["@odata.etag"] ?? etag,
        });
        logInfo(`[MS-Sync] Termin ${terminId} (MS ${termin.msEventId}) aktualisiert`);
      } catch (err) {
        if (err instanceof GraphError && err.status === 412) {
          // Precondition Failed — Outlook hat den Event auch geaendert.
          // Status auf 'conflict' setzen, Phase 4 zeigt das im UI.
          logError(
            `[MS-Sync] Conflict bei Termin ${terminId} (MS-Event wurde extern geaendert)`,
            new Error("etag-mismatch"),
          );
          // Direkt im DB-Status markieren ohne markMsSyncError, damit
          // 'conflict' nicht ueberschrieben wird.
          const { getDb } = await import("../db/client.js");
          await getDb()`UPDATE termine SET ms_sync_status = 'conflict' WHERE id = ${terminId}`;
          return;
        }
        if (err instanceof GraphError && err.status === 404) {
          // MS-Event wurde dort geloescht — wir loesen den Link, der naechste
          // Save legt einen neuen Event an.
          logInfo(`[MS-Sync] MS-Event ${termin.msEventId} existiert nicht mehr — Link zuruecksetzen`);
          if (terminRepo.clearMsLink) await terminRepo.clearMsLink(terminId);
          return;
        }
        throw err;
      }
    }
  } catch (err) {
    if (terminRepo.markMsSyncError) await terminRepo.markMsSyncError(terminId);
    if (err instanceof GraphError) {
      logError(`[MS-Sync] Push Termin ${terminId}: ${err.code} (HTTP ${err.status}) — ${err.message}`, err);
    } else {
      logError(`[MS-Sync] Push Termin ${terminId} fehlgeschlagen`, err);
    }
  }
}

/** Loescht den Outlook-Spiegel eines Termins. Wird vom Termin-Delete-Hook
 *  aufgerufen — Bau-OS-Termin ist zu dem Zeitpunkt schon weg, wir kriegen
 *  msEventId/msCalendarId vom Caller. */
export async function deleteFromOutlook(
  userId: string,
  msEventId: string | null,
  msCalendarId: string | null,
): Promise<void> {
  if (!msEventId) return;
  void msCalendarId;

  const account = await getMsAccount(userId);
  if (!account || !account.syncEnabled) return;

  try {
    await graphFetch(userId, `/me/events/${msEventId}`, { method: "DELETE" });
    logInfo(`[MS-Sync] MS-Event ${msEventId} aus Outlook geloescht`);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      // Schon weg — kein Fehler.
      return;
    }
    logError(`[MS-Sync] Delete von MS-Event ${msEventId} fehlgeschlagen`, err);
  }
}

/** Drained alle pending Termine eines Users — wird vom Cron + nach
 *  jedem Save aufgerufen. Limitiert auf 100 pro Lauf, damit ein
 *  Batch-Operation den Cron nicht blockiert. */
export async function pushAllPending(userId: string): Promise<{ pushed: number; errors: number }> {
  if (!terminRepo.listPendingForUser) return { pushed: 0, errors: 0 };
  const pending = await terminRepo.listPendingForUser(userId);
  let pushed = 0;
  let errors = 0;
  for (const t of pending.slice(0, 100)) {
    try {
      await pushToOutlook(userId, t.id);
      pushed++;
    } catch (err) {
      errors++;
      logError(`[MS-Sync] pushAllPending: Termin ${t.id} fehlgeschlagen`, err);
    }
  }
  return { pushed, errors };
}

// ── Cron-Entry-Points ────────────────────────────────────────────────────────

/** Iteriert ueber alle User mit aktivem Sync und pullt + pusht. Wird
 *  vom 5-min-Cron in maintenance.ts aufgerufen. */
export async function runSyncForAllUsers(): Promise<void> {
  if (!DB_ENABLED) return;
  const users = await listSyncEnabledUsers();
  if (users.length === 0) return;

  logInfo(`[MS-Sync] Cron-Lauf fuer ${users.length} User`);
  for (const u of users) {
    try {
      // Push first damit lokale Aenderungen Vorrang haben — wer einen Termin
      // erstellt + sofort den Cron triggert, sieht den Push noch BEVOR der
      // Pull moegliche neue Outlook-Events bringt.
      await pushAllPending(u.userId);
      await pullFromOutlook(u.userId);
    } catch (err) {
      logError(`[MS-Sync] Cron fuer User ${u.userId} fehlgeschlagen`, err);
    }
  }
}
