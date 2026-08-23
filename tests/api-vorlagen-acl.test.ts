import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Die Vorlagen-Vorschau gab fremde Projekt-Stammdaten heraus.
//
// `GET /templates/:id/render?project=…` reichte den Projektnamen ungeprüft an
// `renderTemplate` weiter; `buildVariables()` liest die Stammdaten ohne jeden
// ACL-Aufruf. Ein Konto ohne Recht bekam auf `GET /api/projects/<fremd>` ein
// 403 — und über diese Vorschau denselben Standort im Klartext.
//
// Erreichbar ohne eigene Vorlage: die Werksvorlage aus Migration 026 wird in
// jede Installation geschrieben und enthält die Platzhalter bereits.
describe.skipIf(!HAS_DB)("Vorlagen-Vorschau: kein Zugriff auf fremde Stammdaten", () => {
  let fx: AclFixture;
  const P = namensraum();
  const STANDORT = `Geheimgasse ${P}`;
  let vorlageId: string;

  beforeAll(async () => {
    fx = await setupAclFixture("vorlacl");

    // A hinterlegt einen Standort, der nicht nach außen soll.
    const patch = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ standort: STANDORT }),
    });
    expect(patch.status).toBe(200);

    // Eine Vorlage, die den Standort einsetzt.
    const res = await fx.app.request("/api/templates", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({
        kind: "note",
        name: `vorlacl-${P}`,
        body: "Ort: {{Ort}} / Nummer: {{Projektnummer}}",
      }),
    });
    expect([200, 201]).toContain(res.status);
    vorlageId = ((await res.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM templates WHERE name LIKE ${"vorlacl-" + P + "%"}`;
    await fx.cleanup();
  });

  const vorschau = (token: string, projekt: string) =>
    fx.app.request(`/api/templates/${vorlageId}/render?project=${encodeURIComponent(projekt)}`, {
      headers: authHeader(token),
    });

  it("B kommt an A's Projekt nicht heran", async () => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);
  });

  it("und bekommt den Standort auch nicht über die Vorschau", async () => {
    const res = await vorschau(fx.b.token, fx.projectName);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(STANDORT);
  });

  it("A sieht die Vorschau seines eigenen Projekts", async () => {
    // Gegenprobe: ohne sie wäre ein Fix, der die Vorschau abschafft, grün.
    const res = await vorschau(fx.a.token, fx.projectName);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain(STANDORT);
  });

  it("eine Vorschau ohne Projektbezug bleibt möglich", async () => {
    // Der dokumentierte Regelfall: ohne Projekt bleiben die projektbezogenen
    // Platzhalter leer.
    const res = await fx.app.request(`/api/templates/${vorlageId}/render`, {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(200);
  });
});
