// ============================================================
// PATIO — Microsoft Graph Calendar-Sync (Phase 2 + 3)
// ============================================================
// Bidirektionaler Sync zwischen PATIO-Termine und Outlook-Calendar.
//
// Read-Sync (pullFromOutlook):
//   1. Calendar bestimmen (Default vs PATIO-Kalender, Lazy-Create).
//   2. /me/[calendars/{id}/]events?$filter=lastModifiedDateTime gt
//      ${last_sync_at - 5min} holen — overlap damit nichts verloren geht
//      bei Cron-Skips. Bei erstem Lauf: -30 Tage bis +90 Tage Window.
//   3. Pro Event: Mapping zu PATIO-Termin → terminRepo.upsertFromMs().
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
  listEnabledCalendars,
  markCalendarSyncSuccess,
  markCalendarSyncError,
  upsertUserCalendar,
  type UserCalendar,
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

interface MsAttendee {
  emailAddress?: { address?: string; name?: string };
  type?: "required" | "optional" | "resource";
  status?: { response?: string; time?: string };
}

interface MsEvent {
  id: string;
  subject?: string;
  start?: MsEventDateTime;
  end?: MsEventDateTime;
  location?: { displayName?: string };
  isAllDay?: boolean;
  lastModifiedDateTime?: string;
  attendees?: MsAttendee[];
  "@odata.etag"?: string;
}

interface MsCalendar {
  id: string;
  name: string;
  isDefaultCalendar?: boolean;
}

// Anzeigename des Kalenders, den PATIO in Outlook anlegt. Frueher "Bau-OS"
// (Produkt-Rename) — bestehende Outlook-Kalender heissen evtl. noch so,
// deshalb matcht CAL_NAME_ALIASES beide, damit ein bereits angelegter
// Kalender nicht uebersehen und versehentlich dupliziert wird.
const PATIO_CAL_NAME = "PATIO";
const CAL_NAME_ALIASES = [PATIO_CAL_NAME, "Bau-OS"];

// ── Helpers: Datum/Zeit-Mapping ──────────────────────────────────────────────
//
// WICHTIG: PATIO speichert datum kanonisch als "TT.MM.JJJJ" (siehe
// normalizeDatum() in workspace/termine.ts). Microsoft Graph akzeptiert
// AUSSCHLIESSLICH ISO-8601 ("YYYY-MM-DDTHH:mm:ss"). Alle Hin-/Rueck-
// konvertierungen laufen ueber diese 2 Helper, damit nirgendwo ein
// Format-Mismatch entsteht.

/** "07.05.2026" → "2026-05-07". Akzeptiert auch schon ISO. */
function patioDatumToIso(datum: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) return datum;
  const m = datum.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new Error(`Unverstaendliches Datumsformat: "${datum}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "2026-05-07" → "07.05.2026" — PATIO-kanonisch. */
function isoToPatioDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Unverstaendliches ISO-Datum: "${iso}"`);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** "2026-05-05T14:00:00.0000000" → "2026-05-05" (ISO) → wird vom Aufrufer
 *  noch zu PATIO-Datum konvertiert. */
function extractDate(dt: string): string {
  return dt.split("T")[0]!;
}

/** "2026-05-05T14:00:00.0000000" → "14:00" — mit Sekunden-Schnitt. */
function extractTime(dt: string): string {
  const t = dt.split("T")[1] ?? "";
  return t.slice(0, 5); // HH:MM
}

/** PATIO Termin → MS-Graph start/end dateTime. Konvertiert TT.MM.JJJJ
 *  intern zu ISO und baut den korrekt formatierten dateTime-String.
 *  Fuer All-Day-Events: isAllDay=true + end-Datum ist Tag+1 (MS-Konvention). */
function patioToMsStart(termin: Termin): { start: MsEventDateTime; end: MsEventDateTime; isAllDay: boolean } {
  const isoDatum = patioDatumToIso(termin.datum);

  // All-Day: kein uhrzeit gesetzt
  if (!termin.uhrzeit) {
    // MS verlangt fuer All-Day: start.dateTime=YYYY-MM-DDT00:00:00, end=tag+1
    const startDate = new Date(`${isoDatum}T00:00:00Z`);
    const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    const endIso = endDate.toISOString().slice(0, 10);
    return {
      start: { dateTime: `${isoDatum}T00:00:00`, timeZone: TIMEZONE },
      end: { dateTime: `${endIso}T00:00:00`, timeZone: TIMEZONE },
      isAllDay: true,
    };
  }
  // Mit Uhrzeit. Endzeit fallback: +30min wenn nicht gesetzt.
  const startDt = `${isoDatum}T${termin.uhrzeit}:00`;
  let endDt: string;
  if (termin.endzeit) {
    endDt = `${isoDatum}T${termin.endzeit}:00`;
  } else {
    // +30 Minuten — naive Zeit-Arithmetik reicht hier
    const [h, m] = termin.uhrzeit.split(":").map(Number);
    const totalMinutes = h! * 60 + m! + 30;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    endDt = `${isoDatum}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`;
  }
  return {
    start: { dateTime: startDt, timeZone: TIMEZONE },
    end: { dateTime: endDt, timeZone: TIMEZONE },
    isAllDay: false,
  };
}

/** Mapping PATIO Termin → MS-Graph-Body fuer POST/PATCH /me/events.
 *  Async weil wir die Email-Adressen der Team-Mitglieder aus der DB
 *  laden muessen (assigneeIds → email). */
async function buildMsEventBody(termin: Termin): Promise<Record<string, unknown>> {
  const { start, end, isAllDay } = patioToMsStart(termin);
  const body: Record<string, unknown> = {
    subject: termin.text,
    start,
    end,
    isAllDay,
  };
  if (termin.location) {
    body.location = { displayName: termin.location };
  }

  // Attendees: assigneeIds (Team-Mitglieder mit Email-Adresse) → MS-Format.
  // Outlook verschickt automatisch ICS-Einladungen an die Adressen, sobald
  // der Event gespeichert wird.
  const attendees: MsAttendee[] = [];
  if (Array.isArray(termin.assigneeIds) && termin.assigneeIds.length > 0) {
    const { findEmailsForMembers } = await import("../data/db-team.js");
    const members = await findEmailsForMembers(termin.assigneeIds);
    for (const m of members) {
      attendees.push({
        emailAddress: { address: m.email, name: m.name },
        type: "required",
      });
    }
  }
  // Externe Teilnehmer (Freitext in assignees, NICHT in assigneeIds gemappt):
  // Wenn der String wie eine Email aussieht, schicken wir ihn als Attendee
  // mit. Sonst lassen wir ihn weg (MS hat fuer Plain-Text-Namen keinen
  // Anker — Outlook braucht eine Email).
  if (Array.isArray(termin.assignees)) {
    const memberNames = new Set((termin.assigneesResolved ?? []).map((r) => r.name.toLowerCase()));
    for (const raw of termin.assignees) {
      const trimmed = raw.trim();
      if (!trimmed || memberNames.has(trimmed.toLowerCase())) continue;
      // Sehr simpler Email-Test — robuster Vergleich macht der MS-Server.
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        attendees.push({
          emailAddress: { address: trimmed, name: trimmed },
          type: "required",
        });
      }
    }
  }
  if (attendees.length > 0) {
    body.attendees = attendees;
  }
  return body;
}

// ── Calendar-Resolution (Multi-Calendar, Phase 5c) ──────────────────────────

/** Pfad fuer Events eines bestimmten Kalenders. */
function calendarEventsPath(calendarId: string): string {
  return `/me/calendars/${calendarId}/events`;
}

/** Discovery: holt alle Kalender des Users von Microsoft + upsert'd sie
 *  in die Junction. Wird beim ersten Settings-Aufruf + manuellem Refresh
 *  benutzt. Existing-Junction-Eintraege bleiben mit ihrem enabled-Flag. */
export async function discoverCalendars(userId: string): Promise<UserCalendar[]> {
  if (!DB_ENABLED) return [];
  const calendars = await graphFetchAll<MsCalendar>(userId, "/me/calendars");
  const result: UserCalendar[] = [];
  for (const c of calendars) {
    const upserted = await upsertUserCalendar({
      userId,
      calendarId: c.id,
      displayName: c.name,
      // enabled NICHT ueberschreiben — Discovery soll die Auswahl des Users
      // nicht aendern. Bei Erstanlage default-true via upsertUserCalendar.
    });
    result.push(upserted);
  }
  // Lazy-Create: wenn der User noch keinen PATIO-Kalender hat, legen
  // wir einen an. Das macht den ersten Push reibungslos: User connectet,
  // klickt "PATIO" als Default, und es funktioniert sofort. Alt-Name
  // "PATIO" zaehlt mit — sonst wuerde fuer Bestands-User dupliziert.
  if (!calendars.some((c) => CAL_NAME_ALIASES.includes(c.name))) {
    const { data } = await graphFetch<MsCalendar>(userId, "/me/calendars", {
      method: "POST",
      body: { name: PATIO_CAL_NAME },
    });
    if (data?.id) {
      const upserted = await upsertUserCalendar({
        userId,
        calendarId: data.id,
        displayName: PATIO_CAL_NAME,
        enabled: true,
      });
      result.push(upserted);
      logInfo(`[MS-Sync] PATIO-Kalender fuer User ${userId} angelegt (${data.id})`);
    }
  }
  return result;
}

/** Default-Push-Ziel: fuer neue PATIO-Termine ohne ms_event_id, in welchen
 *  Outlook-Kalender pushen wir? Bevorzugt einen mit display_name='PATIO'
 *  (oder dem Alt-Namen 'PATIO'), fallback auf den ersten enabled mit
 *  direction in {'both','push-only'}. */
async function pickPushCalendar(userId: string): Promise<UserCalendar | null> {
  const calendars = await listEnabledCalendars(userId);
  const writeable = calendars.filter((c) => c.direction === "both" || c.direction === "push-only");
  if (writeable.length === 0) return null;
  // 1. exakter PATIO-Name (inkl. Alt-Name "PATIO" fuer Bestands-User)
  const patio = writeable.find((c) => c.displayName !== null && CAL_NAME_ALIASES.includes(c.displayName));
  if (patio) return patio;
  // 2. erster enabled writeable
  return writeable[0]!;
}

// ── Pull (Outlook → PATIO) ──────────────────────────────────────────────────

/** Pullt einen einzelnen Kalender. Wird vom Sync-Worker pro aktivem
 *  Junction-Eintrag aufgerufen. */
export async function pullCalendar(
  userId: string,
  calendar: UserCalendar,
): Promise<{ pulled: number; errors: number }> {
  // pull-only und both pullen, push-only nicht.
  if (calendar.direction === "push-only") return { pulled: 0, errors: 0 };

  let pulled = 0;
  let errors = 0;
  try {
    const path = calendarEventsPath(calendar.calendarId);
    const since = calendar.lastSyncAt ? new Date(new Date(calendar.lastSyncAt).getTime() - 5 * 60 * 1000) : null;
    const sinceIso = since ? since.toISOString() : null;
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const filterParts: string[] = [`start/dateTime ge '${windowStart}'`, `start/dateTime le '${windowEnd}'`];
    if (sinceIso) filterParts.push(`lastModifiedDateTime gt ${sinceIso}`);
    const filter = filterParts.join(" and ");
    const select = "id,subject,start,end,location,isAllDay,lastModifiedDateTime,attendees";
    const query = `${path}?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=100`;

    const events = await graphFetchAll<MsEvent>(userId, query);
    if (events.length > 0) {
      logInfo(`[MS-Sync] User ${userId} Cal "${calendar.displayName ?? calendar.calendarId}": ${events.length} Events`);
    }
    for (const ev of events) {
      try {
        await importMsEventToPatio(userId, calendar.calendarId, ev);
        pulled++;
      } catch (err) {
        errors++;
        logError(`[MS-Sync] Import-Fehler fuer Event ${ev.id}`, err);
      }
    }
    await markCalendarSyncSuccess(userId, calendar.calendarId);
    if (pulled > 0) emit({ type: "termin", action: "synced" });
  } catch (err) {
    errors++;
    const msg = err instanceof Error ? err.message : String(err);
    await markCalendarSyncError(userId, calendar.calendarId, msg);
    if (err instanceof GraphError) {
      logError(`[MS-Sync] Pull Cal ${calendar.calendarId} User ${userId}: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Sync] Pull Cal ${calendar.calendarId} User ${userId} fehlgeschlagen`, err);
    }
  }
  return { pulled, errors };
}

/** Convenience: alle aktiven Kalender eines Users pullen. Wenn die
 *  Junction noch leer ist, triggert Discovery. */
export async function pullFromOutlook(userId: string): Promise<{ pulled: number; errors: number }> {
  const account = await getMsAccount(userId);
  if (!account) {
    logInfo(`[MS-Sync] User ${userId} hat kein verbundenes MS-Konto`);
    return { pulled: 0, errors: 0 };
  }
  let calendars = await listEnabledCalendars(userId);
  if (calendars.length === 0) {
    // Erster Sync-Lauf nach Migration 024 — Junction noch leer + kein
    // Backfill (User wurde nach der Migration neu verbunden). Discover.
    await discoverCalendars(userId);
    calendars = await listEnabledCalendars(userId);
    if (calendars.length === 0) return { pulled: 0, errors: 0 };
  }
  let pulled = 0;
  let errors = 0;
  for (const c of calendars) {
    const r = await pullCalendar(userId, c);
    pulled += r.pulled;
    errors += r.errors;
  }
  return { pulled, errors };
}

/** Wandelt einen MS-Event in einen PATIO-Termin und upsert'd ihn. */
async function importMsEventToPatio(userId: string, calendarId: string, ev: MsEvent): Promise<void> {
  if (!terminRepo.upsertFromMs) {
    throw new Error("upsertFromMs nicht verfuegbar — DB-Mode erforderlich");
  }

  if (!ev.start?.dateTime) {
    logInfo(`[MS-Sync] Event ${ev.id} ohne start.dateTime uebersprungen`);
    return;
  }

  // ETag aus @odata.etag — kommt im Format W/"datetime'2026-05-05T...'"
  const etag = ev["@odata.etag"] ?? null;

  // ISO-Datum aus MS extrahieren und auf PATIO-Format (TT.MM.JJJJ) bringen,
  // damit es konsistent mit allen anderen Termin-Quellen ist (Bot, UI, Vault).
  const isoDate = extractDate(ev.start.dateTime);
  const datum = isoToPatioDatum(isoDate);
  const isAllDay = ev.isAllDay === true;
  const uhrzeit = isAllDay ? null : extractTime(ev.start.dateTime);
  const endzeit = isAllDay || !ev.end?.dateTime ? null : extractTime(ev.end.dateTime);
  const location = ev.location?.displayName?.trim() || null;
  const text = ev.subject?.trim() || "(Kein Titel)";

  // Attendees → assigneeIds (gemappte Mitglieder) + assignees (Freitext fuer
  // unbekannte Emails). Der Owner-User wird nicht selbst als Attendee
  // einsortiert — er ist der Organisator.
  const { assigneeIds, assignees } = await mapMsAttendeesToPatio(ev.attendees);

  await terminRepo.upsertFromMs({
    text,
    datum,
    uhrzeit,
    endzeit,
    location,
    assignees,
    assigneeIds,
    msEventId: ev.id,
    msCalendarId: calendarId || null,
    msOwnerUserId: userId,
    msEtag: etag,
  });
}

/** Mapping MS-Attendees → PATIO assigneeIds + assignees-Freitext.
 *  Trennt gemappte Team-Mitglieder (assigneeIds) von externen Email-
 *  Adressen (assignees als Freitext). */
export async function mapMsAttendeesToPatio(
  attendees: MsAttendee[] | undefined,
): Promise<{ assigneeIds: string[]; assignees: string[] }> {
  if (!Array.isArray(attendees) || attendees.length === 0) {
    return { assigneeIds: [], assignees: [] };
  }
  const emails: string[] = [];
  for (const a of attendees) {
    const addr = a.emailAddress?.address?.trim();
    if (addr) emails.push(addr);
  }
  if (emails.length === 0) return { assigneeIds: [], assignees: [] };

  const { findMembersByEmails } = await import("../data/db-team.js");
  const matched = await findMembersByEmails(emails);

  const assigneeIds: string[] = [];
  const assignees: string[] = [];
  const seenIds = new Set<string>();
  for (const a of attendees) {
    const addr = a.emailAddress?.address?.trim() ?? "";
    const name = a.emailAddress?.name?.trim() || addr;
    if (!addr) continue;
    const member = matched.get(addr.toLowerCase());
    if (member && !seenIds.has(member.id)) {
      assigneeIds.push(member.id);
      assignees.push(member.name);
      seenIds.add(member.id);
    } else if (!member) {
      // Externe Email → als Freitext behalten damit der User sie sieht.
      assignees.push(name);
    }
  }
  return { assigneeIds, assignees };
}

// ── Push (PATIO → Outlook) ──────────────────────────────────────────────────

/** Pusht einen PATIO-Termin nach Outlook. Erstellt oder aktualisiert je
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
    const body = await buildMsEventBody(termin);

    if (!termin.msEventId) {
      // CREATE — Default-Push-Kalender aus der Junction waehlen. Wenn es
      // keinen aktiven push-faehigen Kalender gibt, schlaegt der Push fehl
      // mit klarem Hinweis (statt blind in den Default zu pushen).
      const target = await pickPushCalendar(userId);
      if (!target) {
        throw new Error("Kein aktivierter Outlook-Kalender mit Schreibrecht — Settings pruefen");
      }
      const { data, etag } = await graphFetch<MsEvent>(userId, calendarEventsPath(target.calendarId), {
        method: "POST",
        body,
      });
      if (!data?.id) throw new Error("Microsoft hat keine Event-ID zurueckgegeben");
      await terminRepo.markMsSynced(terminId, {
        msEventId: data.id,
        msCalendarId: target.calendarId,
        msEtag: data["@odata.etag"] ?? etag,
      });
      logInfo(
        `[MS-Sync] Termin ${terminId} → MS-Event ${data.id} angelegt in "${target.displayName ?? target.calendarId}"`,
      );
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
 *  aufgerufen — PATIO-Termin ist zu dem Zeitpunkt schon weg, wir kriegen
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
 *  Batch-Operation den Cron nicht blockiert.
 *
 *  Der Cron resetted vor dem Push 'error'-Termine zurueck zu 'pending':
 *  damit haben einmal kaputte Termine eine Chance auf erneuten Versuch
 *  ohne dass der User manuell etwas machen muss (z.B. nach einem Bugfix
 *  im Sync-Code, oder wenn MS Graph mal fluechtig down war). */
export async function pushAllPending(userId: string): Promise<{ pushed: number; errors: number }> {
  if (!terminRepo.listPendingForUser) return { pushed: 0, errors: 0 };

  // Re-Try-Strategie: alle 'error'-Termine des Users wieder auf 'pending'
  // setzen, damit pushToOutlook sie erneut versucht. Das ist OK weil
  // pushToOutlook idempotent ist — wenn ms_event_id schon existiert, wird
  // PATCH gemacht, nicht POST.
  if (DB_ENABLED) {
    const { getDb } = await import("../db/client.js");
    await getDb()`
      UPDATE termine
         SET ms_sync_status = 'pending'
       WHERE ms_owner_user_id = ${userId}
         AND ms_sync_status = 'error'
    `;
  }

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
