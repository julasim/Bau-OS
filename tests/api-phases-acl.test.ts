import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Type-Query fuers entity-spezifische Setup (kein Laufzeit-`any`).
type PhaseRepo = (typeof import("../src/data/index.js"))["phaseRepo"];

// Leistungsphasen tragen Honorar-Anteile (feeShare) und speisen das
// Finanz-Aggregat (/finance: Soll-Honorar, Deckungsbeitrag). Die ACL muss
// project-scoped Zugriff und IDOR (fremde Phase per ID aendern/loeschen)
// verhindern.
describe.skipIf(!HAS_DB)("API — phases ACL-Durchsetzung (honorarrelevant)", () => {
  let fx: AclFixture;
  let phaseRepo: PhaseRepo;
  let phaseId = "";
  let bPhaseId = ""; // B's EIGENE Phase an B's Projekt (fuer Confinement)
  let encName = "";
  let encBName = "";

  beforeAll(async () => {
    // Beide Konten bekommen das Geld-Recht: diese Suite misst die PROJEKT-Rechte,
    // nicht das Geld-Recht (das hat eine eigene Suite). Ohne diese Zeile
    // scheiterte sie am falschen Grund.
    fx = await setupAclFixture("phase", { geldRecht: true });
    ({ phaseRepo } = await import("../src/data/index.js"));
    encName = encodeURIComponent(fx.projectName);
    encBName = encodeURIComponent(fx.projectBName);
    const phase = await phaseRepo!.create(fx.projectId, { name: "LP2 Vorentwurf", feeShare: 7 });
    if (typeof phase === "string") throw new Error(`phase-Setup fehlgeschlagen: ${phase}`);
    phaseId = phase.id;
    // B legt eine EIGENE Phase an SEINEM Projekt an (cascadet beim Projekt-
    // Cleanup weg, project_id NOT NULL ON DELETE CASCADE).
    const bPhase = await phaseRepo!.create(fx.projectBId, { name: "LP1 Grundlagen", feeShare: 3 });
    if (typeof bPhase === "string") throw new Error(`B-phase-Setup fehlgeschlagen: ${bPhase}`);
    bPhaseId = bPhase.id;
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  const list = (token: string) => fx.app.request(`/api/projects/${encName}/phases`, { headers: authHeader(token) });
  const finance = (token: string) => fx.app.request(`/api/projects/${encName}/finance`, { headers: authHeader(token) });

  it("Liste: fremder Non-Admin (B) → 403", async () => {
    expect((await list(fx.b.token)).status).toBe(403);
  });

  it("Liste: Ersteller (A) → 200", async () => {
    expect((await list(fx.a.token)).status).toBe(200);
  });

  it("Liste: Admin → 200", async () => {
    expect((await list(fx.admin.token)).status).toBe(200);
  });

  it("Finanz-Aggregat: fremder Non-Admin (B) → 403 (Honorardaten geschuetzt)", async () => {
    expect((await finance(fx.b.token)).status).toBe(403);
  });

  it("Finanz-Aggregat: Ersteller (A) → 200", async () => {
    expect((await finance(fx.a.token)).status).toBe(200);
  });

  it("PUT fremde Phase durch B → 403 (IDOR-Schutz)", async () => {
    const res = await fx.app.request(`/api/phases/${phaseId}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ name: "gehackt", feeShare: 99 }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE fremde Phase durch B → 403 (IDOR-Schutz)", async () => {
    const res = await fx.app.request(`/api/phases/${phaseId}`, {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);
  });

  it("PUT eigene Phase durch A → 200", async () => {
    const res = await fx.app.request(`/api/phases/${phaseId}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: "LP2 Vorentwurf (überarbeitet)", feeShare: 8 }),
    });
    expect(res.status).toBe(200);
  });

  it("ohne Token → 401", async () => {
    expect((await fx.app.request(`/api/projects/${encName}/phases`)).status).toBe(401);
  });

  // ── Confinement (IDOR-Kern) ─────────────────────────────────────────────
  // B ist teil-berechtigt (sieht sein Projekt). Er darf seine EIGENE Phase
  // aendern und sein Projekt listen, aber A's Phase bleibt gesperrt. Ein
  // pauschaler ACL-Check faellt hier durch: "alles verweigern" laesst 200
  // scheitern, "hat irgendein Projekt -> darf alles" laesst A's PUT auf 200
  // durchgehen (siehe bestehender 403-Test).
  it("Confinement: B listet EIGENES Projekt (projectBName) → 200", async () => {
    const res = await fx.app.request(`/api/projects/${encBName}/phases`, { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(200);
  });

  it("Confinement: B aendert EIGENE Phase (PUT) → 200", async () => {
    const res = await fx.app.request(`/api/phases/${bPhaseId}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ name: "LP1 Grundlagen (überarbeitet)", feeShare: 4 }),
    });
    expect(res.status).toBe(200);
  });

  it("Confinement: B aendert A's Phase (PUT) → 403 (fremde Ressource gesperrt)", async () => {
    const res = await fx.app.request(`/api/phases/${phaseId}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ name: "gehackt", feeShare: 99 }),
    });
    expect(res.status).toBe(403);
  });
});
