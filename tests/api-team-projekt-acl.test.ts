import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Drei Team-Routen nahmen eine `projectId` entgegen und handelten darauf ohne
// jede Rechteprüfung.
//
// ── Dieselbe Klasse wie die acht Projekt-Unterrouten ────────────────────────
//
// `src/api/routes/team.ts` hat einen Sichtbarkeitsfilter (`sichtbar()`), und
// die beiden GET-Routen benutzen ihn korrekt: `GET /team/:id` liefert einem
// Fremden für ein fremdes Projekt eine leere Zuordnungsliste. Die drei
// SCHREIBENDEN Routen darunter benutzten ihn nicht — sie bekamen die
// Projekt-ID aus dem Pfad bzw. dem Body und arbeiteten damit.
//
// Der Pfad ist derselbe wie bei den acht Routen in `projects.ts`: die lesende
// Seite ist bewacht, die schreibende wurde vergessen, und beim Lesen der Datei
// sieht sie deshalb bewacht aus.
describe.skipIf(!HAS_DB)("Team-Projektzuordnungen: kein Zugriff ohne Recht", () => {
  let fx: AclFixture;
  let mitgliedId: string;

  beforeAll(async () => {
    fx = await setupAclFixture("teamacl");

    // Ein Mitglied anlegen und A's Projekt zuordnen — als Admin, also regulär.
    const res = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `teamacl-mitglied-${Date.now()}`, type: "intern" }),
    });
    expect(res.status).toBe(201);
    mitgliedId = ((await res.json()) as { id: string }).id;

    const zu = await fx.app.request(`/api/team/${mitgliedId}/projects`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ projectId: fx.projectId, projectRole: "Projektleitung" }),
    });
    expect(zu.status).toBe(200);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM team_members WHERE name LIKE ${"teamacl-mitglied-%"}`;
    await fx.cleanup();
  });

  const zuordnungenVonA = async () => {
    const { getDb } = await import("../src/db/client.js");
    const [z] = await getDb()`
      SELECT count(*)::int AS n FROM project_team_members
       WHERE project_id = ${fx.projectId} AND member_id = ${mitgliedId}`;
    return z.n as number;
  };

  it("B hängt sein Mitglied nicht an A's Projekt", async () => {
    const res = await fx.app.request(`/api/team/${mitgliedId}/projects`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ projectId: fx.projectId, projectRole: "Untergeschoben" }),
    });
    expect(res.status).toBe(403);
  });

  it("B ändert die Rolle in A's Projekt nicht", async () => {
    const res = await fx.app.request(`/api/team/${mitgliedId}/projects/${fx.projectId}`, {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ projectRole: "Übernommen" }),
    });
    expect(res.status).toBe(403);
  });

  it("B löscht die Zuordnung in A's Projekt nicht", async () => {
    // Der schwerste der drei: ein Löschen ohne Papierkorb. `project_team_members`
    // hat kein `deleted_at` — was hier verschwindet, ist weg.
    expect(await zuordnungenVonA()).toBe(1);

    const res = await fx.app.request(`/api/team/${mitgliedId}/projects/${fx.projectId}`, {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);

    // Und wirklich nicht — der Statuscode allein sagt nicht, dass nichts
    // geschrieben wurde.
    expect(await zuordnungenVonA()).toBe(1);
  });

  // ── Gegenprobe: der Berechtigte kommt weiterhin durch ─────────────────────

  it("A darf all das in seinem eigenen Projekt", async () => {
    // Ohne diese Prüfung wäre ein Fix, der einfach alles sperrt, ebenfalls
    // grün.
    const rolle = await fx.app.request(`/api/team/${mitgliedId}/projects/${fx.projectId}`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ projectRole: "Bauleitung" }),
    });
    expect(rolle.status).toBe(200);

    const weg = await fx.app.request(`/api/team/${mitgliedId}/projects/${fx.projectId}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(weg.status).toBe(200);
    expect(await zuordnungenVonA()).toBe(0);

    const zurueck = await fx.app.request(`/api/team/${mitgliedId}/projects`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ projectId: fx.projectId, projectRole: "Projektleitung" }),
    });
    expect(zurueck.status).toBe(200);
  });

  it("B darf es in seinem EIGENEN Projekt", async () => {
    const res = await fx.app.request(`/api/team/${mitgliedId}/projects`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ projectId: fx.projectBId, projectRole: "Statik" }),
    });
    expect(res.status).toBe(200);
  });

  it("die Antwort verrät B nichts über A's Projekt", async () => {
    // Nebenleck: die POST-Route gibt am Ende `teamRepo.get(memberId)` ohne
    // Sichtbarkeitsfilter zurück — damit stünden Name und ID von A's Projekt
    // in einer Antwort, die B bekommt.
    const res = await fx.app.request(`/api/team/${mitgliedId}/projects`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ projectId: fx.projectBId }),
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(fx.projectName);
  });
});
