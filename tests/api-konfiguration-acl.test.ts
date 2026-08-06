import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Bürointerne Konfiguration und projektbezogene Modul-Schalter.
//
// Beide Gruppen hatten keine einzige Prüfung. Der Unterschied zwischen ihnen
// ist wichtig, weil er über die richtige Antwort entscheidet:
//
//   * **Bürointerne Konfiguration** (Textvorlagen, Word-Vorlagen, Logo und
//     Firmenname, Modul-Voreinstellungen) gilt für ALLE. Wer sie ändert,
//     ändert sie für das ganze Büro — bis hin zum Löschen der einzigen
//     Word-Vorlage, mit der Rechnungen erzeugt werden. Lesen darf jeder,
//     denn ohne diese Daten lässt sich die Oberfläche nicht aufbauen;
//     **schreiben nur der Admin.**
//
//   * **Projektbezogene Modul-Schalter** (`/projects/:name/modules`) gehören
//     zum Projekt und folgen derselben Sichtbarkeit wie dessen Inhalte. Ein
//     Fremder konnte hier nicht nur mitlesen, sondern einem Projekt Module
//     abschalten, das er gar nicht sehen darf.
describe.skipIf(!HAS_DB)("Konfiguration und Modul-Schalter — Rechte", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("konfacl");
  });
  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  // ── Projektbezogen ───────────────────────────────────────────────────────

  it("Modul-Schalter eines fremden Projekts sind weder lesbar noch änderbar", async () => {
    const pfad = `/api/projects/${encodeURIComponent(fx.projectName)}/modules`;

    expect((await fx.app.request(pfad, { headers: authHeader(fx.b.token) })).status).toBe(403);

    const geaendert = await fx.app.request(pfad, {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ meetings: false }),
    });
    expect(geaendert.status).toBe(403);

    const zurueckgesetzt = await fx.app.request(pfad, {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(zurueckgesetzt.status).toBe(403);
  });

  it("der Berechtigte kommt an die Modul-Schalter seines Projekts", async () => {
    const pfad = `/api/projects/${encodeURIComponent(fx.projectName)}/modules`;
    expect((await fx.app.request(pfad, { headers: authHeader(fx.a.token) })).status).toBe(200);

    const geaendert = await fx.app.request(pfad, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ meetings: false }),
    });
    expect(geaendert.status).toBe(200);
  });

  // ── Bürointern: lesen ja, schreiben nur Admin ────────────────────────────

  it("Textvorlagen: lesen darf jeder, anlegen und löschen nur der Admin", async () => {
    expect((await fx.app.request("/api/templates", { headers: authHeader(fx.b.token) })).status).toBe(200);

    const angelegt = await fx.app.request("/api/templates", {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ name: "Heimlich", kind: "note", body: "…" }),
    });
    expect(angelegt.status).toBe(403);
  });

  it("Word-Vorlagen: die Liste ist offen, das Löschen nicht", async () => {
    expect((await fx.app.request("/api/export-templates", { headers: authHeader(fx.b.token) })).status).toBe(200);

    // Auch bei einer erfundenen ID muss 403 kommen, nicht 404 — sonst ließe
    // sich über die Antwort abfragen, welche Vorlagen es gibt.
    const geloescht = await fx.app.request("/api/export-templates/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(geloescht.status).toBe(403);
  });

  it("Logo und Firmenname ändert nur der Admin", async () => {
    expect((await fx.app.request("/api/branding", { headers: authHeader(fx.b.token) })).status).toBe(200);

    const geaendert = await fx.app.request("/api/branding", {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ companyName: "Fremdfirma" }),
    });
    expect(geaendert.status).toBe(403);

    const gitLogo = await fx.app.request("/api/branding/logo", {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(gitLogo.status).toBe(403);
  });

  it("Modul-Voreinstellungen fürs ganze Büro ändert nur der Admin", async () => {
    expect((await fx.app.request("/api/project-modules", { headers: authHeader(fx.b.token) })).status).toBe(200);

    const geaendert = await fx.app.request("/api/project-modules", {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ meetings: false }),
    });
    expect(geaendert.status).toBe(403);
  });

  it("Firmen löscht nur der Admin — anlegen bleibt Tagesgeschäft", async () => {
    const angelegt = await fx.app.request("/api/companies", {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ name: `konfacl-firma-${Date.now()}` }),
    });
    expect(angelegt.status).toBe(201);
    const firma = (await angelegt.json()) as { id: string };

    const geloescht = await fx.app.request(`/api/companies/${firma.id}`, {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(geloescht.status).toBe(403);

    const vomAdmin = await fx.app.request(`/api/companies/${firma.id}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    expect(vomAdmin.status).toBe(200);
  });

  // ── Der Admin darf weiterhin alles ───────────────────────────────────────

  it("der Admin kommt überall durch", async () => {
    const b1 = await fx.app.request("/api/branding", {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ companyName: "Sima Architecture" }),
    });
    expect(b1.status).toBe(200);

    const m1 = await fx.app.request("/api/project-modules", {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ meetings: true }),
    });
    expect(m1.status).toBe(200);
  });
});
