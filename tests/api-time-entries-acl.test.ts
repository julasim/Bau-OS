// .env VOR der HAS_DB-Auswertung laden (skipIf wird zur Collection-Zeit
// ausgewertet, bevor config.ts spaeter dotenv importiert).
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Diese Suite braucht eine echte Postgres-DB (patio-test-db in WSL). Ohne
// DATABASE_URL (z.B. Windows-Dev-Rechner) wird sie sauber uebersprungen.
const HAS_DB = !!process.env.DATABASE_URL;

// Type-Queries statt any: exakte Modul-Typen ohne Laufzeit-Import.
type App = (typeof import("../src/api/server.js"))["app"];
type GetDb = (typeof import("../src/db/client.js"))["getDb"];
type TimeEntryRepo = (typeof import("../src/data/index.js"))["timeEntryRepo"];
type ProjectRepo = (typeof import("../src/data/index.js"))["projectRepo"];

// Hinweis SEC-2: Der Audit beschrieb einen IDOR ueber ein *geloeschtes* Projekt
// (verwaister Eintrag, projectName NULL). Das ist real NICHT erzeugbar —
// `time_entries.project_id` ist `NOT NULL ... ON DELETE CASCADE`, ein
// geloeschtes Projekt cascadet den Eintrag weg. Der reale ACL-Schutz laeuft
// ueber `canSeeProjectByName`; genau den deckt diese Suite ab. Der
// Owner-Fallback im Handler bleibt als defensive Massnahme bestehen.
describe.skipIf(!HAS_DB)("API — time-entries ACL-Durchsetzung", () => {
  let app: App;
  let getDb: GetDb;
  let timeEntryRepo: TimeEntryRepo;
  let projectRepo: ProjectRepo;
  let tokenA = "";
  let tokenB = "";
  let tokenAdmin = "";
  let entryId = "";
  let projectId = "";
  const suffix = Date.now();
  const uname = (r: string) => `sec2-${r}-${suffix}`;
  const projName = `sec2-proj-${suffix}`;

  beforeAll(async () => {
    ({ app } = await import("../src/api/server.js"));
    ({ getDb } = await import("../src/db/client.js"));
    ({ timeEntryRepo, projectRepo } = await import("../src/data/index.js"));
    const { createDbUser, createToken } = await import("../src/api/auth.js");

    // Ersteller A, Fremder B (kein Projektzugriff), Admin.
    const a = await createDbUser({ username: uname("a"), password: "test-pw-123", role: "user" });
    const b = await createDbUser({ username: uname("b"), password: "test-pw-123", role: "user" });
    const admin = await createDbUser({ username: uname("admin"), password: "test-pw-123", role: "admin" });
    tokenA = createToken(a.username, a.role, a.id);
    tokenB = createToken(b.username, b.role, b.id);
    tokenAdmin = createToken(admin.username, admin.role, admin.id);

    // Projekt (nur A zugewiesen via createdById), time-entry von A. Projekt
    // bleibt bestehen — B darf es per ACL nicht sehen.
    await projectRepo.create(projName, {}, a.id);
    const info = await projectRepo.getInfo(projName);
    if (!info?.id) throw new Error("Projekt-Setup fehlgeschlagen");
    projectId = info.id;
    const entry = await timeEntryRepo!.create(projectId, { date: "2026-07-15", hours: 2 }, a.id);
    if (typeof entry === "string") throw new Error(`time-entry-Setup fehlgeschlagen: ${entry}`);
    entryId = entry.id;
  });

  afterAll(async () => {
    if (!getDb) return;
    const db = getDb();
    if (entryId) await timeEntryRepo!.delete(entryId);
    if (projectId) await db`DELETE FROM projects WHERE id = ${projectId}`;
    await db`DELETE FROM users WHERE username LIKE ${"sec2-%-" + suffix}`;
  });

  const getEntry = (token: string) =>
    app.request(`/api/time-entries/${entryId}`, { headers: { Authorization: `Bearer ${token}` } });

  it("fremder Non-Admin (B, kein Projektzugriff) → 403", async () => {
    expect((await getEntry(tokenB)).status).toBe(403);
  });

  it("Ersteller (A) → 200", async () => {
    expect((await getEntry(tokenA)).status).toBe(200);
  });

  it("Admin → 200", async () => {
    expect((await getEntry(tokenAdmin)).status).toBe(200);
  });

  it("PATCH durch fremden Non-Admin (B) → 403", async () => {
    const res = await app.request(`/api/time-entries/${entryId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 5 }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE durch fremden Non-Admin (B) → 403", async () => {
    const res = await app.request(`/api/time-entries/${entryId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(403);
  });

  it("ohne Token → 401", async () => {
    expect((await app.request(`/api/time-entries/${entryId}`)).status).toBe(401);
  });
});
