import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Type-Query fuers entity-spezifische Setup (kein Laufzeit-`any`).
type FileRepo = (typeof import("../src/data/index.js"))["fileRepo"];

// Dateien koennen sensibel sein (Vertraege, Plaene). Die ACL muss verhindern:
//   - Download-/Read-IDOR: fremde Datei per ID ziehen (canAccessFile:
//     Uploader ODER sichtbares Projekt ODER Share).
//   - Ownership: fremde Datei loeschen/teilen (isFileOwnerOrAdmin: nur
//     Uploader/Admin).
// Setup: Datei gehoert A (uploaded_by) und haengt an A's Projekt. B hat weder
// Projektzugriff noch einen Share → kein Zugriff.
describe.skipIf(!HAS_DB)("API — files ACL-Durchsetzung", () => {
  let fx: AclFixture;
  let fileRepo: FileRepo;
  let fileId = "";
  let bFileId = ""; // B's EIGENE Datei an B's Projekt (fuer Confinement)

  beforeAll(async () => {
    fx = await setupAclFixture("file");
    ({ fileRepo } = await import("../src/data/index.js"));
    const entry = await fileRepo!.save({
      filename: "geheim.txt",
      filepath: "geheim.txt",
      filesize: 13,
      mimeType: "text/plain",
      project: fx.projectName, // → project_id = fx.projectId
      blob: Buffer.from("streng geheim"),
      uploadedById: fx.a.id, // → uploaded_by = A
    });
    fileId = entry.id;
    // B legt eine EIGENE Datei an SEINEM Projekt an (uploaded_by = B).
    const bEntry = await fileRepo!.save({
      filename: "b-eigen.txt",
      filepath: "b-eigen.txt",
      filesize: 8,
      mimeType: "text/plain",
      project: fx.projectBName, // → project_id = fx.projectBId
      blob: Buffer.from("b-datei"),
      uploadedById: fx.b.id, // → uploaded_by = B
    });
    bFileId = bEntry.id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    // files.project_id ist ON DELETE SET NULL → das Projekt-Cleanup entfernt
    // die Dateien nicht mit. Beide explizit loeschen, sonst bleiben Waisen liegen.
    if (fileId) await fileRepo!.delete(fileId);
    if (bFileId) await fileRepo!.delete(bFileId);
    await fx.cleanup();
  });

  const download = (token: string) =>
    fx.app.request(`/api/files/download?id=${fileId}`, { headers: authHeader(token) });
  const read = (token: string) => fx.app.request(`/api/files/read?id=${fileId}`, { headers: authHeader(token) });

  it("Download: fremder Non-Admin (B) → 403 (IDOR-Schutz)", async () => {
    expect((await download(fx.b.token)).status).toBe(403);
  });

  it("Download: Uploader (A) → 200 + attachment", async () => {
    const res = await download(fx.a.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("Download: Admin → 200", async () => {
    expect((await download(fx.admin.token)).status).toBe(200);
  });

  it("Read: fremder Non-Admin (B) → 403", async () => {
    expect((await read(fx.b.token)).status).toBe(403);
  });

  it("DELETE fremde Datei durch B → 403 (Ownership)", async () => {
    const res = await fx.app.request(`/api/files`, {
      method: "DELETE",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ id: fileId }),
    });
    expect(res.status).toBe(403);
  });

  it("Share fremde Datei durch B → 403 (nur Uploader/Admin darf teilen)", async () => {
    // B versucht, sich die Datei selbst freizugeben — genau das muss scheitern.
    const res = await fx.app.request(`/api/files/${fileId}/shares`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ userId: fx.b.id, canEdit: true }),
    });
    expect(res.status).toBe(403);
  });

  it("Download ohne Token → 401", async () => {
    expect((await fx.app.request(`/api/files/download?id=${fileId}`)).status).toBe(401);
  });

  // ── Confinement (IDOR-Kern) ─────────────────────────────────────────────
  // B ist teil-berechtigt (sieht sein Projekt) und Uploader seiner eigenen
  // Datei. Er darf die EIGENE ziehen/lesen, aber A's bleibt gesperrt. Ein
  // pauschaler ACL-Check faellt hier durch: "alles verweigern" laesst 200
  // scheitern, "hat irgendein Projekt -> darf alles" laesst A's Download auf
  // 200 durchgehen (siehe bestehender 403-Test).
  it("Confinement: B laedt EIGENE Datei → 200 + attachment", async () => {
    const own = await fx.app.request(`/api/files/download?id=${bFileId}`, { headers: authHeader(fx.b.token) });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-disposition")).toContain("attachment");
  });

  it("Confinement: B liest EIGENE Datei → 200", async () => {
    const own = await fx.app.request(`/api/files/read?id=${bFileId}`, { headers: authHeader(fx.b.token) });
    expect(own.status).toBe(200);
  });

  it("Confinement: B laedt A's Datei → 403 (fremde Ressource gesperrt)", async () => {
    expect((await download(fx.b.token)).status).toBe(403);
  });
});
