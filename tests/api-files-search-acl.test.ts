import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Type-Query fuers entity-spezifische Setup (kein Laufzeit-`any`).
type FileRepo = (typeof import("../src/data/index.js"))["fileRepo"];
type FileHit = { id: string; filename: string; contentText: string | null; project: string | null };

// GET /api/files/search hatte — anders als GET /api/files — keinen
// Sichtbarkeitsfilter. Ein Non-Admin ohne Projektzugriff bekam fremde Dateien
// samt vollem contentText geliefert; mit ?q=% den gesamten Bestand. Die Suche
// muss denselben Scope anwenden wie die Liste.
//
// Setup: A's Datei haengt an A's Projekt, B's Datei an B's Projekt, dazu eine
// projektlose Datei. Alle drei tragen dasselbe Suchwort, damit ein fehlender
// Filter sofort auffaellt.
describe.skipIf(!HAS_DB)("API — files/search Sichtbarkeitsfilter", () => {
  let fx: AclFixture;
  let fileRepo: FileRepo;
  let aFileId = "";
  let bFileId = "";
  let orphanFileId = "";
  // Eindeutiges Suchwort — die Test-DB wird geteilt, ein generisches "Honorar"
  // wuerde Treffer aus anderen Laeufen einsammeln.
  const tag = `honorar${Date.now()}`;
  const aName = `a-vertraulich-${tag}.txt`;
  const bName = `b-eigen-${tag}.txt`;
  const orphanName = `waise-${tag}.txt`;

  beforeAll(async () => {
    fx = await setupAclFixture("fsrch");
    ({ fileRepo } = await import("../src/data/index.js"));
    aFileId = (
      await fileRepo.save({
        filename: aName,
        filepath: aName,
        filesize: 42,
        mimeType: "text/plain",
        contentText: `VERTRAULICH ${tag} 85000 EUR Bauherr Mayer`,
        project: fx.projectName, // → project_id = fx.projectId (nur A sichtbar)
        uploadedById: fx.a.id,
      })
    ).id;
    bFileId = (
      await fileRepo.save({
        filename: bName,
        filepath: bName,
        filesize: 21,
        mimeType: "text/plain",
        contentText: `B-intern ${tag}`,
        project: fx.projectBName, // → project_id = fx.projectBId (nur B sichtbar)
        uploadedById: fx.b.id,
      })
    ).id;
    // Ohne Projektbezug (project_id IS NULL). list() blendet solche Dateien
    // fuer Non-Admins aus — die Suche muss sich genauso verhalten.
    orphanFileId = (
      await fileRepo.save({
        filename: orphanName,
        filepath: orphanName,
        filesize: 12,
        mimeType: "text/plain",
        contentText: `ohne Projekt ${tag}`,
        uploadedById: fx.a.id,
      })
    ).id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    // files.project_id ist ON DELETE SET NULL → das Projekt-Cleanup raeumt die
    // Dateien nicht mit ab. Explizit loeschen, sonst bleiben Waisen liegen.
    for (const id of [aFileId, bFileId, orphanFileId]) if (id) await fileRepo.delete(id);
    await fx.cleanup();
  });

  const search = (token: string, q: string) =>
    fx.app.request(`/api/files/search?q=${encodeURIComponent(q)}`, { headers: authHeader(token) });
  const names = async (res: Response) => ((await res.json()) as FileHit[]).map((f) => f.filename);

  it("Fremder (B): A's Datei taucht NICHT auf (kein Leak)", async () => {
    const res = await search(fx.b.token, tag);
    expect(res.status).toBe(200);
    expect(await names(res)).not.toContain(aName);
  });

  it("Fremder (B): auch der contentText von A leakt nicht", async () => {
    const res = await search(fx.b.token, tag);
    const hits = (await res.json()) as FileHit[];
    // Der entscheidende Schaden war der ausgelieferte Volltext, nicht der Name.
    expect(hits.some((f) => (f.contentText ?? "").includes("Bauherr Mayer"))).toBe(false);
  });

  it("Confinement: B sieht die EIGENE Datei, aber nur die", async () => {
    const res = await search(fx.b.token, tag);
    const found = await names(res);
    expect(found).toContain(bName); // B's eigenes Projekt ist sichtbar
    expect(found).not.toContain(aName); // A's Projekt nicht
  });

  it("Ersteller (A): findet die eigene Datei", async () => {
    const res = await search(fx.a.token, tag);
    expect(res.status).toBe(200);
    const found = await names(res);
    expect(found).toContain(aName);
    expect(found).not.toContain(bName);
  });

  it("Admin: sieht alle drei Dateien (Scope 'all', kein Filter)", async () => {
    const res = await search(fx.admin.token, tag);
    expect(res.status).toBe(200);
    const found = await names(res);
    expect(found).toContain(aName);
    expect(found).toContain(bName);
    expect(found).toContain(orphanName);
  });

  it("Wildcard ?q=%: B bekommt trotzdem nicht den gesamten Bestand", async () => {
    // "%" ist in ILIKE das Joker-Zeichen — ohne Filter liefert das alles.
    const res = await search(fx.b.token, "%");
    expect(res.status).toBe(200);
    const found = await names(res);
    expect(found).not.toContain(aName);
    expect(found).not.toContain(orphanName);
  });

  it("Datei ohne Projekt bleibt fuer Non-Admins unsichtbar (konsistent zu list())", async () => {
    // Ohne project_id gibt es keinen ACL-Anhaltspunkt — auch fuer den
    // Hochladenden A nicht, genau wie in GET /files.
    expect(await names(await search(fx.a.token, tag))).not.toContain(orphanName);
    expect(await names(await search(fx.b.token, tag))).not.toContain(orphanName);
  });

  it("ohne Token → 401", async () => {
    expect((await fx.app.request(`/api/files/search?q=${tag}`)).status).toBe(401);
  });
});
