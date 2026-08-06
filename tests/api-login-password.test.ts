import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB } from "./helpers/acl-fixture.js";

// Der Passwort-Login — seit dem Umbau zum Firmenserver der EINZIGE Weg hinein.
//
// Warum diese Tests: bis zum Umbau verzweigte `POST /api/auth/login` jeden
// Datenbank-Benutzer in den Email-Pfad (`server.ts`, alter Block ab Z. 350).
// Wer eine Adresse hinterlegt hatte, bekam einen 6-stelligen Code per SMTP —
// auf einem Server ohne Internet scheiterte der Versand und die Route
// antwortete mit 502. Wer keine hatte, landete im erzwungenen
// Email-Einrichtungs-Fluss, der ebenfalls SMTP braucht. Ergebnis: auf dem
// Zielsystem kam **niemand** hinein ausser ueber das einstufige
// Legacy-JSON-Konto.
//
// Diese Datei haelt beides fest: dass die Anmeldung mit Passwort funktioniert
// UND dass die sieben ausgebauten Email-Routen nicht zurueckkommen. Der zweite
// Teil ist der wichtigere — eine wieder eingehaengte Route waere auf dem
// Firmenserver eine Sackgasse, die erst im Betrieb auffiele.
describe.skipIf(!HAS_DB)("API — Anmeldung mit Passwort", () => {
  let app: (typeof import("../src/api/server.js"))["app"];
  let username: string;
  const password = "richtiges-Passwort-123";
  let userId: string;

  beforeAll(async () => {
    ({ app } = await import("../src/api/server.js"));
    const { createDbUser } = await import("../src/api/auth.js");
    username = `pwlogin-${Date.now()}`;
    const u = await createDbUser({ username, password, role: "user" });
    userId = u.id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    await db`DELETE FROM audit_log WHERE actor_username LIKE 'pwlogin-%'`;
    await db`DELETE FROM users WHERE username LIKE 'pwlogin-%'`;
  });

  async function login(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* kein JSON */
    }
    return { status: res.status, json };
  }

  // ── Der gute Fall ────────────────────────────────────────────────────────

  it("richtiges Passwort liefert sofort ein Token — kein zweiter Schritt", async () => {
    const { status, json } = await login({ username, password });
    expect(status).toBe(200);
    expect(typeof json.token).toBe("string");
    expect(json.username).toBe(username);
    // Entscheidend: KEIN Zwischenschritt. Genau diese beiden Felder haben den
    // Client frueher in den Email-Fluss geschickt.
    expect(json.requires2fa).toBeUndefined();
    expect(json.requiresEmailSetup).toBeUndefined();
  });

  it("das Token traegt und oeffnet eine geschuetzte Route", async () => {
    const { json } = await login({ username, password });
    const res = await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${json.token as string}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { username: string }).username).toBe(username);
  });

  it("eine hinterlegte Email aendert am Ablauf nichts", async () => {
    // Der alte Zweig haing GENAU hieran: users.email gesetzt → Mailversand.
    const { updateDbUser } = await import("../src/api/auth.js");
    await updateDbUser(userId, { email: `${username}@example.invalid` });
    const { status, json } = await login({ username, password });
    expect(status).toBe(200);
    expect(typeof json.token).toBe("string");
    expect(json.requires2fa).toBeUndefined();
  });

  // ── Die schlechten Faelle ────────────────────────────────────────────────

  it("falsches Passwort → 401, ohne Hinweis auf die Ursache", async () => {
    const { status, json } = await login({ username, password: "falsch-aber-lang-genug" });
    expect(status).toBe(401);
    // Kein Benutzernamen-Orakel: dieselbe Meldung wie bei unbekanntem Konto.
    expect(String(json.error)).toBe("Benutzername oder Passwort falsch");
    expect(json.token).toBeUndefined();
  });

  it("unbekannter Benutzer → dieselbe 401-Meldung", async () => {
    const { status, json } = await login({ username: "gibtsnicht-xyz", password });
    expect(status).toBe(401);
    expect(String(json.error)).toBe("Benutzername oder Passwort falsch");
  });

  it("fehlende Angaben → 400", async () => {
    expect((await login({ username })).status).toBe(400);
    expect((await login({ password })).status).toBe(400);
  });

  // ── Die ausgebauten Routen bleiben ausgebaut ─────────────────────────────

  it.each([
    ["POST", "/api/auth/login/2fa"],
    ["POST", "/api/auth/setup-email/start"],
    ["POST", "/api/auth/setup-email/verify"],
    ["POST", "/api/auth/login/magic-link/start"],
    ["GET", "/api/auth/login/magic-link/consume?token=x"],
    ["POST", "/api/auth/forgot-password"],
    ["POST", "/api/auth/reset-password"],
    ["POST", "/api/settings/email/change/start"],
    ["POST", "/api/settings/email/change/verify"],
  ])("%s %s existiert nicht mehr", async (method, pfad) => {
    const res = await app.request(pfad, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    // 404 = Route weg. 401 waere ebenfalls in Ordnung (die settings-Routen
    // liegen hinter der Auth-Middleware), aber niemals 200/400/502 — das
    // hiesse, die Route ist noch da und verarbeitet den Aufruf.
    expect([401, 404]).toContain(res.status);
  });

  it("im Quellbaum kommt nodemailer nicht mehr vor", async () => {
    const fs = await import("node:fs");
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("nodemailer");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("@types/nodemailer");
    expect(fs.existsSync(new URL("../src/api/email.ts", import.meta.url))).toBe(false);
    expect(fs.existsSync(new URL("../src/api/email-template.ts", import.meta.url))).toBe(false);
  });
});

// Die Passwort-Regeln gelten an allen drei Stellen, an denen ein Passwort
// gesetzt wird. Vorher stand die 8 viermal einzeln im Code; eine Anhebung
// haette man dabei leicht an einer Stelle vergessen.
describe("Passwort-Regeln", () => {
  it("Mindestlaenge ist zentral definiert und mindestens 12", async () => {
    const { PASSWORD_MIN_LENGTH } = await import("../src/config.js");
    expect(PASSWORD_MIN_LENGTH).toBeGreaterThanOrEqual(12);
  });

  it("bcrypt-Kostenfaktor ist mindestens 12", async () => {
    const { BCRYPT_ROUNDS } = await import("../src/config.js");
    expect(BCRYPT_ROUNDS).toBeGreaterThanOrEqual(12);
  });

  it("hashPassword nutzt den konfigurierten Kostenfaktor", async () => {
    const { hashPassword } = await import("../src/api/auth.js");
    const { BCRYPT_ROUNDS } = await import("../src/config.js");
    const hash = await hashPassword("irgendein-langes-Passwort");
    // bcrypt-Hash: $2b$<kosten>$<salt+hash>
    expect(hash.split("$")[2]).toBe(String(BCRYPT_ROUNDS).padStart(2, "0"));
  });

  it("alte Hashes mit niedrigerem Kostenfaktor bleiben gueltig", async () => {
    // Sonst waere jedes bestehende Konto beim Anheben ausgesperrt gewesen.
    const bcrypt = (await import("bcrypt")).default;
    const { verifyPassword } = await import("../src/api/auth.js");
    const alt = await bcrypt.hash("altes-Passwort-123", 10);
    expect(await verifyPassword("altes-Passwort-123", alt)).toBe(true);
  });
});
