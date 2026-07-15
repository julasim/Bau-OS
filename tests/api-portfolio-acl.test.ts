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

  // ── Confinement (echter ANY-Filter, kein Leer-Short-Circuit) ────────────
  // B ist teil-berechtigt: sein Projekt (projectBId) MUSS in der Liste sein,
  // A's Projekt (projectId) darf NICHT. Damit greift real der
  // `id = ANY(visibleProjectIds)`-Filter — anders als beim frueheren Setup,
  // wo B leere Sichtbarkeit hatte und die Liste per Short-Circuit []-blieb.
  // Ein kaputter Filter "alle sichtbar" wuerde A's Projekt hier durchlassen.
  it("Confinement: B sieht EIGENES Projekt, NICHT A's (echter ANY-Filter)", async () => {
    const res = await portfolio(fx.b.token);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ projectId: string }>;
    const ids = rows.map((r) => r.projectId);
    expect(ids).toContain(fx.projectBId); // B's eigenes Projekt ist drin
    expect(ids).not.toContain(fx.projectId); // A's Projekt ist NICHT drin
  });
});
