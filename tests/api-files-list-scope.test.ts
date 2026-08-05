import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Type-Query fuers entity-spezifische Setup (kein Laufzeit-`any`).
type FileRepo = (typeof import("../src/data/index.js"))["fileRepo"];
type FileRow = { id: string; name: string; project: string | null };

// Beim Absichern von /files/search ist aufgefallen, dass die Schwestermethode
// dbFiles.list() denselben Cast-Fehler hat, vor dem CLAUDE.md warnt:
// `project_id` ist uuid, die Scope-IDs kommen als JS-Strings — ohne ::uuid[]
// wirft Postgres "operator does not exist: uuid = text" und GET /api/files
// endet in einem 500.
//
// Der Fehler blieb unbemerkt, weil er NUR Non-Admins mit einem NICHT-leeren
// Scope trifft: bei leerem Scope greift der Short-Circuit (return []) und die
// Query laeuft nie. Genau diese Luecke schliesst dieser Test — B ist
// teil-berechtigt und faellt damit in den Query-Pfad.
describe.skipIf(!HAS_DB)("API — files Liste mit nicht-leerem Scope", () => {
  let fx: AclFixture;
  let fileRepo: FileRepo;
  let aFileId = "";
  let bFileId = "";
  const tag = Date.now();
  const aName = `list-a-${tag}.txt`;
  const bName = `list-b-${tag}.txt`;

  beforeAll(async () => {
    fx = await setupAclFixture("flist");
    ({ fileRepo } = await import("../src/data/index.js"));
    aFileId = (
      await fileRepo.save({
        filename: aName,
        filepath: aName,
        filesize: 5,
        project: fx.projectName,
        uploadedById: fx.a.id,
      })
    ).id;
    bFileId = (
      await fileRepo.save({
        filename: bName,
        filepath: bName,
        filesize: 5,
        project: fx.projectBName,
        uploadedById: fx.b.id,
      })
    ).id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    // files.project_id ist ON DELETE SET NULL → explizit aufraeumen.
    for (const id of [aFileId, bFileId]) if (id) await fileRepo.delete(id);
    await fx.cleanup();
  });

  const list = (token: string) => fx.app.request("/api/files", { headers: authHeader(token) });

  it("Non-Admin mit nicht-leerem Scope bekommt 200 statt 500", async () => {
    const res = await list(fx.b.token);
    expect(res.status).toBe(200);
  });

  it("Confinement: B sieht die EIGENE Datei, nicht A's", async () => {
    const rows = (await (await list(fx.b.token)).json()) as FileRow[];
    const names = rows.map((r) => r.name);
    expect(names).toContain(bName);
    expect(names).not.toContain(aName);
  });

  it("Admin sieht beide", async () => {
    const rows = (await (await list(fx.admin.token)).json()) as FileRow[];
    const names = rows.map((r) => r.name);
    expect(names).toContain(aName);
    expect(names).toContain(bName);
  });
});
