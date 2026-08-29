import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die Anwendung greift beim Löschen nicht auf fremde Dateien im
// Dokumentenordner durch.
//
// ── Der Befund ──────────────────────────────────────────────────────────────
//
// Beim Löschen einer Datei räumte die Route eine „Altlast im Vault" mit weg:
//
//     const legacyPath = path.resolve(WORKSPACE_PATH, file.filepath);
//     if (… && fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
//
// Gedacht war das für Einträge aus der Vault-Zeit, bei denen die Datei
// tatsächlich im Ordner lag. Nur: bei einem HEUTIGEN Upload ist `filepath`
// schlicht der Dateiname — die Datei selbst liegt als `bytea` in der
// Datenbank. Ein Löschen in PATIO traf damit jede gleichnamige Datei im
// Ordner, ohne Rückfrage und ohne Spur.
//
// Die Reparatur: der Aufräumschritt greift nur noch bei Einträgen, die
// wirklich keinen Inhalt in der Datenbank haben — das sind genau die
// Alt-Einträge, für die er gedacht war.
//
// ── Was sich am 29.08.2026 geändert hat ─────────────────────────────────────
//
// Bis dahin war `/opt/patio-workspace` zugleich die Samba-Freigabe
// „Dokumente": der Schaden bestand darin, dass eine Kollegin ihre Datei im
// Explorer verlor. Die Freigabe ist entfallen, der Ordner nicht — dort liegt
// weiterhin der Altbestand aus der Vault-Zeit, und für den gilt dasselbe.
//
// Diese Prüfung bleibt deshalb unverändert bestehen: sie hält fest, dass ein
// Upload mit Inhalt in der Datenbank NIE eine Datei im Ordner anfasst, und
// dass der Aufräumschritt für echte Alt-Einträge trotzdem greift.
describe.skipIf(!HAS_DB)("Die Anwendung greift beim Löschen nicht auf den Dokumentenordner durch", () => {
  let fx: AclFixture;
  let workspace = "";
  const name = `Grundriss-${Date.now()}.txt`;
  let fremdeDatei = "";

  beforeAll(async () => {
    fx = await setupAclFixture("freigabe");
    const { WORKSPACE_PATH } = await import("../src/config.js");
    workspace = WORKSPACE_PATH;
    fremdeDatei = path.resolve(workspace, name);
    fs.mkdirSync(path.dirname(fremdeDatei), { recursive: true });
    // Eine fremde Datei im Ordner — Altbestand, der nicht zu diesem Upload gehört.
    fs.writeFileSync(fremdeDatei, "Plan aus dem Altbestand — gehört nicht zu diesem Upload");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
    if (fremdeDatei && fs.existsSync(fremdeDatei)) fs.unlinkSync(fremdeDatei);
  });

  it("eine gelöschte Datei nimmt die gleichnamige Datei im Ordner NICHT mit", async () => {
    const { fileRepo } = await import("../src/data/index.js");
    // Ein ganz normaler Upload: Inhalt in der Datenbank, `filepath` = Name.
    const eintrag = await fileRepo.save({
      filename: name,
      filepath: name,
      filesize: 6,
      mimeType: "text/plain",
      project: fx.projectName,
      uploadedById: fx.a.id,
      blob: Buffer.from("Inhalt"),
    });

    const res = await fx.app.request("/api/files", {
      method: "DELETE",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ id: eintrag.id }),
    });
    expect(res.status).toBe(200);

    // Der Datenbankeintrag ist weg …
    expect(await fileRepo.get(eintrag.id)).toBeNull();
    // … die fremde Datei im Ordner steht unangetastet da.
    expect(fs.existsSync(fremdeDatei)).toBe(true);
    expect(fs.readFileSync(fremdeDatei, "utf-8")).toContain("Altbestand");
  });

  it("ein echter Alt-Eintrag ohne Inhalt in der Datenbank wird weiterhin aufgeräumt", async () => {
    // Die Gegenrichtung: der Aufräumschritt soll nicht verschwinden, nur
    // treffsicher werden. Alt-Einträge aus der Vault-Zeit haben keinen Blob.
    const altName = `alt-${Date.now()}.txt`;
    const altPfad = path.resolve(workspace, altName);
    fs.writeFileSync(altPfad, "Altbestand");

    const { fileRepo } = await import("../src/data/index.js");
    const eintrag = await fileRepo.save({
      filename: altName,
      filepath: altName,
      filesize: 10,
      mimeType: "text/plain",
      project: fx.projectName,
      uploadedById: fx.a.id,
      // KEIN blob — genau das kennzeichnet den Alt-Eintrag.
    });

    const res = await fx.app.request("/api/files", {
      method: "DELETE",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ id: eintrag.id }),
    });
    expect(res.status).toBe(200);
    expect(fs.existsSync(altPfad)).toBe(false);
  });

  it("die Datei in der Freigabe taucht nicht in der Dateiliste auf", async () => {
    // Die beiden Ablagen sind getrennt: was im Ordner liegt, kennt die
    // Anwendung nicht — und umgekehrt.
    const res = await fx.app.request("/api/files", { headers: authHeader(fx.admin.token) });
    const namen = ((await res.json()) as { filename: string }[]).map((f) => f.filename);
    expect(namen).not.toContain(name);
  });
});
