// ============================================================
// Bau-OS — Microsoft Graph OAuth-Routes (Phase 1)
// ============================================================
// Vier Endpoints fuer den OAuth-Flow + Status:
//
//   GET    /auth/microsoft/status     → ist verbunden? Mit wem?
//   POST   /auth/microsoft/connect    → liefert die Authorize-URL fuer's Frontend
//   GET    /auth/microsoft/callback   → MS leitet hierhin nach Login um (HTML-Response)
//   DELETE /auth/microsoft/disconnect → Verbindung trennen
//   PATCH  /auth/microsoft/settings   → Calendar-Mode + Sync-Schalter
//
// Sicherheit:
//   - Alle Routes (ausser callback) brauchen authMiddleware → JWT-Pflicht.
//   - state-Parameter im Authorize-Flow ist ein kurzes JWT (audience='ms-oauth')
//     mit der userId. Verhindert CSRF (Angreifer kann keinen state mit
//     fremder userId basteln) und scoped den Callback zur Session.
//   - Callback selbst ist NICHT auth-protected (MS leitet anonymous um),
//     aber der state-JWT bindet den Callback an den User der connect aufgerufen hat.
// ============================================================

import { Hono } from "hono";
import jwt from "jsonwebtoken";
import type { AppEnv } from "../server.js";
import { authMiddleware } from "../auth.js";
import { buildAuthorizeUrl, exchangeCodeForTokens, fetchUserProfile, MicrosoftAuthError } from "../microsoft.js";
import { getMsAccount, upsertMsAccount, deleteMsAccount, updateMsAccountSettings } from "../../data/db-microsoft.js";
import { logEvent as audit } from "../../data/db-audit.js";
import { logError, logInfo } from "../../logger.js";
import { JWT_SECRET, MS_GRAPH_ENABLED, MS_REDIRECT_URI, APP_URL } from "../../config.js";

export const authMicrosoftRoutes = new Hono<AppEnv>();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Berechnet die Redirect-URI aus Config oder Request. Muss EXAKT mit dem
 *  in Azure registrierten Wert uebereinstimmen — sonst lehnt Microsoft ab. */
function redirectUri(c: { req: { header(name: string): string | undefined } }): string {
  if (MS_REDIRECT_URI) return MS_REDIRECT_URI;
  const base =
    APP_URL ||
    (() => {
      const proto = c.req.header("x-forwarded-proto") ?? "http";
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost";
      return `${proto}://${host}`;
    })();
  return `${base.replace(/\/$/, "")}/api/auth/microsoft/callback`;
}

interface MsOauthState {
  sub: string; // user-id
  aud: "ms-oauth";
  /** Wo das Frontend nach erfolgreichem Connect hin-redirected — z.B. /settings. */
  returnTo?: string;
}

function createState(userId: string, returnTo?: string): string {
  const payload: MsOauthState = { sub: userId, aud: "ms-oauth", returnTo };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "10m" });
}

function verifyState(state: string): MsOauthState | null {
  try {
    const decoded = jwt.verify(state, JWT_SECRET, { audience: "ms-oauth" }) as MsOauthState;
    if (decoded.aud !== "ms-oauth") return null;
    return decoded;
  } catch {
    return null;
  }
}

function reqMeta(c: { req: { header(name: string): string | undefined } }): { ip: string; userAgent: string } {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";
  const ua = (c.req.header("user-agent") ?? "").slice(0, 256);
  return { ip, userAgent: ua };
}

// ── GET /auth/microsoft/status ──────────────────────────────────────────────

authMicrosoftRoutes.get("/auth/microsoft/status", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ connected: false, available: MS_GRAPH_ENABLED });

  if (!MS_GRAPH_ENABLED) {
    return c.json({
      connected: false,
      available: false,
      reason: "Backend ist nicht konfiguriert. Admin muss MS_CLIENT_ID/SECRET/TENANT_ID in der .env setzen.",
    });
  }

  const account = await getMsAccount(userId);
  if (!account) return c.json({ connected: false, available: true });
  return c.json({
    connected: true,
    available: true,
    account: {
      msEmail: account.msEmail,
      msDisplayName: account.msDisplayName,
      calendarMode: account.calendarMode,
      syncEnabled: account.syncEnabled,
      lastSyncAt: account.lastSyncAt,
      lastSyncError: account.lastSyncError,
      accessTokenValid: account.accessTokenValid,
      // Phase-4 Webhook-Status — UI zeigt "Instant-Sync aktiv" wenn
      // beides stimmt (Subscription existiert + laeuft noch).
      webhookActive:
        !!account.subscriptionId &&
        !!account.subscriptionExpiresAt &&
        new Date(account.subscriptionExpiresAt).getTime() > Date.now(),
      subscriptionExpiresAt: account.subscriptionExpiresAt,
    },
  });
});

// ── POST /auth/microsoft/connect ────────────────────────────────────────────
// Frontend ruft das auf, kriegt die Microsoft-Authorize-URL zurueck und
// oeffnet sie in einem neuen Tab oder Popup. Der Backend bleibt also rein
// passiv — es generiert nur die korrekt parametrisierte URL inkl. state.

authMicrosoftRoutes.post("/auth/microsoft/connect", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);
  if (!MS_GRAPH_ENABLED) {
    return c.json({ error: "Microsoft-Integration ist nicht konfiguriert" }, 503);
  }

  let body: { returnTo?: string } = {};
  try {
    body = await c.req.json<{ returnTo?: string }>();
  } catch {
    /* Body ist optional */
  }

  const state = createState(userId, body.returnTo);
  const url = buildAuthorizeUrl({ state, redirectUri: redirectUri(c) });
  return c.json({ url });
});

// ── GET /auth/microsoft/callback ────────────────────────────────────────────
// Microsoft leitet den User-Browser hierhin um nach erfolgreicher (oder
// abgebrochener) Anmeldung. Wir tauschen ?code= gegen Tokens, holen das
// Profil, speichern alles, und schicken eine schmale HTML-Antwort die
// das Browser-Tab schliesst (oder zum returnTo-Pfad redirected).

authMicrosoftRoutes.get("/auth/microsoft/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");
  const meta = reqMeta(c);

  if (error) {
    void audit({
      event: "ms.callback.fail",
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { error, errorDescription },
      ok: false,
    });
    return c.html(renderResultPage("error", errorDescription || error));
  }
  if (!code || !state) {
    return c.html(renderResultPage("error", "Microsoft hat keinen Code mitgesendet."));
  }

  const claim = verifyState(state);
  if (!claim) {
    void audit({
      event: "ms.callback.fail",
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { reason: "invalid-state" },
      ok: false,
    });
    return c.html(renderResultPage("error", "Sicherheits-Token ungueltig oder abgelaufen. Bitte neu starten."));
  }

  try {
    const tokens = await exchangeCodeForTokens({ code, redirectUri: redirectUri(c) });
    const profile = await fetchUserProfile(tokens.accessToken);

    const account = await upsertMsAccount({
      userId: claim.sub,
      msUserId: profile.id,
      msEmail: profile.email,
      msDisplayName: profile.displayName || null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });

    logInfo(`[MS] User ${claim.sub} verbunden mit ${profile.email}`);
    void audit({
      event: "ms.connect",
      actorUserId: claim.sub,
      ip: meta.ip,
      userAgent: meta.userAgent,
      details: { msEmail: account.msEmail },
    });
    return c.html(renderResultPage("success", `Verbunden mit ${profile.email}`, claim.returnTo));
  } catch (err) {
    if (err instanceof MicrosoftAuthError) {
      logError(`[MS] Token-Exchange fehlgeschlagen: ${err.code}`, err);
      return c.html(renderResultPage("error", err.message));
    }
    logError("[MS] Unbekannter Fehler im Callback", err);
    return c.html(renderResultPage("error", "Unbekannter Fehler. Server-Logs ansehen."));
  }
});

// ── DELETE /auth/microsoft/disconnect ───────────────────────────────────────

authMicrosoftRoutes.delete("/auth/microsoft/disconnect", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);

  const account = await getMsAccount(userId);
  if (!account) return c.json({ ok: true, message: "Kein verbundenes Konto" });

  // Alle Webhook-Subscriptions bei MS aufraeumen — Multi-Calendar:
  // pro Junction-Eintrag eine Sub. Best-effort: wenn das fehlschlaegt
  // loggen wir und loeschen trotzdem das lokale Konto.
  try {
    const { deleteAllSubscriptionsForUser } = await import("../../sync/microsoft-subscriptions.js");
    await deleteAllSubscriptionsForUser(userId);
  } catch (err) {
    logError("[MS] deleteAllSubscriptionsForUser bei Disconnect fehlgeschlagen", err);
  }

  const ok = await deleteMsAccount(userId);
  if (!ok) return c.json({ error: "Trennen fehlgeschlagen" }, 500);

  const meta = reqMeta(c);
  void audit({
    event: "ms.disconnect",
    actorUserId: userId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { msEmail: account.msEmail },
  });
  return c.json({ ok: true });
});

// ── PATCH /auth/microsoft/settings ──────────────────────────────────────────

authMicrosoftRoutes.patch("/auth/microsoft/settings", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);

  let body: { calendarMode?: "default" | "bau-os"; syncEnabled?: boolean };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Body" }, 400);
  }

  if (body.calendarMode && !["default", "bau-os"].includes(body.calendarMode)) {
    return c.json({ error: "calendarMode muss 'default' oder 'bau-os' sein" }, 400);
  }

  const previous = await getMsAccount(userId);
  const updated = await updateMsAccountSettings(userId, body);
  if (!updated) return c.json({ error: "Kein verbundenes Konto" }, 404);

  // Webhook-Lifecycle: Master-Switch syncEnabled steuert ALLE
  // Subscriptions des Users. Pro-Kalender-Toggles laufen ueber den
  // /calendars/:id-Endpoint (Phase 5c).
  //  - syncEnabled FALSE → TRUE: alle aktiven Junction-Kalender bekommen
  //    eine Subscription
  //  - syncEnabled TRUE  → FALSE: alle Subs aufraeumen
  try {
    const wasOn = previous?.syncEnabled === true;
    const isOn = updated.syncEnabled === true;
    if (isOn && !wasOn) {
      const { createSubscription } = await import("../../sync/microsoft-subscriptions.js");
      const { listEnabledCalendars } = await import("../../data/db-microsoft.js");
      const cals = await listEnabledCalendars(userId);
      for (const c of cals) {
        void createSubscription(userId, c.calendarId).catch((err) =>
          logError(`[MS] createSubscription nach Toggle fuer Cal ${c.calendarId} fehlgeschlagen`, err),
        );
      }
    } else if (!isOn && wasOn) {
      const { deleteAllSubscriptionsForUser } = await import("../../sync/microsoft-subscriptions.js");
      void deleteAllSubscriptionsForUser(userId).catch((err) =>
        logError("[MS] deleteAllSubscriptionsForUser nach Toggle fehlgeschlagen", err),
      );
    }
  } catch (err) {
    logError("[MS] Webhook-Lifecycle-Hook im Settings-Patch", err);
  }

  return c.json({ ok: true, account: updated });
});

// ── Multi-Calendar (Phase 5c) ───────────────────────────────────────────────

/** Liste aller Outlook-Kalender des Users (mit enable-Status).
 *  Wenn die Junction noch leer ist, triggert Discovery — der erste Aufruf
 *  nach dem Connect populiert sie automatisch. */
authMicrosoftRoutes.get("/auth/microsoft/calendars", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);

  const { listUserCalendars } = await import("../../data/db-microsoft.js");
  let cals = await listUserCalendars(userId);
  if (cals.length === 0) {
    try {
      const { discoverCalendars } = await import("../../sync/microsoft-sync.js");
      await discoverCalendars(userId);
      cals = await listUserCalendars(userId);
    } catch (err) {
      logError("[MS] discoverCalendars beim ersten Aufruf fehlgeschlagen", err);
    }
  }
  return c.json({ calendars: cals });
});

/** Refresh: holt aktuelle Liste von Microsoft + upsert in Junction.
 *  User druecken den "Refresh"-Button wenn sie in Outlook einen neuen
 *  Kalender angelegt haben und der hier auftauchen soll. */
authMicrosoftRoutes.post("/auth/microsoft/calendars/refresh", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);
  try {
    const { discoverCalendars } = await import("../../sync/microsoft-sync.js");
    const cals = await discoverCalendars(userId);
    return c.json({ ok: true, calendars: cals });
  } catch (err) {
    logError("[MS] discoverCalendars (refresh) fehlgeschlagen", err);
    return c.json({ error: err instanceof Error ? err.message : "Refresh fehlgeschlagen" }, 502);
  }
});

/** Toggle eines einzelnen Kalenders (enabled true/false). Bei Aktivierung
 *  wird sofort eine Subscription angelegt, bei Deaktivierung die alte
 *  geloescht — Webhook-Lifecycle pro Kalender. */
authMicrosoftRoutes.patch("/auth/microsoft/calendars/:calendarId", authMiddleware, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);
  const calendarId = c.req.param("calendarId");
  if (!calendarId) return c.json({ error: "Kalender-ID fehlt" }, 400);

  let body: { enabled?: boolean; direction?: "both" | "pull-only" | "push-only" };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Body" }, 400);
  }

  const { setCalendarEnabled, upsertUserCalendar } = await import("../../data/db-microsoft.js");
  const { listUserCalendars } = await import("../../data/db-microsoft.js");
  const before = (await listUserCalendars(userId)).find((c) => c.calendarId === calendarId);
  if (!before) return c.json({ error: "Kalender nicht gefunden" }, 404);

  let updated = before;
  if (body.enabled !== undefined) {
    updated = (await setCalendarEnabled(userId, calendarId, body.enabled)) ?? updated;
  }
  if (body.direction) {
    updated = await upsertUserCalendar({ userId, calendarId, direction: body.direction });
  }

  // Subscription-Lifecycle: nur wenn der User-Master-Toggle (syncEnabled
  // auf user_microsoft_accounts) aktiv ist, brauchen wir Subs anzulegen.
  // Ist der Master aus, blockiert der Sync sowieso — Sub waere unnoetig.
  try {
    const account = await getMsAccount(userId);
    if (account?.syncEnabled) {
      if (before.enabled === false && updated.enabled === true) {
        const { createSubscription } = await import("../../sync/microsoft-subscriptions.js");
        void createSubscription(userId, calendarId).catch((err) =>
          logError(`[MS] createSubscription fuer Cal ${calendarId} fehlgeschlagen`, err),
        );
      } else if (before.enabled === true && updated.enabled === false) {
        const { deleteSubscription } = await import("../../sync/microsoft-subscriptions.js");
        void deleteSubscription(userId, calendarId).catch((err) =>
          logError(`[MS] deleteSubscription fuer Cal ${calendarId} fehlgeschlagen`, err),
        );
      }
    }
  } catch (err) {
    logError("[MS] Subscription-Lifecycle bei Kalender-Toggle", err);
  }

  return c.json({ ok: true, calendar: updated });
});

// ── HTML-Response fuer den Callback ─────────────────────────────────────────
// Minimale Seite die entweder das Tab schliesst oder zum returnTo
// redirected. Inline-Styles weil es eigenstaendig im OAuth-Tab landet,
// nicht in der SPA.

function renderResultPage(kind: "success" | "error", message: string, returnTo?: string): string {
  const safeMsg = String(message).replace(
    /[<>&"]/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch] || ch,
  );
  const safeReturn = returnTo ? String(returnTo).replace(/['"<>]/g, "") : "/settings";
  const ok = kind === "success";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Bau-OS · Microsoft-Verbindung</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
    background: #FAFAFA; color: #111827; padding: 20px; }
  .card { background: #fff; border: 1px solid #E5E7EB; border-radius: 10px;
    padding: 32px; max-width: 420px; width: 100%; text-align: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.04); }
  .icon { width: 56px; height: 56px; border-radius: 50%; display: inline-flex;
    align-items: center; justify-content: center; margin-bottom: 18px;
    background: ${ok ? "#dcfce7" : "#fee2e2"}; color: ${ok ? "#166534" : "#991b1b"};
    font-size: 32px; font-weight: 600; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px 0; letter-spacing: -0.01em; }
  p { color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0 0 24px 0;
    word-break: break-word; }
  .btn { display: inline-block; background: #111827; color: #fff;
    padding: 10px 20px; border-radius: 6px; text-decoration: none;
    font-size: 13px; font-weight: 500; }
  .btn-secondary { background: #fff; color: #111827; border: 1px solid #E5E7EB; margin-left: 8px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${ok ? "✓" : "!"}</div>
    <h1>${ok ? "Microsoft-Konto verbunden" : "Verbindung fehlgeschlagen"}</h1>
    <p>${safeMsg}</p>
    <a href="${safeReturn}" class="btn">${ok ? "Zurück zu Bau-OS" : "Erneut versuchen"}</a>
    <button onclick="window.close()" class="btn btn-secondary">Tab schließen</button>
  </div>
  <script>
    // Wenn als Popup geoeffnet: dem opener mitteilen + nach 2s schliessen.
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({ type: 'bauos:ms-oauth', kind: '${kind}', message: ${JSON.stringify(safeMsg)} }, '*');
      } catch (e) { /* cross-origin */ }
      setTimeout(() => window.close(), 1500);
    }
  </script>
</body>
</html>`;
}
