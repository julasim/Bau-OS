// .env VOR der HAS_DB-Auswertung laden (skipIf ist Collection-Zeit).
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Braucht echte Postgres-DB (patio-test-db in WSL). Ohne DATABASE_URL
// (Windows-Dev) wird die Suite uebersprungen.
const HAS_DB = !!process.env.DATABASE_URL;

type App = (typeof import("../src/api/server.js"))["app"];
type GetDb = (typeof import("../src/db/client.js"))["getDb"];
type InvoiceRepo = (typeof import("../src/data/index.js"))["invoiceRepo"];
type ProjectRepo = (typeof import("../src/data/index.js"))["projectRepo"];

// Rechnungen sind geldrelevant — die ACL muss IDOR (fremde Rechnung per ID
// aendern/loeschen) verhindern. Genau das prueft diese Suite.
describe.skipIf(!HAS_DB)("API — invoices ACL-Durchsetzung (geldrelevant)", () => {
  let app: App;
  let getDb: GetDb;
  let invoiceRepo: InvoiceRepo;
  let projectRepo: ProjectRepo;
  let tokenA = "";
  let tokenB = "";
  let tokenAdmin = "";
  let invoiceId = "";
  let projectId = "";
  const suffix = Date.now();
  const uname = (r: string) => `inv-${r}-${suffix}`;
  const projName = `inv-proj-${suffix}`;
  const encName = encodeURIComponent(projName);

  beforeAll(async () => {
    ({ app } = await import("../src/api/server.js"));
    ({ getDb } = await import("../src/db/client.js"));
    ({ invoiceRepo, projectRepo } = await import("../src/data/index.js"));
    const { createDbUser, createToken } = await import("../src/api/auth.js");

    const a = await createDbUser({ username: uname("a"), password: "test-pw-123", role: "user" });
    const b = await createDbUser({ username: uname("b"), password: "test-pw-123", role: "user" });
    const admin = await createDbUser({ username: uname("admin"), password: "test-pw-123", role: "admin" });
    tokenA = createToken(a.username, a.role, a.id);
    tokenB = createToken(b.username, b.role, b.id);
    tokenAdmin = createToken(admin.username, admin.role, admin.id);

    // Projekt (nur A), Rechnung an diesem Projekt. B hat keinen Zugriff.
    await projectRepo.create(projName, {}, a.id);
    const info = await projectRepo.getInfo(projName);
    if (!info?.id) throw new Error("Projekt-Setup fehlgeschlagen");
    projectId = info.id;
    const inv = await invoiceRepo!.create(projectId, { betrag: 1000, nummer: `R-${suffix}` });
    if (typeof inv === "string") throw new Error(`invoice-Setup fehlgeschlagen: ${inv}`);
    invoiceId = inv.id;
  });

  afterAll(async () => {
    if (!getDb) return;
    const db = getDb();
    if (invoiceId) await invoiceRepo!.delete(invoiceId);
    if (projectId) await db`DELETE FROM projects WHERE id = ${projectId}`;
    await db`DELETE FROM users WHERE username LIKE ${"inv-%-" + suffix}`;
  });

  const list = (token: string) =>
    app.request(`/api/projects/${encName}/invoices`, { headers: { Authorization: `Bearer ${token}` } });

  it("Liste: fremder Non-Admin (B) → 403", async () => {
    expect((await list(tokenB)).status).toBe(403);
  });

  it("Liste: Ersteller (A) → 200", async () => {
    expect((await list(tokenA)).status).toBe(200);
  });

  it("Liste: Admin → 200", async () => {
    expect((await list(tokenAdmin)).status).toBe(200);
  });

  it("PUT fremde Rechnung durch B → 403 (IDOR-Schutz)", async () => {
    const res = await app.request(`/api/invoices/${invoiceId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ betrag: 9999 }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE fremde Rechnung durch B → 403 (IDOR-Schutz)", async () => {
    const res = await app.request(`/api/invoices/${invoiceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(403);
  });

  it("PUT eigene Rechnung durch A → 200", async () => {
    const res = await app.request(`/api/invoices/${invoiceId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" },
      body: JSON.stringify({ betrag: 1500 }),
    });
    expect(res.status).toBe(200);
  });

  it("ohne Token → 401", async () => {
    expect((await app.request(`/api/projects/${encName}/invoices`)).status).toBe(401);
  });
});
