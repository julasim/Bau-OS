import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Routen mit festem Namen müssen VOR der Platzhalter-Route stehen.
//
// ── Warum das eine eigene Prüfung wert ist ─────────────────────────────────
//
// Hono trifft in Registrierungsreihenfolge. Steht `GET /meetings/:id` vor
// `GET /meetings/recent`, dann landet jeder Aufruf von `/meetings/recent` bei
// `:id`, das Repository sucht eine Besprechung mit der ID „recent" und die
// Antwort ist ein 404.
//
// Genau das war der Fall — die Route war seit ihrem Bau unerreichbar. Der
// Fehler ist von aussen nicht von „gibt es nicht" zu unterscheiden, und im
// Log steht nichts.
//
// In `projects.ts:207` steht die Falle ausdrücklich kommentiert („MUSS vor
// /projects/:name stehen") und wurde bei den Besprechungen trotzdem gemacht.
// Deshalb hier eine Prüfung, die beim nächsten Mal zuschlägt.
describe.skipIf(!HAS_DB)("Routen-Reihenfolge: /recent vor /:id", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("routen");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await fx.cleanup();
  });

  const WEGE = ["/api/meetings/recent", "/api/bautagebuch/recent", "/api/entscheidungen/recent", "/api/files/recent"];

  it.each(WEGE)("%s liefert eine Liste, keinen 404", async (weg) => {
    const res = await fx.app.request(weg, { headers: authHeader(fx.admin.token) });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
