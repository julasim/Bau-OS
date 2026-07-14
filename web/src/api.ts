const BASE = "/api";

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

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Nicht autorisiert");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

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
