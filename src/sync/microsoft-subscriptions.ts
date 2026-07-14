// ============================================================
// PATIO — Microsoft Graph Subscriptions (Phase 4 + 5c)
// ============================================================
// Statt 5-min-Polling abonnieren wir bei Microsoft Graph Push-
// Notifications fuer den Outlook-Calendar. Bei jeder Aenderung
// in Outlook schickt MS einen POST an unseren Webhook-Endpoint
// und wir syncen den einzelnen Event sofort — Latenz < 1 Sekunde.
//
// Multi-Calendar (Phase 5c): pro (User, Kalender) eine eigene
// Subscription. Resource-Pfad ist immer "/me/calendars/{id}/events".
// Junction-Table user_microsoft_calendars haelt subscription_id +
// expires_at pro Kalender. Webhook-Receiver mappt subscriptionId →
// (User, Kalender) ueber findCalendarBySubscriptionId.
//
// Lebenszyklus:
//   1. createSubscription(userId, calendarId) bei enable=true
//   2. renewSubscription() vor Ablauf (stuendlicher Cron)
//   3. deleteSubscription(userId, calendarId) bei disable / disconnect
//
// Sicherheit (clientState):
//   - HMAC-SHA256(userId+calendarId, JWT_SECRET).slice(0, 32)
//   - Webhook-Endpoint validiert clientState gegen den Erwarteten,
//     pro Subscription separat — verhindert Cross-Calendar-Spoofing.
// ============================================================

import crypto from "crypto";
import { graphFetch, GraphError } from "../api/graph.js";
import {
  getMsAccount,
  listEnabledCalendars,
  setCalendarSubscription,
  clearCalendarSubscription,
  listExpiringCalendarSubscriptions,
} from "../data/db-microsoft.js";
import { APP_URL, JWT_SECRET, MS_GRAPH_ENABLED } from "../config.js";
import { logInfo, logError } from "../logger.js";

/** Maximum-Lifetime von MS-Calendar-Subscriptions: 4230 Minuten. */
const SUBSCRIPTION_LIFETIME_MINUTES = 4200;

/** Renewal-Schwelle: alles was in <12h ablaeuft erneuern. */
export const RENEWAL_WINDOW_HOURS = 12;

/** HMAC-clientState aus userId + calendarId + JWT_SECRET. Pro
 *  (User, Kalender) eindeutig. */
export function computeClientState(userId: string, calendarId?: string): string {
  const key = calendarId ? `ms-webhook:${userId}:${calendarId}` : `ms-webhook:${userId}`;
  return crypto.createHmac("sha256", JWT_SECRET).update(key).digest("hex").slice(0, 32);
}

function notificationUrl(): string {
  if (!APP_URL) {
    throw new Error("APP_URL nicht gesetzt — Microsoft-Webhooks brauchen eine HTTPS-Public-URL");
  }
  return `${APP_URL.replace(/\/$/, "")}/api/webhooks/microsoft`;
}

interface MsSubscriptionResponse {
  id: string;
  expirationDateTime: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
}

/** Erstellt eine neue Subscription fuer einen bestimmten Kalender eines
 *  Users. Idempotent: wenn fuer denselben Kalender schon eine existiert,
 *  wird sie vorher geloescht (clean re-create). */
export async function createSubscription(
  userId: string,
  calendarId: string,
): Promise<{ subscriptionId: string; expiresAt: Date } | null> {
  if (!MS_GRAPH_ENABLED) return null;
  const account = await getMsAccount(userId);
  if (!account) return null;

  // Bestehenden Sub fuer diesen Kalender saubermachen.
  const calendars = await listEnabledCalendars(userId);
  const existing = calendars.find((c) => c.calendarId === calendarId);
  if (existing?.subscriptionId) {
    await deleteSubscription(userId, calendarId).catch(() => undefined);
  }

  const expiresAt = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000);
  const body = {
    changeType: "created,updated,deleted",
    notificationUrl: notificationUrl(),
    resource: `/me/calendars/${calendarId}/events`,
    expirationDateTime: expiresAt.toISOString(),
    clientState: computeClientState(userId, calendarId),
  };

  try {
    const { data } = await graphFetch<MsSubscriptionResponse>(userId, "/subscriptions", {
      method: "POST",
      body,
    });
    if (!data?.id) throw new Error("Microsoft hat keine Subscription-ID zurueckgegeben");
    const persistedExpiry = new Date(data.expirationDateTime);
    await setCalendarSubscription(userId, calendarId, {
      subscriptionId: data.id,
      expiresAt: persistedExpiry,
    });
    logInfo(
      `[MS-Webhook] Subscription ${data.id} fuer User ${userId} Cal ${calendarId} angelegt (laeuft ${persistedExpiry.toISOString()} ab)`,
    );
    return { subscriptionId: data.id, expiresAt: persistedExpiry };
  } catch (err) {
    if (err instanceof GraphError) {
      logError(
        `[MS-Webhook] createSubscription User ${userId} Cal ${calendarId}: ${err.code} (HTTP ${err.status})`,
        err,
      );
    } else {
      logError(`[MS-Webhook] createSubscription User ${userId} Cal ${calendarId} fehlgeschlagen`, err);
    }
    return null;
  }
}

/** Verlaengert eine bestehende Subscription. */
export async function renewSubscription(userId: string, calendarId: string, subscriptionId: string): Promise<boolean> {
  if (!MS_GRAPH_ENABLED) return false;

  const expiresAt = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000);
  try {
    const { data } = await graphFetch<MsSubscriptionResponse>(userId, `/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: { expirationDateTime: expiresAt.toISOString() },
    });
    const newExpiry = data?.expirationDateTime ? new Date(data.expirationDateTime) : expiresAt;
    await setCalendarSubscription(userId, calendarId, { subscriptionId, expiresAt: newExpiry });
    logInfo(
      `[MS-Webhook] Subscription ${subscriptionId} (User ${userId} Cal ${calendarId}) erneuert (${newExpiry.toISOString()})`,
    );
    return true;
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      logInfo(`[MS-Webhook] Subscription ${subscriptionId} bei MS verschwunden — neu anlegen`);
      await clearCalendarSubscription(userId, calendarId);
      await createSubscription(userId, calendarId).catch(() => undefined);
      return false;
    }
    if (err instanceof GraphError) {
      logError(`[MS-Webhook] renewSubscription ${subscriptionId}: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Webhook] renewSubscription ${subscriptionId} fehlgeschlagen`, err);
    }
    return false;
  }
}

/** Loescht die Subscription bei Microsoft + lokale Felder fuer EINEN
 *  Kalender. Beim Disconnect ruft der Caller deleteAllSubscriptionsForUser. */
export async function deleteSubscription(userId: string, calendarId: string): Promise<void> {
  const calendars = await listEnabledCalendars(userId);
  const cal = calendars.find((c) => c.calendarId === calendarId);
  const subId = cal?.subscriptionId;
  if (!subId) {
    await clearCalendarSubscription(userId, calendarId);
    return;
  }
  try {
    await graphFetch(userId, `/subscriptions/${subId}`, { method: "DELETE" });
    logInfo(`[MS-Webhook] Subscription ${subId} (User ${userId} Cal ${calendarId}) bei MS geloescht`);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      // schon weg
    } else if (err instanceof GraphError) {
      logError(`[MS-Webhook] deleteSubscription ${subId}: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Webhook] deleteSubscription ${subId} fehlgeschlagen`, err);
    }
  }
  await clearCalendarSubscription(userId, calendarId);
}

/** Loescht ALLE Subscriptions eines Users — wird beim Disconnect aufgerufen. */
export async function deleteAllSubscriptionsForUser(userId: string): Promise<void> {
  const calendars = await listEnabledCalendars(userId);
  for (const c of calendars) {
    if (c.subscriptionId) {
      await deleteSubscription(userId, c.calendarId).catch(() => undefined);
    }
  }
}

/** Erneuert alle Subscriptions die in den naechsten RENEWAL_WINDOW_HOURS
 *  ablaufen. */
export async function renewExpiringSubscriptions(): Promise<{ renewed: number; errors: number }> {
  if (!MS_GRAPH_ENABLED) return { renewed: 0, errors: 0 };
  const expiring = await listExpiringCalendarSubscriptions(RENEWAL_WINDOW_HOURS);
  let renewed = 0;
  let errors = 0;
  for (const e of expiring) {
    const ok = await renewSubscription(e.userId, e.calendarId, e.subscriptionId);
    if (ok) renewed++;
    else errors++;
  }
  if (expiring.length > 0) {
    logInfo(`[MS-Webhook] Renewal-Lauf: ${renewed}/${expiring.length} erneuert (${errors} Fehler)`);
  }
  return { renewed, errors };
}
