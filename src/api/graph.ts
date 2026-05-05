// ============================================================
// Bau-OS — Microsoft Graph HTTP-Wrapper (Phase 2/3)
// ============================================================
// Single-point-of-truth fuer alle Graph-Calls. Kuemmert sich um:
//   - Access-Token aus DB laden + transparent refreshen wenn abgelaufen
//   - Authorization-Header setzen
//   - 401-Retry: wenn der Token plotzlich abgelaufen ist (z.B. Admin
//     hat ihn revoked), versuchen wir einmal Refresh + Retry
//   - Strukturierter GraphError mit Status + Code, damit der Caller
//     entscheiden kann ob das ein User-Fehler oder Infra-Fehler ist
//
// WICHTIG: alle Sync-Funktionen MUESSEN dieses Wrapper benutzen, niemals
// direkt fetch() gegen graph.microsoft.com — sonst handlen wir Token-
// Refresh nicht zentral und der User landet in 401-Schleifen.
// ============================================================

import { loadDecryptedTokens, updateMsTokens } from "../data/db-microsoft.js";
import { refreshAccessToken } from "./microsoft.js";
import { logError, logInfo } from "../logger.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

interface GraphErrorBody {
  error?: {
    code?: string;
    message?: string;
    innerError?: unknown;
  };
}

export interface GraphFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Wenn gesetzt: If-Match Header — fuer ETag-basierte Conditional Updates.
   *  Microsoft schmeisst 412 wenn der ETag nicht passt. */
  ifMatch?: string;
}

interface GraphFetchResult<T> {
  /** Geparste JSON-Antwort. NULL bei 204 No Content. */
  data: T | null;
  /** ETag-Header — wichtig fuer Outlook-Events um Lost-Updates zu vermeiden. */
  etag: string | null;
  status: number;
}

/** Holt einen gueltigen Access-Token fuer den User, refresht wenn noetig.
 *  Schreibt den neuen Token-Stand zurueck in die DB. */
async function getValidAccessToken(userId: string): Promise<string | null> {
  const tokens = await loadDecryptedTokens(userId);
  if (!tokens) return null;

  // 60s Sicherheitsmarge — wenn der Token in den naechsten 60s abläuft,
  // refreshen wir lieber jetzt schon, als mitten im Call.
  const expiresInMs = tokens.accessTokenExpiresAt.getTime() - Date.now();
  if (expiresInMs > 60_000) return tokens.accessToken;

  logInfo(`[MS-Graph] Access-Token fuer User ${userId} laeuft ab — refresh`);
  const fresh = await refreshAccessToken(tokens.refreshToken);
  await updateMsTokens(userId, {
    accessToken: fresh.accessToken,
    // Microsoft gibt bei jedem Refresh ein NEUES refresh_token zurueck.
    // Wenn nicht (extrem selten), behalten wir das alte.
    refreshToken: fresh.refreshToken || tokens.refreshToken,
    accessTokenExpiresAt: fresh.expiresAt,
    scope: fresh.scope,
  });
  return fresh.accessToken;
}

/** Fuehrt einen Graph-API-Call fuer einen bestimmten User aus. Token-
 *  Refresh ist transparent — Caller muss sich nicht drum kuemmern. */
export async function graphFetch<T = unknown>(
  userId: string,
  path: string,
  opts: GraphFetchOptions = {},
): Promise<GraphFetchResult<T>> {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path.startsWith("/") ? "" : "/"}${path}`;

  let token = await getValidAccessToken(userId);
  if (!token) {
    throw new GraphError(401, "no-token", "Kein gueltiger Microsoft-Token fuer diesen User");
  }

  // Bis zu 2 Versuche: erster mit aktuellem Token, falls 401 → zwangs-Refresh
  // (manchmal invalidiert MS Tokens vorzeitig) und zweiter Versuch.
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...opts.headers,
    };
    if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;

    const resp = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (resp.status === 401 && attempt === 0) {
      // Token ungueltig geworden — refresh erzwingen + retry. Wir umgehen
      // den 60s-Cache indem wir loadDecryptedTokens neu lesen + den
      // refresh_token nutzen.
      logInfo(`[MS-Graph] 401 bei ${path} fuer User ${userId} — Token-Refresh + Retry`);
      const tokens = await loadDecryptedTokens(userId);
      if (!tokens) {
        throw new GraphError(401, "no-token", "Token wurde nach 401 entfernt");
      }
      const fresh = await refreshAccessToken(tokens.refreshToken);
      await updateMsTokens(userId, {
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken || tokens.refreshToken,
        accessTokenExpiresAt: fresh.expiresAt,
        scope: fresh.scope,
      });
      token = fresh.accessToken;
      continue;
    }

    // 204 No Content (typisch bei DELETE)
    if (resp.status === 204) {
      return { data: null, etag: resp.headers.get("etag"), status: 204 };
    }

    if (!resp.ok) {
      let body: GraphErrorBody = {};
      try {
        body = (await resp.json()) as GraphErrorBody;
      } catch {
        /* manchmal liefert Graph HTML bei 5xx */
      }
      const code = body.error?.code ?? `http-${resp.status}`;
      const msg = body.error?.message ?? `Microsoft Graph: HTTP ${resp.status}`;
      throw new GraphError(resp.status, code, msg, body.error?.innerError);
    }

    const etag = resp.headers.get("etag");
    let data: T | null = null;
    try {
      data = (await resp.json()) as T;
    } catch {
      /* Body koennte leer sein bei 200 ohne Inhalt — egal */
    }
    return { data, etag, status: resp.status };
  }

  // Unreachable, aber TypeScript besteht auf return.
  throw new GraphError(500, "unreachable", "graphFetch retry-Loop ohne Ergebnis");
}

/** Convenience: alle Seiten einer paginierten Graph-Liste sammeln.
 *  MS Graph nutzt @odata.nextLink fuer Pagination. */
export async function graphFetchAll<T = unknown>(userId: string, path: string): Promise<T[]> {
  interface PageShape {
    value?: T[];
    "@odata.nextLink"?: string;
  }
  const items: T[] = [];
  let next: string | null = path;
  let safetyCounter = 0;
  while (next && safetyCounter < 50) {
    const { data }: GraphFetchResult<PageShape> = await graphFetch<PageShape>(userId, next);
    if (!data) break;
    if (Array.isArray(data.value)) items.push(...data.value);
    next = data["@odata.nextLink"] ?? null;
    safetyCounter++;
  }
  if (safetyCounter >= 50) {
    logError("[MS-Graph] Pagination ueber 50 Seiten — abgebrochen", new Error("graph-pagination-limit"));
  }
  return items;
}
