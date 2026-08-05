import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die Admin-Guards in admin-users.ts deckten nur /admin/users und
// /admin/users/* ab. GET /admin/audit lag daneben und war damit fuer JEDEN
// angemeldeten Nutzer lesbar — Login-Versuche, 2FA-Events, Passwort-Resets
// und IP-Adressen aller Konten. Der Guard muss das gesamte /admin-Prefix
// abdecken, ohne die absichtlich offene Route /users/mini mitzusperren.
describe.skipIf(!HAS_DB)("API — Admin-Guard deckt alle /admin-Routen", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("audit");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  const get = (path: string, token?: string) =>
    fx.app.request(path, token ? { headers: authHeader(token) } : undefined);

  // ── Der eigentliche Befund ───────────────────────────────────────────────
  it("Audit-Log: Non-Admin (B) → 403", async () => {
    expect((await get("/api/admin/audit", fx.b.token)).status).toBe(403);
  });

  it("Audit-Log: Non-Admin mit Filter-Parametern → ebenfalls 403", async () => {
    // Der Guard darf nicht an der Query-String haengen.
    expect((await get("/api/admin/audit?limit=5&eventPrefix=login", fx.b.token)).status).toBe(403);
  });

  it("Audit-Log: Admin → 200 mit Liste", async () => {
    const res = await get("/api/admin/audit?limit=5", fx.admin.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("Audit-Log: ohne Token → 401", async () => {
    expect((await get("/api/admin/audit")).status).toBe(401);
  });

  // ── Regressionsschutz: der breitere Guard darf nichts kaputt machen ──────
  it("Nutzerliste: Non-Admin → 403, Admin → 200 (unveraendert)", async () => {
    expect((await get("/api/admin/users", fx.b.token)).status).toBe(403);
    expect((await get("/api/admin/users", fx.admin.token)).status).toBe(200);
  });

  it("Verschachtelte Admin-Route (/admin/users/:id/password): Non-Admin → 403", async () => {
    // Prueft, dass das Prefix-Wildcard auch mehrere Pfadsegmente deckt.
    const res = await fx.app.request(`/api/admin/users/${fx.a.id}/password`, {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ newPassword: "uebernommen-123" }),
    });
    expect(res.status).toBe(403);
  });

  it("/users/mini bleibt fuer Non-Admins offen (absichtlich, kein /admin-Prefix)", async () => {
    const res = await get("/api/users/mini", fx.b.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
