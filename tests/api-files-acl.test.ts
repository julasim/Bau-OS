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
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    // files.project_id ist ON DELETE SET NULL → das Projekt-Cleanup entfernt
    // die Datei nicht mit. Explizit loeschen, sonst bleibt eine Waise liegen.
    if (fileId) await fileRepo!.delete(fileId);
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
});
