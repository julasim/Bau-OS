import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, type AclFixture } from "./helpers/acl-fixture.js";

// TEST-3 (Verifikation): Der Audit vermutete, das Login-Rate-Limit vermenge
// 429 (rate-limited) mit 401 (falsches Passwort). Dieser kontrollierte Test
// gegen die echte Login-Route beweist das Gegenteil: bei wiederholt falschem
// Passwort kommt erst 401, und ab dem Limit sauber 429 — kein Fix noetig.
//
// app.request() liefert keine echte IP → getClientIp() = "unknown"; alle
// Requests teilen denselben Bucket, wie es der Test braucht.
describe.skipIf(!HAS_DB)("API — Login Rate-Limit trennt 429 von 401", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("rl");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  it("falsches Passwort: erst 401, ab dem Limit 429", async () => {
    const { RATE_LIMIT_ATTEMPTS } = await import("../src/config.js");
    const login = (pw: string) =>
      fx.app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: fx.a.username, password: pw }),
      });

    const statuses: number[] = [];
    // Genug Versuche, um das Limit sicher zu ueberschreiten.
    for (let i = 0; i < RATE_LIMIT_ATTEMPTS + 2; i++) {
      statuses.push((await login("FALSCH-" + i)).status);
    }

    // Erster Versuch: reiner Auth-Fehler.
    expect(statuses[0]).toBe(401);
    // Letzter Versuch: rate-limited.
    expect(statuses.at(-1)).toBe(429);
    // Sauberer Uebergang: ausschliesslich 401 oder 429, beide kommen vor.
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    // Die 401 kommen VOR den 429 (kein Vermengen): kein 401 nach dem ersten 429.
    const first429 = statuses.indexOf(429);
    expect(statuses.slice(first429).every((s) => s === 429)).toBe(true);
  });
});
