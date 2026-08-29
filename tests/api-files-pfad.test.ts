import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Der Dokumentenordner ist nicht über HTTP erreichbar.
//
// ── Der Befund ──────────────────────────────────────────────────────────────
//
// `src/api/routes/files.ts` hatte drei Wege, die einen PFAD entgegennahmen und
// direkt im Dateisystem arbeiteten — ohne jede Rechteprüfung:
//
//   GET    /api/files/read?path=…   las jede Datei, voller Inhalt, Status 200
//   POST   /api/files/mkdir         legte Ordner an
//   DELETE /api/files  {path}       löschte per `rmSync(recursive)` ganze Bäume
//
// Geprüft wurde jeweils nur, dass der Pfad den Ordner nicht verlässt
// (`safePath`) — nicht, WER da liest oder löscht. Ein Konto ohne einen
// einzigen Projektzugriff kam damit an jedes Dokument des Büros, und ein
// einziger Aufruf konnte einen ganzen Projektordner entfernen.
//
// Das wiegt schwer, weil in diesem Ordner der Altbestand aus der Vault-Zeit
// liegt:
// dort liegen Verträge, Pläne und Honorarvereinbarungen.
//
// Die drei Wege stammen aus der Vault-Zeit und waren von der Oberfläche nie
// erreichbar — Dateien liegen seit dem Umbau als `bytea` in der Datenbank,
// und der Dateibrowser baut seine Ordner logisch aus den Projekten. Deshalb
// sind sie entfernt statt bewacht: ein Weg, den niemand braucht, ist besser
// zu als kontrolliert.
describe.skipIf(!HAS_DB)("Dokumentenordner ist nicht über HTTP erreichbar", () => {
  let fx: AclFixture;
  let workspace = "";
  const rel = `probe-vertrag-${Date.now()}.txt`;
  let abs = "";

  beforeAll(async () => {
    fx = await setupAclFixture("fspfad");
    const { WORKSPACE_PATH } = await import("../src/config.js");
    workspace = WORKSPACE_PATH;
    abs = path.resolve(workspace, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "Honorarvereinbarung: 180.000 EUR");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
    if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
  });

  it("Lesen über einen Pfad geht nicht mehr", async () => {
    const res = await fx.app.request(`/api/files/read?path=${encodeURIComponent(rel)}`, {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("Honorarvereinbarung");
    // Und die Datei liegt unangetastet da.
    expect(fs.readFileSync(abs, "utf-8")).toContain("180.000");
  });

  it("… auch nicht für den Verwalter", async () => {
    // Bewusst so: der Weg ist weg, nicht bewacht. Ein Admin, der eine Datei
    // braucht, holt sie über die Freigabe — dafür ist sie da.
    const res = await fx.app.request(`/api/files/read?path=${encodeURIComponent(rel)}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(400);
  });

  it("Ordner anlegen geht nicht mehr", async () => {
    const name = `probe-ordner-${Date.now()}`;
    const res = await fx.app.request("/api/files/mkdir", {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ path: name }),
    });
    expect(res.status).toBe(404);
    expect(fs.existsSync(path.resolve(workspace, name))).toBe(false);
  });

  it("Löschen über einen Pfad geht nicht mehr — und löscht nichts", async () => {
    // Der gefährlichste der drei: `rmSync(recursive)` auf einen ganzen Baum.
    const res = await fx.app.request("/api/files", {
      method: "DELETE",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ path: rel }),
    });
    expect([400, 404]).toContain(res.status);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it("die Dateiliste liefert weiterhin die Dateien aus der Datenbank", async () => {
    // Die Gegenrichtung: der eigentliche Weg muss unverändert funktionieren,
    // sonst hätte das Zumachen die Funktion mitgenommen.
    const res = await fx.app.request("/api/files", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("Hochladen und Herunterladen über die Datenbank funktioniert unverändert", async () => {
    const { fileRepo } = await import("../src/data/index.js");
    const eintrag = await fileRepo.save({
      filename: `db-datei-${Date.now()}.txt`,
      filepath: `db-datei.txt`,
      filesize: 5,
      mimeType: "text/plain",
      project: fx.projectName,
      uploadedById: fx.a.id,
      blob: Buffer.from("Inhalt"),
    });

    const gelesen = await fx.app.request(`/api/files/read?id=${eintrag.id}`, {
      headers: authHeader(fx.a.token),
    });
    expect(gelesen.status).toBe(200);

    // Und ein Fremder kommt weiterhin nicht heran.
    const fremd = await fx.app.request(`/api/files/read?id=${eintrag.id}`, {
      headers: authHeader(fx.b.token),
    });
    expect(fremd.status).toBe(403);
  });
});
