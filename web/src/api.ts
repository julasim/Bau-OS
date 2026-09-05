const BASE = "/api";

/**
 * Ein Fehler vom Server — mit Statuscode.
 *
 * ── Warum es die Klasse gibt ───────────────────────────────────────────────
 *
 * Hier wurde bis zum 01.09.2026 ein generisches `Error` mit dem Meldungstext
 * geworfen. Statuscode und die Felder, die der Server bei einem Konflikt
 * ausdrücklich mitschickt (`src/api/server.ts`: `konflikt`, `aktuell`,
 * `erwarteteRev`, `aktuelleRev`), gingen dabei verloren.
 *
 * Folge: **keine Ansicht konnte 409 von 500 unterscheiden.** Auch die drei
 * Aufgaben-Ansichten, die als Vorbild galten, behandelten in Wahrheit jeden
 * Fehler gleich — sie luden bei jedem Fehlschlag neu und verwarfen damit bei
 * einem 400 die Eingabe des Nutzers, statt ihm zu sagen, was falsch war.
 *
 * ── Wie damit umzugehen ist ────────────────────────────────────────────────
 *
 *   * **409** — jemand anderes war schneller. Meldung zeigen, Datensatz neu
 *     laden, die Eingabe des Nutzers STEHEN LASSEN.
 *   * **jeder andere `ApiError`** — Meldung zeigen, NICHT neu laden.
 *   * **kein `ApiError`** — das Netz ist weg. Die einzige Meldung, die der
 *     Nutzer selbst beheben kann.
 *
 * `extends Error`: Alle bestehenden `e instanceof Error ? e.message : …`
 * funktionieren unverändert weiter. Die Ansichten lassen sich deshalb
 * schrittweise umstellen, ohne dass zwischendurch etwas kaputt ist.
 */
export class ApiError extends Error {
  constructor(
    text: string,
    readonly status: number,
    /** Nur bei 409 gesetzt — vom Konfliktschutz aus `src/data/konflikt.ts`. */
    readonly konflikt?: boolean,
    readonly aktuell?: unknown,
    readonly erwarteteRev?: number,
    readonly aktuelleRev?: number,
  ) {
    super(text);
    this.name = "ApiError";
  }

  /** Hat jemand anderes in der Zwischenzeit gespeichert? */
  get istKonflikt(): boolean {
    return this.status === 409;
  }
}

export function getToken(): string | null {
  return localStorage.getItem("patio-token");
}

export function setToken(token: string): void {
  localStorage.setItem("patio-token", token);
}

export function clearToken(): void {
  localStorage.removeItem("patio-token");
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

async function retryableFetch(url: string, opts: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      // Retry nur bei 5xx oder 408/429
      if (res.status < 500 && res.status !== 408 && res.status !== 429) return res;
      if (i === tries - 1) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      if (i === tries - 1) throw err;
    }
    // Exponential backoff: 300ms, 900ms, 2700ms
    await new Promise((r) => setTimeout(r, 300 * Math.pow(3, i)));
  }
  throw lastErr;
}

async function request<T>(path: string, options: RequestInit = {}, useRetry = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = useRetry
    ? await retryableFetch(`${BASE}${path}`, { ...options, headers })
    : await fetch(`${BASE}${path}`, { ...options, headers });

  // ── 401: abgelaufene Sitzung — außer beim Anmelden selbst ────────────────
  //
  // ⚠ Der Zweig griff auch für `POST /auth/login`. Bei falschem Passwort
  // antwortet der Server mit 401; `window.location.href` ersetzte daraufhin
  // das Dokument, `LoginView` montierte frisch, und die Meldung, die es kurz
  // davor gesetzt hatte, war weg. Der Nutzer sah ein leeres Formular und
  // sonst **nichts** — genau der Zustand, den der Kommentar in `LoginView`
  // vermeiden wollte.
  //
  // Ausgenommen wird ausschließlich der Anmeldeweg, nicht `/auth/*`: Ein 401
  // auf `/auth/me` IST eine abgelaufene Sitzung und muss weiterhin zur
  // Anmeldung führen. Ein zu breiter Ausschluss verschluckte genau die
  // Abmeldung, für die es diesen Zweig gibt.
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Nicht autorisiert");
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: string;
      konflikt?: boolean;
      aktuell?: unknown;
      erwarteteRev?: number;
      aktuelleRev?: number;
    };
    throw new ApiError(
      err.error || res.statusText,
      res.status,
      err.konflikt,
      err.aktuell,
      err.erwarteteRev,
      err.aktuelleRev,
    );
  }

  // 204 hat keinen Körper — `res.json()` wirft darauf „Unexpected end of JSON
  // input". Es gibt genau zwei solche Routen, und beide werden aus der
  // Oberfläche aufgerufen: `DELETE /projects/:name` (ProjectDetailView) und
  // `DELETE /projects/:name/endgueltig` (Papierkorb). In beiden Fällen gelang
  // das Löschen, und der Nutzer bekam trotzdem eine Fehlermeldung — beim
  // Projekt blieb die Ansicht zusätzlich auf dem gelöschten Datensatz stehen.
  if (res.status === 204) return undefined as T;

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path, {}, true),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};
