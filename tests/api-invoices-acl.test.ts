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
  let encName = "";

  beforeAll(async () => {
    fx = await setupAclFixture("inv");
    ({ invoiceRepo } = await import("../src/data/index.js"));
    encName = encodeURIComponent(fx.projectName);
    const inv = await invoiceRepo!.create(fx.projectId, { betrag: 1000, nummer: `R-${Date.now()}` });
    if (typeof inv === "string") throw new Error(`invoice-Setup fehlgeschlagen: ${inv}`);
    invoiceId = inv.id;
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
});
