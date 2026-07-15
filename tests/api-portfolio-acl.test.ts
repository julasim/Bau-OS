import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Das Portfolio-Cockpit aggregiert projektuebergreifend. Es darf KEINE
// Projekte zeigen, die der User nicht sehen darf (getVisibleProjectIds) —
// sonst leakt es fremde Projektnamen/Budgets/Fristen. Kein 403, sondern
// Filterung: das fremde Projekt taucht in der Liste gar nicht erst auf.
describe.skipIf(!HAS_DB)("API — portfolio Sichtbarkeitsfilter", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("port");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  const portfolio = (token: string) => fx.app.request("/api/portfolio", { headers: authHeader(token) });
  const hasProject = async (res: Response) => {
    const rows = (await res.json()) as Array<{ projectId: string }>;
    return rows.some((r) => r.projectId === fx.projectId);
  };

  it("Fremder (B): Status 200, aber A's Projekt NICHT in der Liste (kein Leak)", async () => {
    const res = await portfolio(fx.b.token);
    expect(res.status).toBe(200);
    expect(await hasProject(res)).toBe(false);
  });

  it("Ersteller (A): Projekt IST in der Liste", async () => {
    const res = await portfolio(fx.a.token);
    expect(res.status).toBe(200);
    expect(await hasProject(res)).toBe(true);
  });

  it("Admin: sieht das Projekt ebenfalls (Scope 'all')", async () => {
    const res = await portfolio(fx.admin.token);
    expect(res.status).toBe(200);
    expect(await hasProject(res)).toBe(true);
  });

  it("ohne Token → 401", async () => {
    expect((await fx.app.request("/api/portfolio")).status).toBe(401);
  });
});
