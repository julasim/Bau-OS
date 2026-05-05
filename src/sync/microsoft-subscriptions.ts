// ============================================================
// Bau-OS — Microsoft Graph Subscriptions (Phase 4: Webhooks)
// ============================================================
// Statt 5-min-Polling abonnieren wir bei Microsoft Graph Push-
// Notifications fuer den Outlook-Calendar. Bei jeder Aenderung
// in Outlook schickt MS einen POST an unseren Webhook-Endpoint
// und wir syncen den einzelnen Event sofort — Latenz < 1 Sekunde.
//
// Lebenszyklus:
//   1. createSubscription() bei sync_enabled = true
//      - POST /subscriptions mit notificationUrl + clientState
//      - MS validiert sofort den Endpoint mit ?validationToken (handled
//        in routes/webhooks-microsoft.ts)
//      - Bei Erfolg: subscription_id + subscription_expires_at speichern
//   2. renewSubscription() bevor das Ablaufdatum kommt
//      - PATCH /subscriptions/{id} mit neuer expirationDateTime
//      - Maximum bei calendar events: 4230 Minuten (~70h, ~3 Tage)
//   3. deleteSubscription() bei Disconnect oder sync_enabled = false
//
// Sicherheit (clientState):
//   - HMAC-SHA256(userId, JWT_SECRET).slice(0, 32) — deterministisch,
//     keine zusaetzliche DB-Spalte noetig.
//   - Webhook-Endpoint validiert den clientState aus jeder Notification
//     gegen den Erwarteten — verhindert dass jemand der die URL kennt
//     gefakte Events einspielen kann.
// ============================================================

import crypto from "crypto";
import { graphFetch, GraphError } from "../api/graph.js";
import { getMsAccount, setSubscription, clearSubscription } from "../data/db-microsoft.js";
import { APP_URL, JWT_SECRET, MS_GRAPH_ENABLED } from "../config.js";
import { logInfo, logError } from "../logger.js";

/** Maximum-Lifetime von MS-Calendar-Subscriptions: 4230 Minuten.
 *  Wir setzen 4200min (~70h) um etwas Puffer zu haben falls die
 *  Validation oder der Renewal-Cron langsam ist. */
const SUBSCRIPTION_LIFETIME_MINUTES = 4200;

/** Renewal-Schwelle: alles was in <12h ablaeuft erneuern. Damit haben
 *  wir bei einem Cron-Outage von einigen Stunden noch Puffer. */
export const RENEWAL_WINDOW_HOURS = 12;

/** HMAC-clientState aus userId + JWT_SECRET. Deterministisch — gleicher
 *  User → immer gleicher String. Dadurch koennen wir bei jeder
 *  Notification den clientState validieren ohne DB-Lookup. */
export function computeClientState(userId: string): string {
  return crypto.createHmac("sha256", JWT_SECRET).update(`ms-webhook:${userId}`).digest("hex").slice(0, 32);
}

/** Notification-URL fuer Microsoft. Muss HTTPS sein — sonst lehnt MS
 *  die Subscription mit "InvalidNotificationUrl" ab. */
function notificationUrl(): string {
  if (!APP_URL) {
    throw new Error("APP_URL nicht gesetzt — Microsoft-Webhooks brauchen eine HTTPS-Public-URL");
  }
  return `${APP_URL.replace(/\/$/, "")}/api/webhooks/microsoft`;
}

/** Resource-Pfad: bei Default-Calendar-Mode '/me/events', sonst ein
 *  spezifischer Calendar. Default-Mode ist ein bisschen breiter (alle
 *  Kalender des Users), 'bau-os' ist eingegrenzt auf den eigens
 *  angelegten Bau-OS-Calendar. */
function subscriptionResource(calendarMode: "default" | "bau-os", calendarId: string | null): string {
  if (calendarMode === "bau-os" && calendarId) {
    return `/me/calendars/${calendarId}/events`;
  }
  return "/me/events";
}

interface MsSubscriptionResponse {
  id: string;
  expirationDateTime: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
}

/** Erstellt eine neue Subscription fuer den User. Idempotent: wenn schon
 *  eine existiert wird sie vorher geloescht (clean re-create). */
export async function createSubscription(userId: string): Promise<{ subscriptionId: string; expiresAt: Date } | null> {
  if (!MS_GRAPH_ENABLED) return null;
  const account = await getMsAccount(userId);
  if (!account) return null;

  // Wenn schon eine Subscription existiert: erst saubermachen damit wir
  // keinen Zombie haben (z.B. wenn ein vorheriger Connect die Sub angelegt
  // hat aber nie geloescht hat).
  if (account.subscriptionId) {
    await deleteSubscription(userId).catch(() => undefined);
  }

  const expiresAt = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000);
  const body = {
    changeType: "created,updated,deleted",
    notificationUrl: notificationUrl(),
    resource: subscriptionResource(account.calendarMode, account.calendarId),
    expirationDateTime: expiresAt.toISOString(),
    clientState: computeClientState(userId),
  };

  try {
    const { data } = await graphFetch<MsSubscriptionResponse>(userId, "/subscriptions", {
      method: "POST",
      body,
    });
    if (!data?.id) {
      throw new Error("Microsoft hat keine Subscription-ID zurueckgegeben");
    }
    const persistedExpiry = new Date(data.expirationDateTime);
    await setSubscription(userId, {
      subscriptionId: data.id,
      expiresAt: persistedExpiry,
    });
    logInfo(
      `[MS-Webhook] Subscription ${data.id} fuer User ${userId} angelegt (laeuft ${persistedExpiry.toISOString()} ab)`,
    );
    return { subscriptionId: data.id, expiresAt: persistedExpiry };
  } catch (err) {
    if (err instanceof GraphError) {
      logError(`[MS-Webhook] createSubscription fuer User ${userId}: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Webhook] createSubscription fuer User ${userId} fehlgeschlagen`, err);
    }
    return null;
  }
}

/** Verlaengert eine bestehende Subscription. Wird vom Renewal-Cron
 *  aufgerufen sobald das Ablaufdatum naeher als RENEWAL_WINDOW_HOURS rueckt. */
export async function renewSubscription(userId: string): Promise<boolean> {
  if (!MS_GRAPH_ENABLED) return false;
  const account = await getMsAccount(userId);
  if (!account || !account.subscriptionId) return false;

  const expiresAt = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000);
  try {
    const { data } = await graphFetch<MsSubscriptionResponse>(userId, `/subscriptions/${account.subscriptionId}`, {
      method: "PATCH",
      body: { expirationDateTime: expiresAt.toISOString() },
    });
    const newExpiry = data?.expirationDateTime ? new Date(data.expirationDateTime) : expiresAt;
    await setSubscription(userId, {
      subscriptionId: account.subscriptionId,
      expiresAt: newExpiry,
    });
    logInfo(
      `[MS-Webhook] Subscription ${account.subscriptionId} fuer User ${userId} erneuert (${newExpiry.toISOString()})`,
    );
    return true;
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      // MS hat die Sub schon vergessen — clear lokal, naechster
      // Sync-Lauf legt eine neue an.
      logInfo(`[MS-Webhook] Subscription ${account.subscriptionId} bei MS nicht mehr vorhanden — lokal aufraeumen`);
      await clearSubscription(userId);
      // Versuch sofort eine neue anzulegen, damit Webhook weiter laeuft.
      await createSubscription(userId).catch(() => undefined);
      return false;
    }
    if (err instanceof GraphError) {
      logError(`[MS-Webhook] renewSubscription fuer User ${userId}: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Webhook] renewSubscription fuer User ${userId} fehlgeschlagen`, err);
    }
    return false;
  }
}

/** Loescht die Subscription bei Microsoft + lokale Felder. Wird beim
 *  Disconnect oder Sync-Disable aufgerufen. */
export async function deleteSubscription(userId: string): Promise<void> {
  const account = await getMsAccount(userId);
  if (!account || !account.subscriptionId) return;

  try {
    await graphFetch(userId, `/subscriptions/${account.subscriptionId}`, { method: "DELETE" });
    logInfo(`[MS-Webhook] Subscription ${account.subscriptionId} fuer User ${userId} bei MS geloescht`);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      // Schon weg — kein Fehler, bloss aufraeumen.
    } else if (err instanceof GraphError) {
      logError(`[MS-Webhook] deleteSubscription bei MS: ${err.code} (HTTP ${err.status})`, err);
    } else {
      logError(`[MS-Webhook] deleteSubscription fehlgeschlagen`, err);
    }
  }
  // Lokal IMMER aufraeumen, auch wenn MS-Delete fehlgeschlagen ist —
  // sonst koennten wir uns in einem Zombie-Zustand verfangen.
  await clearSubscription(userId);
}

/** Erneuert alle Subscriptions die in den naechsten RENEWAL_WINDOW_HOURS
 *  ablaufen. Wird vom stuendlichen Cron in maintenance.ts aufgerufen. */
export async function renewExpiringSubscriptions(): Promise<{ renewed: number; errors: number }> {
  if (!MS_GRAPH_ENABLED) return { renewed: 0, errors: 0 };
  const { listExpiringSubscriptions } = await import("../data/db-microsoft.js");
  const expiring = await listExpiringSubscriptions(RENEWAL_WINDOW_HOURS);
  let renewed = 0;
  let errors = 0;
  for (const e of expiring) {
    const ok = await renewSubscription(e.userId);
    if (ok) renewed++;
    else errors++;
  }
  if (expiring.length > 0) {
    logInfo(`[MS-Webhook] Renewal-Lauf: ${renewed}/${expiring.length} erneuert (${errors} Fehler)`);
  }
  return { renewed, errors };
}
