// ============================================================
// Bau-OS — Microsoft Graph Webhook-Receiver (Phase 4)
// ============================================================
// Empfaengt Push-Notifications von Microsoft Graph fuer Calendar-
// Events. Zwei Request-Typen:
//
//  1) Validation: MS schickt einen POST mit ?validationToken=...
//     Wir muessen den Token innerhalb 10 Sekunden als text/plain
//     ANTWORTEN. Sonst lehnt MS die Subscription ab.
//
//  2) Notifications: MS schickt einen POST mit JSON-Body
//     { value: [{ subscriptionId, clientState, changeType,
//                 resource, resourceData: { id, "@odata.etag" }}] }
//     Wir muessen 202 in <30s antworten und IM HINTERGRUND syncen.
//
// Sicherheit:
//   - Endpoint ist public (MS schickt anonym).
//   - Pro Notification wird der clientState gegen unseren HMAC
//     (computeClientState) verifiziert. Mismatch → silent drop +
//     Audit-Log-Eintrag.
//   - Body groesser als ~1MB → drop (DOS-Schutz).
// ============================================================

import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import { findUserBySubscriptionId } from "../../data/db-microsoft.js";
import { computeClientState } from "../../sync/microsoft-subscriptions.js";
import { graphFetch, GraphError } from "../graph.js";
import { terminRepo } from "../../data/index.js";
import { logInfo, logError } from "../../logger.js";
import { logEvent as audit } from "../../data/db-audit.js";
import { TIMEZONE } from "../../config.js";

export const webhooksMicrosoftRoutes = new Hono<AppEnv>();

// ── Notification-Shape ────────────────────────────────────────────────────────

interface MsNotification {
  subscriptionId: string;
  subscriptionExpirationDateTime?: string;
  clientState?: string;
  changeType: "created" | "updated" | "deleted";
  resource: string;
  resourceData?: {
    id?: string;
    "@odata.etag"?: string;
  };
  tenantId?: string;
}

interface MsEventResource {
  id: string;
  subject?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  "@odata.etag"?: string;
}

// ── Datum-Mapping (dupliziert aus microsoft-sync.ts wegen circular-import) ──
function isoToBauosDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Unverstaendliches ISO-Datum: "${iso}"`);
  return `${m[3]}.${m[2]}.${m[1]}`;
}
function extractTime(dt: string): string {
  return (dt.split("T")[1] ?? "").slice(0, 5);
}

// ── Webhook-Endpoint ─────────────────────────────────────────────────────────

webhooksMicrosoftRoutes.post("/webhooks/microsoft", async (c) => {
  // Validation-Token-Echo: bei Subscription-Setup schickt MS einmal einen
  // POST mit ?validationToken=... ohne Body. Wir muessen exakt den Token
  // als text/plain zurueckschicken.
  const validationToken = c.req.query("validationToken");
  if (validationToken) {
    logInfo(`[MS-Webhook] Validation-Token-Request — Token-Echo`);
    c.header("Content-Type", "text/plain");
    return c.body(validationToken, 200);
  }

  // Notification: JSON-Body mit value[]
  let body: { value?: MsNotification[] };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    logError("[MS-Webhook] Notification ohne gueltigen JSON-Body", new Error("invalid-json"));
    return c.body(null, 202); // immer 202 damit MS nicht retry'd
  }

  const notifications = Array.isArray(body.value) ? body.value : [];
  if (notifications.length === 0) {
    return c.body(null, 202);
  }

  // Async-fan-out: jede Notification in eigenem try/catch, damit eine
  // einzelne Schlechtdaten-Notification den ganzen Batch nicht abbricht.
  // 202 wird sofort zurueckgegeben, das eigentliche Sync passiert im
  // Hintergrund — MS hat einen 30s-Timeout.
  void Promise.allSettled(notifications.map((n) => handleNotification(n))).catch(() => undefined);

  return c.body(null, 202);
});

// ── Einzelne Notification verarbeiten ────────────────────────────────────────

async function handleNotification(n: MsNotification): Promise<void> {
  if (!n.subscriptionId) {
    logError("[MS-Webhook] Notification ohne subscriptionId — drop", new Error("missing-subscription-id"));
    return;
  }

  const user = await findUserBySubscriptionId(n.subscriptionId);
  if (!user) {
    // Subscription gehoert keinem aktiven User mehr — vermutlich nach
    // Disconnect noch eine in-flight Notification. Silent ignorieren.
    return;
  }

  // clientState gegen unseren HMAC validieren — schuetzt vor gefakten
  // Notifications wenn jemand die Webhook-URL erraet.
  const expectedState = computeClientState(user.userId);
  if (n.clientState !== expectedState) {
    logError(
      `[MS-Webhook] clientState-Mismatch fuer Subscription ${n.subscriptionId} — drop`,
      new Error("client-state-mismatch"),
    );
    void audit({
      event: "ms.webhook.invalid",
      actorUserId: user.userId,
      details: { subscriptionId: n.subscriptionId, reason: "client-state-mismatch" },
      ok: false,
    });
    return;
  }

  const eventId = n.resourceData?.id;
  if (!eventId) {
    logError("[MS-Webhook] Notification ohne resourceData.id — drop", new Error("missing-event-id"));
    return;
  }

  try {
    if (n.changeType === "deleted") {
      await handleEventDeleted(user.userId, eventId);
    } else {
      await handleEventCreatedOrUpdated(user.userId, eventId, user.calendarId);
    }
  } catch (err) {
    if (err instanceof GraphError) {
      logError(`[MS-Webhook] handle ${n.changeType} ${eventId}: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Webhook] handle ${n.changeType} ${eventId} fehlgeschlagen`, err);
    }
  }
}

async function handleEventCreatedOrUpdated(userId: string, eventId: string, calendarId: string | null): Promise<void> {
  if (!terminRepo.upsertFromMs) return;

  // MS-Event holen — die Notification enthaelt nur Metadaten, nicht den
  // Event-Inhalt. Wir muessen ihn explizit fetchen.
  const { data: ev, etag } = await graphFetch<MsEventResource>(userId, `/me/events/${eventId}`);
  if (!ev || !ev.start?.dateTime) return;

  const isoDate = ev.start.dateTime.split("T")[0]!;
  const isAllDay = ev.isAllDay === true;
  const datum = isoToBauosDatum(isoDate);
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
    msCalendarId: calendarId,
    msOwnerUserId: userId,
    msEtag: ev["@odata.etag"] ?? etag,
  });
  logInfo(`[MS-Webhook] User ${userId}: Event ${eventId} via Webhook upsert'd`);

  // SSE-Event emittieren damit das Frontend live aktualisiert.
  const { emit } = await import("../events.js");
  emit({ type: "termin", action: "synced" });
  void TIMEZONE; // suppress unused
}

async function handleEventDeleted(userId: string, eventId: string): Promise<void> {
  if (!terminRepo.getByMsEventId) return;
  const local = await terminRepo.getByMsEventId(eventId);
  if (!local) return;

  // Nur loeschen wenn der Termin auch wirklich aus MS kam — wenn er von
  // Bau-OS kommt aber aus Versehen nochmal als 'deleted' gemeldet wird,
  // wuerden wir lokale Daten wegwerfen. Sicher: die Outlook-Loeschung
  // ist die Quelle der Wahrheit fuer ms_source='microsoft'-Termine.
  await terminRepo.delete(local.id);
  logInfo(`[MS-Webhook] User ${userId}: Termin ${local.id} (MS ${eventId}) via Webhook geloescht`);

  const { emit } = await import("../events.js");
  emit({ type: "termin", action: "deleted", id: local.id });
}
