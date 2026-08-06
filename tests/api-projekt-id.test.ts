import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// `?projectId=` als umbenennungsfeste Alternative zu `?project=<Name>`.
//
// Der Name ist gut lesbar und bleibt der Normalfall — aber er ist änderbar.
// Wer sich einen Aufruf merkt, ein Lesezeichen setzt oder später über MCP
// abfragt, verliert den Bezug beim ersten Umbenennen, und zwar STILL: die
// Antwort ist dann eine leere Liste, kein Fehler.
describe.skipIf(!HAS_DB)("Projektbezug über die stabile ID", () => {
  let fx: AclFixture;
  const P = `pid-${Date.now()}`;

  beforeAll(async () => {
    fx = await setupAclFixture("pid");
    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-aufgabe`, project: fx.projectName }),
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  it("liefert dieselbe Menge wie die Abfrage über den Namen", async () => {
    const ueberName = await fx.app.request(`/api/tasks?project=${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.admin.token),
    });
    const ueberId = await fx.app.request(`/api/tasks?projectId=${fx.projectId}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(ueberId.status).toBe(200);
    expect(await ueberId.json()).toEqual(await ueberName.json());
  });

  it("überlebt das Umbenennen des Projekts — der Name nicht", async () => {
    // Das ist der ganze Zweck.
    const neuerName = `${fx.projectName}-umbenannt`;
    const umbenannt = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/rename`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ newName: neuerName }),
    });
    expect(umbenannt.status).toBe(200);

    try {
      // Über die ID: unverändert erreichbar.
      const ueberId = await fx.app.request(`/api/tasks?projectId=${fx.projectId}`, {
        headers: authHeader(fx.admin.token),
      });
      expect(ueberId.status).toBe(200);
      const aufgaben = (await ueberId.json()) as { text: string }[];
      expect(aufgaben.some((t) => t.text === `${P}-aufgabe`)).toBe(true);

      // Über den alten Namen: leer. Genau der stille Verlust, den die ID
      // vermeidet — deshalb steht er hier als Vergleich.
      const ueberAltenNamen = await fx.app.request(`/api/tasks?project=${encodeURIComponent(fx.projectName)}`, {
        headers: authHeader(fx.admin.token),
      });
      expect((await ueberAltenNamen.json()) as unknown[]).toEqual([]);
    } finally {
      await fx.app.request(`/api/projects/${encodeURIComponent(neuerName)}/rename`, {
        method: "PUT",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ newName: fx.projectName }),
      });
    }
  });

  it("eine unbekannte ID gibt 404 — nicht die Liste aller Projekte", async () => {
    // Die wichtigste Festlegung: eine veraltete Kennung darf nicht dazu
    // führen, dass jemand MEHR sieht als gemeint. Fiele sie auf „kein
    // Projektfilter" zurück, wäre das genau der Fall.
    const res = await fx.app.request("/api/tasks?projectId=00000000-0000-0000-0000-000000000000", {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(404);
  });

  it("auch eine unsinnige ID gibt 404, keinen Datenbankfehler", async () => {
    const res = await fx.app.request("/api/tasks?projectId=keine-uuid", {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(404);
  });

  it("ein Projekt im Papierkorb ist über seine ID nicht mehr erreichbar", async () => {
    await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    try {
      const res = await fx.app.request(`/api/tasks?projectId=${fx.projectId}`, {
        headers: authHeader(fx.admin.token),
      });
      expect(res.status).toBe(404);
    } finally {
      await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/wiederherstellen`, {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
      });
    }
  });

  it("die Rechte gelten unverändert — eine ID ist kein Schlüssel", async () => {
    // Wer das Projekt nicht sehen darf, sieht es auch über seine ID nicht.
    const res = await fx.app.request(`/api/tasks?projectId=${fx.projectId}`, {
      headers: authHeader(fx.b.token),
    });
    const aufgaben = (await res.json()) as { text: string }[];
    expect(aufgaben.some((t) => t.text === `${P}-aufgabe`)).toBe(false);
  });

  it("beim Anlegen zählt die ID, wenn beides mitkommt", async () => {
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({
        text: `${P}-vorrang`,
        project: fx.projectBName, // absichtlich ein anderes Projekt
        projectId: fx.projectId,
      }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { project: string | null }).project).toBe(fx.projectName);
  });

  it("Notizen und Termine verstehen die ID ebenso", async () => {
    const notiz = await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ content: `${P}-notiz\nInhalt`, projectId: fx.projectId }),
    });
    expect(notiz.status).toBe(201);

    const termin = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ datum: "01.10.2026", text: `${P}-termin`, projectId: fx.projectId }),
    });
    expect(termin.status).toBe(201);
    expect(((await termin.json()) as { project: string | null }).project).toBe(fx.projectName);

    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM notes WHERE title LIKE ${P + "%"}`;
  });
});
