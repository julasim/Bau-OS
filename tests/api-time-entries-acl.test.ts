import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Type-Query fuers entity-spezifische Setup (kein Laufzeit-`any`).
type TimeEntryRepo = (typeof import("../src/data/index.js"))["timeEntryRepo"];

// Hinweis SEC-2: Der Audit beschrieb einen IDOR ueber ein *geloeschtes* Projekt
// (verwaister Eintrag, projectName NULL). Das ist real NICHT erzeugbar —
// `time_entries.project_id` ist `NOT NULL ... ON DELETE CASCADE`, ein
// geloeschtes Projekt cascadet den Eintrag weg. Der reale ACL-Schutz laeuft
// ueber `canSeeProjectByName`; genau den deckt diese Suite ab. Der
// Owner-Fallback im Handler bleibt als defensive Massnahme bestehen.
describe.skipIf(!HAS_DB)("API — time-entries ACL-Durchsetzung", () => {
  let fx: AclFixture;
  let timeEntryRepo: TimeEntryRepo;
  let entryId = "";

  beforeAll(async () => {
    fx = await setupAclFixture("sec2");
    ({ timeEntryRepo } = await import("../src/data/index.js"));
    const entry = await timeEntryRepo!.create(fx.projectId, { date: "2026-07-15", hours: 2 }, fx.a.id);
    if (typeof entry === "string") throw new Error(`time-entry-Setup fehlgeschlagen: ${entry}`);
    entryId = entry.id;
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  const getEntry = (token: string) => fx.app.request(`/api/time-entries/${entryId}`, { headers: authHeader(token) });

  it("fremder Non-Admin (B, kein Projektzugriff) → 403", async () => {
    expect((await getEntry(fx.b.token)).status).toBe(403);
  });

  it("Ersteller (A) → 200", async () => {
    expect((await getEntry(fx.a.token)).status).toBe(200);
  });

  it("Admin → 200", async () => {
    expect((await getEntry(fx.admin.token)).status).toBe(200);
  });

  it("PATCH durch fremden Non-Admin (B) → 403", async () => {
    const res = await fx.app.request(`/api/time-entries/${entryId}`, {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ hours: 5 }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE durch fremden Non-Admin (B) → 403", async () => {
    const res = await fx.app.request(`/api/time-entries/${entryId}`, {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);
  });

  it("ohne Token → 401", async () => {
    expect((await fx.app.request(`/api/time-entries/${entryId}`)).status).toBe(401);
  });
});
