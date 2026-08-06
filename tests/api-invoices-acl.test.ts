import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Type-Query fuers entity-spezifische Setup (kein Laufzeit-`any`).
type InvoiceRepo = (typeof import("../src/data/index.js"))["invoiceRepo"];

// Rechnungen sind geldrelevant — die ACL muss IDOR (fremde Rechnung per ID
// aendern/loeschen) verhindern. Genau das prueft diese Suite.
describe.skipIf(!HAS_DB)("API — invoices ACL-Durchsetzung (geldrelevant)", () => {
  let fx: AclFixture;
  let invoiceRepo: InvoiceRepo;
  let invoiceId = "";
  let bInvoiceId = ""; // B's EIGENE Rechnung an B's Projekt (fuer Confinement)
  let encName = "";
  let encBName = "";

  beforeAll(async () => {
    // Beide Konten bekommen das Geld-Recht: diese Suite misst die PROJEKT-Rechte,
    // nicht das Geld-Recht (das hat eine eigene Suite). Ohne diese Zeile
    // scheiterte sie am falschen Grund.
    fx = await setupAclFixture("inv", { geldRecht: true });
    ({ invoiceRepo } = await import("../src/data/index.js"));
    encName = encodeURIComponent(fx.projectName);
    encBName = encodeURIComponent(fx.projectBName);
    const inv = await invoiceRepo!.create(fx.projectId, { betrag: 1000, nummer: `R-${Date.now()}` });
    if (typeof inv === "string") throw new Error(`invoice-Setup fehlgeschlagen: ${inv}`);
    invoiceId = inv.id;
    // B legt eine EIGENE Rechnung an SEINEM Projekt an (cascadet beim Projekt-
    // Cleanup weg, project_id NOT NULL ON DELETE CASCADE).
    const bInv = await invoiceRepo!.create(fx.projectBId, { betrag: 500, nummer: `R-B-${Date.now()}` });
    if (typeof bInv === "string") throw new Error(`B-invoice-Setup fehlgeschlagen: ${bInv}`);
    bInvoiceId = bInv.id;
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  const list = (token: string) => fx.app.request(`/api/projects/${encName}/invoices`, { headers: authHeader(token) });

  it("Liste: fremder Non-Admin (B) → 403", async () => {
    expect((await list(fx.b.token)).status).toBe(403);
  });

  it("Liste: Ersteller (A) → 200", async () => {
    expect((await list(fx.a.token)).status).toBe(200);
  });

  it("Liste: Admin → 200", async () => {
    expect((await list(fx.admin.token)).status).toBe(200);
  });

  it("PUT fremde Rechnung durch B → 403 (IDOR-Schutz)", async () => {
    const res = await fx.app.request(`/api/invoices/${invoiceId}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ betrag: 9999 }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE fremde Rechnung durch B → 403 (IDOR-Schutz)", async () => {
    const res = await fx.app.request(`/api/invoices/${invoiceId}`, {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);
  });

  it("PUT eigene Rechnung durch A → 200", async () => {
    const res = await fx.app.request(`/api/invoices/${invoiceId}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ betrag: 1500 }),
    });
    expect(res.status).toBe(200);
  });

  it("ohne Token → 401", async () => {
    expect((await fx.app.request(`/api/projects/${encName}/invoices`)).status).toBe(401);
  });

  // ── Confinement (IDOR-Kern) ─────────────────────────────────────────────
  // B ist teil-berechtigt (sieht sein Projekt). Er darf seine EIGENE Rechnung
  // aendern und sein Projekt listen, aber A's Rechnung bleibt gesperrt. Ein
  // pauschaler ACL-Check faellt hier durch: "alles verweigern" laesst 200
  // scheitern, "hat irgendein Projekt -> darf alles" laesst A's PUT auf 200
  // durchgehen (siehe bestehender 403-Test).
  it("Confinement: B listet EIGENES Projekt (projectBName) → 200", async () => {
    const own = await fx.app.request(`/api/projects/${encBName}/invoices`, { headers: authHeader(fx.b.token) });
    expect(own.status).toBe(200);
  });

  it("Confinement: B aendert EIGENE Rechnung (PUT) → 200", async () => {
    const res = await fx.app.request(`/api/invoices/${bInvoiceId}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ betrag: 750 }),
    });
    expect(res.status).toBe(200);
  });

  it("Confinement: B aendert A's Rechnung (PUT) → 403 (fremde Ressource gesperrt)", async () => {
    const res = await fx.app.request(`/api/invoices/${invoiceId}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ betrag: 9999 }),
    });
    expect(res.status).toBe(403);
  });
});
