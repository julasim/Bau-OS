// ============================================================
// Bau-OS — Microsoft Graph OAuth-Helper (Phase 1)
// ============================================================
// Reine Pure-Functions fuer den OAuth-Authorization-Code-Flow:
//   1. buildAuthorizeUrl(state) → URL die User aufruft
//   2. exchangeCodeForTokens(code) → tauscht ?code= gegen Tokens
//   3. refreshAccessToken(refreshToken) → erneuert abgelaufenes Access
//   4. fetchUserProfile(accessToken) → /me, holt Email + Display-Name
//
// Kein Microsoft Graph SDK — die offizielle Lib ist 10+ MB. Wir machen
// 3 fetch-Calls direkt, das ist 50 Zeilen Code.
//
// Fehler werden als typed Errors geworfen, damit der Caller (server.ts)
// klare Antworten an den User schicken kann.
// ============================================================

import { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID } from "../config.js";

const AUTH_BASE = `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0`;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Calendars.ReadWrite"];

export class MicrosoftAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "MicrosoftAuthError";
  }
}

// ── Authorize URL ────────────────────────────────────────────────────────────

/** Baut die URL die der User im Browser aufruft, um sich bei Microsoft
 *  anzumelden + Bau-OS Calendar-Zugriff zu erlauben.
 *  state: CSRF-Schutz + User-Anker (kurzes JWT vom Caller). */
export function buildAuthorizeUrl(opts: { state: string; redirectUri: string }): string {
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: SCOPES.join(" "),
    state: opts.state,
    // Konsistentes Login-Erlebnis: zeige den User-Account-Picker, auch wenn
    // einer im Browser-Cache liegt. Damit kann jemand mit mehreren MS-Konten
    // explizit auswaehlen.
    prompt: "select_account",
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

// ── Token-Endpoints ──────────────────────────────────────────────────────────

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface RawErrorResponse {
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenSet> {
  const resp = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await resp.json()) as RawTokenResponse | RawErrorResponse;
  if (!resp.ok || "error" in json) {
    const e = json as RawErrorResponse;
    throw new MicrosoftAuthError(
      e.error || "token-request-failed",
      e.error_description || "Microsoft Token-Request fehlgeschlagen",
    );
  }
  const r = json as RawTokenResponse;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? "",
    expiresAt: new Date(Date.now() + r.expires_in * 1000),
    scope: r.scope,
  };
}

/** Code aus dem OAuth-Callback gegen Access + Refresh Token tauschen. */
export async function exchangeCodeForTokens(opts: { code: string; redirectUri: string }): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    scope: SCOPES.join(" "),
  });
  return postToken(body);
}

/** Refresh-Token verwenden um neues access_token zu holen.
 *  Microsoft gibt bei jedem Refresh auch ein NEUES refresh_token zurueck —
 *  wir muessen es speichern (im Caller). */
export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPES.join(" "),
  });
  return postToken(body);
}

// ── User-Profil ──────────────────────────────────────────────────────────────

export interface MsUserProfile {
  id: string;
  email: string;
  displayName: string;
}

interface RawProfile {
  id: string;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

/** Holt /me — fuer "verbunden mit X" Anzeige + ms_user_id Speicherung. */
export async function fetchUserProfile(accessToken: string): Promise<MsUserProfile> {
  const resp = await fetch(`${GRAPH_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new MicrosoftAuthError("profile-fetch-failed", `Microsoft Graph /me: HTTP ${resp.status} ${txt}`);
  }
  const r = (await resp.json()) as RawProfile;
  return {
    id: r.id,
    // Microsoft vergibt mail nicht immer; userPrincipalName ist immer da.
    email: r.mail ?? r.userPrincipalName ?? "",
    displayName: r.displayName ?? "",
  };
}
