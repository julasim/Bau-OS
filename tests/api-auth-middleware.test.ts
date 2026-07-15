import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Prueft die zentrale authMiddleware/adminMiddleware-Kette (INF-6):
// Token-Praesenz, Token-Gueltigkeit, den aud-Guard gegen Ticket-Tokens und
// den DB-Rollen-Vorrang — ein altes Admin-JWT verliert nach Downgrade den
// Admin-Zugriff (server.ts: Rolle wird pro Request frisch aus der DB geladen).
describe.skipIf(!HAS_DB)("API — Auth-/Admin-Middleware", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("authmw");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  // ── authMiddleware: Token-Praesenz & -Gueltigkeit ───────────────────────────
  it("geschuetzte Route ohne Token → 401", async () => {
    expect((await fx.app.request("/api/auth/me")).status).toBe(401);
  });

  it("geschuetzte Route mit Muell-Token → 401", async () => {
    const res = await fx.app.request("/api/auth/me", { headers: authHeader("nicht.ein.jwt") });
    expect(res.status).toBe(401);
  });

  it("geschuetzte Route mit gueltigem Token → 200 + korrektes Profil", async () => {
    const res = await fx.app.request("/api/auth/me", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; role: string };
    expect(body.username).toBe(fx.a.username);
    expect(body.role).toBe("user");
  });

  it("Health-Endpoint ist public (ohne Token → 200)", async () => {
    expect((await fx.app.request("/api/health")).status).toBe(200);
  });

  // ── aud-Guard: Ticket-Token darf keine API-Autorisierung geben ──────────────
  it("2FA-Ticket (aud=2fa) als Bearer → 401 (kein regulaeres Auth-Token)", async () => {
    const { findDbUserById, create2faTicket } = await import("../src/api/auth.js");
    const dbUser = await findDbUserById(fx.a.id);
    if (!dbUser) throw new Error("DB-User A nicht gefunden");
    const ticket = create2faTicket(dbUser);
    const res = await fx.app.request("/api/auth/me", { headers: authHeader(ticket) });
    expect(res.status).toBe(401);
  });

  // ── adminMiddleware + DB-Rollen-Vorrang ─────────────────────────────────────
  it("Admin-Route als normaler User → 403", async () => {
    const res = await fx.app.request("/api/admin/users", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(403);
  });

  it("Admin-Route als Admin → 200", async () => {
    const res = await fx.app.request("/api/admin/users", { headers: authHeader(fx.admin.token) });
    expect(res.status).toBe(200);
  });

  it("gefaelschtes Admin-JWT fuer DB-user → 403 (DB-Rolle schlaegt JWT-Rolle)", async () => {
    const { createToken } = await import("../src/api/auth.js");
    // Das JWT behauptet role=admin, der DB-User B ist aber 'user'. Die
    // Middleware laedt die Rolle bei jedem Request frisch aus der DB — das
    // gefaelschte (oder nach Downgrade veraltete) Token darf KEINEN
    // Admin-Zugriff geben.
    const staleAdmin = createToken(fx.b.username, "admin", fx.b.id);
    const res = await fx.app.request("/api/admin/users", { headers: authHeader(staleAdmin) });
    expect(res.status).toBe(403);
  });
});
