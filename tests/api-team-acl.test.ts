import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die Team-Liste ist der interne Kollegenkatalog: Name, Rolle, Firma, E-Mail,
// Telefon. Dass jeder im Büro sie lesen darf, ist richtig und bleibt so — sie
// füttert jeden Zuweisungs-Dialog in Aufgaben, Terminen und Besprechungen.
//
// Sie trägt aber noch etwas anderes mit sich: **die Projektzuordnungen jedes
// Mitglieds, mit Projektnamen.** Damit ließ sich über einen einzigen Aufruf
// die vollständige Projektliste des Büros abfragen — auch die Projekte, die
// der Fragende nicht sehen darf. Bei einem Büro, das für konkurrierende
// Bauherren arbeitet, ist schon der Projektname eine Auskunft.
describe.skipIf(!HAS_DB)("Team — Projektzuordnungen folgen den Projekt-Rechten", () => {
  let fx: AclFixture;
  let mitgliedId = "";

  beforeAll(async () => {
    fx = await setupAclFixture("teamacl");

    const angelegt = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `teamacl-person-${Date.now()}`, role: "Projektleitung" }),
    });
    expect(angelegt.status).toBe(201);
    mitgliedId = ((await angelegt.json()) as { id: string }).id;

    // Dasselbe Mitglied beiden Projekten zuordnen — A's und B's.
    for (const pid of [fx.projectId, fx.projectBId]) {
      const zugeordnet = await fx.app.request(`/api/team/${mitgliedId}/projects`, {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ projectId: pid }),
      });
      expect([200, 201]).toContain(zugeordnet.status);
    }
  });

  afterAll(async () => {
    if (HAS_DB) {
      const { getDb } = await import("../src/db/client.js");
      await getDb()`DELETE FROM team_members WHERE id = ${mitgliedId}`;
      await fx.cleanup();
    }
  });

  /** Projektnamen, die in einer Team-Antwort auftauchen. */
  function projektnamen(daten: unknown): string[] {
    const liste = Array.isArray(daten) ? daten : [daten];
    return liste.flatMap((m) => {
      const projekte = (m as { projects?: { name?: string }[] }).projects ?? [];
      return projekte.map((p) => String(p.name ?? ""));
    });
  }

  it("die Liste zeigt B nur die Projekte, die B sehen darf", async () => {
    const res = await fx.app.request("/api/team", { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(200);
    const namen = projektnamen(await res.json());
    expect(namen).toContain(fx.projectBName);
    expect(namen).not.toContain(fx.projectName);
  });

  it("die Einzelansicht ebenso", async () => {
    const res = await fx.app.request(`/api/team/${mitgliedId}`, { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(200);
    const namen = projektnamen(await res.json());
    expect(namen).toContain(fx.projectBName);
    expect(namen).not.toContain(fx.projectName);
  });

  it("der Admin sieht weiterhin beide Zuordnungen", async () => {
    // Die Gegenrichtung: sonst bewiese ein leeres Ergebnis nur, dass die
    // Zuordnung gar nicht angekommen ist.
    const res = await fx.app.request(`/api/team/${mitgliedId}`, { headers: authHeader(fx.admin.token) });
    expect(res.status).toBe(200);
    const namen = projektnamen(await res.json());
    expect(namen).toContain(fx.projectName);
    expect(namen).toContain(fx.projectBName);
  });

  it("die Stammdaten selbst bleiben für alle lesbar", async () => {
    // Ausdrücklich festgehalten, damit es niemand später „sicherheitshalber"
    // zumacht: der Kollegenkatalog ist im Büro allgemein zugänglich, sonst
    // funktioniert keine Zuweisung mehr.
    const res = await fx.app.request("/api/team", { headers: authHeader(fx.b.token) });
    const liste = (await res.json()) as { id: string; name: string }[];
    expect(liste.some((m) => m.id === mitgliedId)).toBe(true);
  });
});
